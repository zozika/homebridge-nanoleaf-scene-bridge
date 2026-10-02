import type { PlatformAccessory } from 'homebridge';

import {
  DEFAULT_PORT,
  EVENT_EFFECTS,
  EVENT_STATE,
  NanoleafClient,
  NanoleafEvent,
  NanoleafHttpError,
  NanoleafInfo,
  requestToken,
} from './client';
import type { NanoleafSceneBridgePlatform } from './platform';
import { PLUGIN_NAME } from './settings';

/** What turning off the switch of the active scene does. */
export type OffAction = 'off' | 'previous' | 'none';

export interface DeviceConfig {
  host: string;
  port?: number;
  token?: string;
}

interface SceneContext {
  serialNo: string;
  host: string;
  effect: string;
}

const PAIRING_RETRY_MS = 5_000;
const EVENT_RECONNECT_MS = 10_000;
/** Reopen the event stream periodically so a silently dropped connection cannot linger. */
const EVENT_STREAM_MAX_MS = 30 * 60_000;
const DEFAULT_POLL_SECONDS = 15;
const MIN_POLL_SECONDS = 5;

/**
 * One Nanoleaf device: pairs with it, keeps its power and active scene in sync
 * through the event stream (plus polling as a fallback), and owns one switch
 * accessory per scene.
 */
export class NanoleafDevice {
  hasSynced = false;

  private client?: NanoleafClient;
  private info?: NanoleafInfo;
  private reachable = false;
  private isOn = false;
  private currentEffect = '';
  private previousEffect?: string;
  private configTokenRejected = false;
  private scenesKey = '';

  /** Scene switch accessories, keyed by effect name. */
  private readonly scenes = new Map<string, PlatformAccessory>();
  private readonly lastSwitchState = new Map<string, boolean>();
  private readonly abort = new AbortController();
  private readonly port: number;
  private readonly pollMs: number;

  constructor(
    private readonly platform: NanoleafSceneBridgePlatform,
    private readonly config: DeviceConfig,
  ) {
    this.port = config.port ?? DEFAULT_PORT;
    this.pollMs = Math.max(MIN_POLL_SECONDS, platform.config.pollInterval ?? DEFAULT_POLL_SECONDS) * 1000;
  }

  private get host(): string {
    return this.config.host;
  }

  private get stopped(): boolean {
    return this.abort.signal.aborted;
  }

  start(): void {
    for (const accessory of this.platform.claimAccessoriesByHost(this.host)) {
      const { effect } = accessory.context as SceneContext;
      this.scenes.set(effect, accessory);
      this.configureScene(accessory, effect);
    }
    this.run().catch((err) => this.log('error', `Stopped unexpectedly: ${errorMessage(err)}`));
  }

  stop(): void {
    this.abort.abort();
  }

  private async run(): Promise<void> {
    let failures = 0;
    while (!this.stopped) {
      if (!this.client) {
        const token = await this.obtainToken();
        if (!token) {
          return;
        }
        this.client = new NanoleafClient(this.host, this.port, token);
        this.listen(this.client);
      }

      try {
        const wasSynced = this.hasSynced;
        await this.refresh(this.client);
        if (failures > 0 && wasSynced) {
          this.log('info', 'Reachable again.');
        }
        failures = 0;
      } catch (err) {
        if (this.stopped) {
          return;
        }
        if (err instanceof NanoleafHttpError && err.status === 401) {
          this.log('error', 'The auth token was rejected. Hold the power button for 5-7 seconds to pair again.');
          this.forgetToken();
          continue;
        }
        this.setReachable(false);
        this.log(failures === 0 ? 'warn' : 'debug', `Cannot reach the device: ${errorMessage(err)}`);
        failures++;
      }

      await this.sleep(this.pollMs);
    }
  }

  private async obtainToken(): Promise<string | undefined> {
    if (this.config.token && !this.configTokenRejected) {
      return this.config.token;
    }
    const stored = this.platform.tokens.get(this.host);
    if (stored) {
      return stored;
    }

    this.log('warn', 'Not paired yet. Hold the power button on the Nanoleaf for 5-7 seconds until the light flashes; ' +
      'pairing completes automatically.');
    let attempts = 0;
    while (!this.stopped) {
      try {
        const token = await requestToken(this.host, this.port);
        this.platform.tokens.set(this.host, token);
        this.log('info', 'Paired successfully, the auth token is saved.');
        return token;
      } catch (err) {
        attempts++;
        // A reminder roughly every minute while waiting for the button press.
        const level = attempts % 12 === 0 ? 'info' : 'debug';
        this.log(level, `Waiting for pairing mode (${errorMessage(err)}).`);
      }
      await this.sleep(PAIRING_RETRY_MS);
    }
    return undefined;
  }

