# Changelog

## 0.1.0

First release.

- One HomeKit switch per Nanoleaf scene, tracking the active scene
- Instant updates through the device's event stream, polling as a fallback
- Automatic pairing with the power button, token stored in the Homebridge storage folder
- Scene list sync: switches for new scenes are added, switches of deleted scenes are removed
- Accessories stay stable across restarts and IP address changes; offline devices show *No Response*
- `offAction`, `namePrefix`, `include`, `exclude` and `pollInterval` options
- `nanoleaf-scene-bridge` command line helper for pairing and listing scenes
