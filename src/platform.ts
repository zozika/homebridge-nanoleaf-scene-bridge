import path from 'node:path';

import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';

import { DeviceConfig, NanoleafDevice, OffAction } from './device';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { TokenStore } from './tokenStore';

export interface SceneBridgeConfig extends PlatformConfig {
  devices?: DeviceConfig[];
  offAction?: OffAction;
  namePrefix?: string;
  include?: string[];
  exclude?: string[];
  pollInterval?: number;
}

export class NanoleafSceneBridgePlatform implements DynamicPlatformPlugin {
  readonly Service: typeof Service;
  readonly Characteristic: typeof Characteristic;
  readonly tokens: TokenStore;

  /** Accessories restored from the cache that no device has claimed yet. */
  private readonly unclaimed = new Map<string, PlatformAccessory>();
  private readonly devices: NanoleafDevice[] = [];

  constructor(
    readonly log: Logging,
    readonly config: SceneBridgeConfig,
    readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.tokens = new TokenStore(path.join(api.user.storagePath(), 'nanoleaf-scene-bridge-tokens.json'));

    api.on('didFinishLaunching', () => this.start());
    api.on('shutdown', () => this.devices.forEach((device) => device.stop()));
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

  /** Hands over the cached accessories last seen at `host`, so they answer "No Response" until the device connects. */
  claimAccessoriesByHost(host: string): PlatformAccessory[] {
    const claimed = [...this.unclaimed.values()].filter((accessory) => accessory.context?.host === host);
    claimed.forEach((accessory) => this.unclaimed.delete(accessory.UUID));
    return claimed;
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
   * Called after a device synced for the first time. Once every device has synced,
   * cached accessories nobody claimed belong to deleted scenes or removed devices.
   * Waiting for all devices keeps the accessories (and the Home app scenes using
   * them) of a device that is only temporarily offline.
   */
  onDeviceSynced(): void {
    if (this.unclaimed.size === 0 || !this.devices.every((device) => device.hasSynced)) {
      return;
    }
    const stale = [...this.unclaimed.values()];
    this.unclaimed.clear();
    this.log.info(`Removing ${stale.length} stale accessories: ${stale.map((a) => a.displayName).join(', ')}`);
    this.unregisterAccessories(stale);
  }

  private start(): void {
    const configs = (this.config.devices ?? []).filter((device) => device?.host?.trim());
    if (configs.length === 0) {
      this.log.warn('No Nanoleaf devices configured. Add at least one device host in the plugin settings.');
      return;
    }
    for (const config of configs) {
      const device = new NanoleafDevice(this, { ...config, host: config.host.trim() });
      this.devices.push(device);
    }
    this.devices.forEach((device) => device.start());
  }
}
