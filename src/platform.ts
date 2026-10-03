import path from 'node:path';
import net from 'node:net';

import { Bonjour, Browser, Service as BonjourService } from 'bonjour-service';
import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';

import { DEFAULT_PORT } from './client';
import { DeviceConfig, NanoleafDevice, OffAction, SceneContext } from './device';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { TokenStore } from './tokenStore';

export interface SceneBridgeConfig extends PlatformConfig {
  discovery?: boolean;
  devices?: DeviceConfig[];
  offAction?: OffAction;
  namePrefix?: string;
  include?: string[];
  exclude?: string[];
  pollInterval?: number;
}

/** mDNS answers can be lost (especially through a reflector between networks), so ask again a few times. */
const DISCOVERY_RETRIES_MS = [3_000, 10_000, 30_000];
const DISCOVERY_INTERVAL_MS = 60_000;

export class NanoleafSceneBridgePlatform implements DynamicPlatformPlugin {
  readonly Service: typeof Service;
  readonly Characteristic: typeof Characteristic;
  readonly tokens: TokenStore;

  /** Accessories restored from the cache that no device has claimed yet. */
  private readonly unclaimed = new Map<string, PlatformAccessory>();
  private readonly devices: NanoleafDevice[] = [];
  private readonly serials = new Map<string, NanoleafDevice>();
  /** Discovery keys of devices that turned out to be handled by another (configured) entry. */
  private readonly duplicateKeys = new Set<string>();
  private readonly timers: NodeJS.Timeout[] = [];
  private bonjour?: Bonjour;
  private browser?: Browser;
  private reportedUnclaimed = false;

  constructor(
    readonly log: Logging,
    readonly config: SceneBridgeConfig,
    readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.tokens = new TokenStore(path.join(api.user.storagePath(), 'nanoleaf-scene-bridge-tokens.json'));

    api.on('didFinishLaunching', () => this.start());
    api.on('shutdown', () => this.shutdown());
  }

  private get discoveryEnabled(): boolean {
    return this.config.discovery !== false;
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.unclaimed.set(accessory.UUID, accessory);
  }

  /** Hands a cached accessory to the device that owns it, or returns undefined if there is none. */
  claimAccessory(uuid: string): PlatformAccessory | undefined {
    const accessory = this.unclaimed.get(uuid);
    this.unclaimed.delete(uuid);
    return accessory;
  }

  /** Hands over the cached accessories last seen for a device, so they answer "No Response" until it connects. */
  claimAccessoriesForDevice(key: string, host: string): PlatformAccessory[] {
    const claimed = [...this.unclaimed.values()].filter((accessory) => {
      const context = accessory.context as Partial<SceneContext>;
      return context.deviceKey ? context.deviceKey === key : context.host === host;
    });
    claimed.forEach((accessory) => this.unclaimed.delete(accessory.UUID));
    return claimed;
  }

  /** All tokens configured or obtained so far. */
  knownTokens(): string[] {
    const configured = (this.config.devices ?? []).map((device) => device?.token);
    return [...new Set([...this.tokens.values(), ...configured].filter((token): token is string => !!token))];
  }

  /**
   * Records which device entry handles a serial number. Returns false when another entry
   * already does (e.g. a configured device that discovery found as well).
   */
  claimSerial(serialNo: string, device: NanoleafDevice): boolean {
    const owner = this.serials.get(serialNo);
    if (owner && owner !== device) {
      const index = this.devices.indexOf(device);
      if (index !== -1) {
        this.devices.splice(index, 1);
      }
      this.duplicateKeys.add(device.key);
      return false;
    }
    this.serials.set(serialNo, device);
    return true;
  }

  registerAccessories(accessories: PlatformAccessory[]): void {
    if (accessories.length > 0) {
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, accessories);
    }
  }

  unregisterAccessories(accessories: PlatformAccessory[]): void {
    if (accessories.length > 0) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, accessories);
    }
  }

  /**
   * Called after a device synced for the first time. Without discovery, once every configured
   * device has synced, cached accessories nobody claimed belong to removed devices. Waiting for
   * all devices keeps the accessories (and the Home app scenes using them) of a device that is
   * only temporarily offline. With discovery a missing device may still show up later, so its
   * accessories are kept.
   */
  onDeviceSynced(): void {
    if (this.unclaimed.size === 0 || !this.devices.every((device) => device.hasSynced)) {
      return;
    }
    if (this.discoveryEnabled) {
      if (!this.reportedUnclaimed) {
        this.reportedUnclaimed = true;
        this.log.info(`${this.unclaimed.size} cached scene switches belong to devices not found yet. ` +
          'If such a device is gone for good, remove its accessories in the Homebridge settings.');
      }
      return;
    }
    const stale = [...this.unclaimed.values()];
    this.unclaimed.clear();
    this.log.info(`Removing ${stale.length} stale accessories: ${stale.map((a) => a.displayName).join(', ')}`);
    this.unregisterAccessories(stale);
  }

  private start(): void {
    const configs = (this.config.devices ?? []).filter((device) => device?.host?.trim());
    for (const config of configs) {
      const host = config.host.trim();
      this.addDevice(new NanoleafDevice(this, { ...config, host, key: host }));
    }
    if (this.discoveryEnabled) {
      this.startDiscovery();
    } else if (configs.length === 0) {
      this.log.warn('Discovery is off and no devices are configured. Add a device host in the plugin settings.');
    }
  }

  private addDevice(device: NanoleafDevice): void {
    this.devices.push(device);
    device.start();
  }

  private startDiscovery(): void {
    try {
      this.bonjour = new Bonjour();
      this.browser = this.bonjour.find({ type: 'nanoleafapi' });
      this.browser.on('up', (service: BonjourService) => this.onDiscovered(service));
    } catch (err) {
      this.log.error(`Discovery could not start: ${err instanceof Error ? err.message : err}. ` +
        'Add your devices by IP address instead.');
      return;
    }
    this.log.info('Looking for Nanoleaf devices on the network...');

    const search = () => {
      this.browser?.update();
      this.browser?.services.forEach((service) => this.onDiscovered(service));
    };
    for (const delay of DISCOVERY_RETRIES_MS) {
      this.timers.push(setTimeout(search, delay));
    }
    this.timers.push(setInterval(search, DISCOVERY_INTERVAL_MS));
  }

  private onDiscovered(service: BonjourService): void {
    const addresses = service.addresses ?? [];
    const address = addresses.find((a) => net.isIPv4(a)) ?? addresses[0];
    if (!address) {
      return;
    }
    const port = service.port || DEFAULT_PORT;
    const txt = (service.txt ?? {}) as Record<string, unknown>;
    const key = String(txt.eui64 || txt.id || service.host || service.name);
    const hostname = (service.host ?? '').replace(/\.$/, '').toLowerCase();

    if (this.duplicateKeys.has(key)) {
      return;
    }
    const known = this.devices.find((device) => device.key === key);
    if (known) {
      known.updateAddress(address, port);
      return;
    }
    // Configured by hand already (by IP or hostname)? Then that entry handles it.
    if (this.devices.some((device) => device.host === address || device.host.toLowerCase() === hostname)) {
      return;
    }

    this.log.info(`Found ${service.name} (${txt.md ?? 'Nanoleaf'}) at ${address}.`);
    this.addDevice(new NanoleafDevice(this, { key, host: address, port, name: service.name }));
  }

  private shutdown(): void {
    this.timers.forEach((timer) => clearTimeout(timer));
    this.browser?.stop();
    this.bonjour?.destroy();
    this.devices.forEach((device) => device.stop());
  }
}