  private forgetToken(): void {
    if (this.config.token) {
      this.configTokenRejected = true;
    }
    this.platform.tokens.delete(this.host);
    this.client = undefined;
    this.setReachable(false);
  }

  /** Keeps an event stream open for as long as `client` is the current client. */
  private listen(client: NanoleafClient): void {
    const loop = async () => {
      while (!this.stopped && this.client === client) {
        const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(EVENT_STREAM_MAX_MS)]);
        try {
          await client.streamEvents([EVENT_STATE, EVENT_EFFECTS], (id, events) => this.onEvents(id, events), signal);
        } catch (err) {
          if (!this.stopped && !signal.aborted) {
            this.log('debug', `Event stream error: ${errorMessage(err)}`);
          }
        }
        if (!signal.aborted) {
          await this.sleep(EVENT_RECONNECT_MS);
        }
      }
    };
    loop().catch((err) => this.log('debug', `Event stream stopped: ${errorMessage(err)}`));
  }

  private onEvents(id: number, events: NanoleafEvent[]): void {
    for (const event of events) {
      if (id === EVENT_STATE && event.attr === 1) {
        this.isOn = Boolean(event.value);
      } else if (id === EVENT_EFFECTS && event.attr === 1) {
        this.setCurrentEffect(String(event.value));
      }
    }
    this.log('debug', `Event ${id}: ${JSON.stringify(events)}`);
    this.updateSwitches();
  }

  private async refresh(client: NanoleafClient): Promise<void> {
    const info = await client.getInfo();
    this.info = info;
    this.isOn = Boolean(info.state?.on?.value);
    this.setCurrentEffect(info.effects?.select ?? '');
    this.syncScenes(info);
    this.setReachable(true);
    this.updateSwitches();

    if (!this.hasSynced) {
      this.hasSynced = true;
      this.log('info', `Connected to ${info.name} (${info.model}, firmware ${info.firmwareVersion}), ` +
        `${this.scenes.size} scenes exposed.`);
      this.platform.onDeviceSynced();
    }
  }

  private setCurrentEffect(effect: string): void {
    if (effect === this.currentEffect) {
      return;
    }
    // Only remember real scenes, not pseudo effects such as "*Solid*".
    if (this.scenes.has(this.currentEffect)) {
      this.previousEffect = this.currentEffect;
    }
    this.currentEffect = effect;
  }

  private setReachable(reachable: boolean): void {
    if (reachable !== this.reachable) {
      this.reachable = reachable;
      this.lastSwitchState.clear();
    }
  }

  /** Creates, reuses and removes switch accessories so they match the device's scene list. */
  private syncScenes(info: NanoleafInfo): void {
    const wanted = this.filterScenes(info.effects?.effectsList ?? []);
    const key = `${info.serialNo}|${info.model}|${info.firmwareVersion}|${wanted.join('|')}`;
    if (key === this.scenesKey) {
      return;
    }
    this.scenesKey = key;

    const { api } = this.platform;
    const added: PlatformAccessory[] = [];
    const reused: PlatformAccessory[] = [];
    const wantedSet = new Set(wanted);

    for (const effect of wanted) {
      let accessory = this.scenes.get(effect);
      if (!accessory) {
        const uuid = api.hap.uuid.generate(`${PLUGIN_NAME}:${info.serialNo}:${effect}`);
        accessory = this.platform.claimAccessory(uuid);
        if (accessory) {
          reused.push(accessory);
        } else {
          accessory = new api.platformAccessory(this.sceneName(effect), uuid);
          added.push(accessory);
        }
        this.scenes.set(effect, accessory);
      }
      this.configureScene(accessory, effect, info);
    }

    const removed: PlatformAccessory[] = [];
    for (const [effect, accessory] of this.scenes) {
      if (!wantedSet.has(effect)) {
        removed.push(accessory);
        this.scenes.delete(effect);
        this.lastSwitchState.delete(effect);
      }
    }

    this.platform.registerAccessories(added);
    if (reused.length > 0) {
      api.updatePlatformAccessories(reused);
    }
    this.platform.unregisterAccessories(removed);

    if (this.hasSynced && (added.length > 0 || removed.length > 0)) {
      this.log('info', `Scene list changed: ${added.length} added, ${removed.length} removed.`);
    }
  }

  private filterScenes(effects: string[]): string[] {
    const include = normalizedSet(this.platform.config.include);
    const exclude = normalizedSet(this.platform.config.exclude);
    const seen = new Set<string>();
    return effects.filter((effect) => {
      const name = effect.trim().toLowerCase();
      if (!effect || seen.has(effect) || exclude.has(name) || (include.size > 0 && !include.has(name))) {
        return false;
      }
      seen.add(effect);
      return true;
    });
  }

  /** Wires the switch handlers; with `info` (once connected) also updates the accessory details. */
  private configureScene(accessory: PlatformAccessory, effect: string, info?: NanoleafInfo): void {
    const { Service, Characteristic } = this.platform;
    const name = this.sceneName(effect);

    if (info) {
      const context: SceneContext = { serialNo: info.serialNo, host: this.host, effect };
      accessory.context = context;
      accessory.getService(Service.AccessoryInformation)!
        .setCharacteristic(Characteristic.Manufacturer, info.manufacturer || 'Nanoleaf')
        .setCharacteristic(Characteristic.Model, info.model || 'Nanoleaf')
        .setCharacteristic(Characteristic.SerialNumber, info.serialNo)
        .setCharacteristic(Characteristic.FirmwareRevision, info.firmwareVersion);
    }

    const service = accessory.getService(Service.Switch) ?? accessory.addService(Service.Switch, name);
    service.setCharacteristic(Characteristic.Name, name);
    service.getCharacteristic(Characteristic.On)
      .onGet(() => this.getSceneState(effect))
      .onSet((value) => this.setSceneState(effect, Boolean(value)));
  }

  private sceneName(effect: string): string {
    return toHomeKitName(`${this.platform.config.namePrefix ?? ''}${effect}`);
  }

  private isSceneActive(effect: string): boolean {
    return this.isOn && this.currentEffect === effect;
  }

  private getSceneState(effect: string): boolean {
    if (!this.reachable) {
      throw this.communicationFailure();
    }
    return this.isSceneActive(effect);
  }

  private async setSceneState(effect: string, on: boolean): Promise<void> {
    const client = this.client;
    if (!client || !this.reachable) {
      throw this.communicationFailure();
    }

    try {
      if (on) {
        await client.selectEffect(effect);
        if (!this.isOn) {
          await client.setOn(true);
        }
        this.isOn = true;
        this.setCurrentEffect(effect);
        this.log('info', `Scene "${effect}" activated.`);
      } else if (this.isSceneActive(effect)) {
        await this.deactivateScene(client, effect);
      }
    } catch (err) {
      this.log('error', `Could not ${on ? 'activate' : 'deactivate'} scene "${effect}": ${errorMessage(err)}`);
      throw this.communicationFailure();
    } finally {
      // HAP stores the written value after this handler returns, so correct the
      // switches (e.g. with offAction "none") only afterwards.
      setTimeout(() => {
        this.lastSwitchState.clear();
        this.updateSwitches();
      }, 100);
    }
  }

  private async deactivateScene(client: NanoleafClient, effect: string): Promise<void> {
    const offAction = this.platform.config.offAction ?? 'off';
    if (offAction === 'none') {
      return;
    }
    const previous = this.previousEffect;
    if (offAction === 'previous' && previous && previous !== effect && this.info?.effects.effectsList.includes(previous)) {
      await client.selectEffect(previous);
      this.setCurrentEffect(previous);
      this.log('info', `Scene "${effect}" deactivated, back to "${previous}".`);
      return;
    }
    await client.setOn(false);
    this.isOn = false;
    this.log('info', `Scene "${effect}" deactivated, lights turned off.`);
  }

  /** Pushes switch states to HomeKit, only for the switches whose state changed. */
  private updateSwitches(): void {
    if (!this.reachable) {
      return;
    }
    const { Service, Characteristic } = this.platform;
    for (const [effect, accessory] of this.scenes) {
      const active = this.isSceneActive(effect);
      if (this.lastSwitchState.get(effect) !== active) {
        this.lastSwitchState.set(effect, active);
        accessory.getService(Service.Switch)?.updateCharacteristic(Characteristic.On, active);
      }
    }
  }

  private communicationFailure(): Error {
    const { hap } = this.platform.api;
    return new hap.HapStatusError(hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }

  /** Resolves after `ms`, or immediately when the device is stopped. */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const signal = this.abort.signal;
      if (signal.aborted) {
        resolve();
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
    const name = this.info?.name ?? this.host;
    this.platform.log[level](`[${name}] ${message}`);
  }
}

/**
 * HomeKit names may only contain letters, numbers, spaces and . , ' -
 * and must start and end with a letter or number.
 */
export function toHomeKitName(name: string): string {
  const cleaned = name
    .replace(/[^\p{L}\p{N} .,'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  return cleaned || 'Nanoleaf Scene';
}

function normalizedSet(values: string[] | undefined): Set<string> {
  return new Set((values ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean));
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    return cause instanceof Error ? `${err.message} (${cause.message})` : err.message;
  }
  return String(err);
}
