# Changelog

## 0.2.0

### Added
- **Automatic discovery**: Nanoleaf devices on the network are found via mDNS without entering IP addresses
  (`discovery`, on by default). Address changes are followed automatically.
- Pairing through **Connect to API** in the Nanoleaf app is mentioned in the log and settings, as an alternative to the
  power button.

### Changed
- `devices` is optional; it is only needed for devices discovery cannot find. Existing configurations keep working,
  and a device that is both configured and discovered is handled once, without pairing again.
- With discovery on, cached switches of devices that are not found are kept instead of being removed.

## 0.1.0

First release.

- One HomeKit switch per Nanoleaf scene, tracking the active scene
- Instant updates through the device's event stream, polling as a fallback
- Automatic pairing with the power button, token stored in the Homebridge storage folder
- Scene list sync: switches for new scenes are added, switches of deleted scenes are removed
- Accessories stay stable across restarts and IP address changes; offline devices show *No Response*
- `offAction`, `namePrefix`, `include`, `exclude` and `pollInterval` options
- `nanoleaf-scene-bridge` command line helper for pairing and listing scenes
