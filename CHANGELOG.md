# Changelog

## 0.3.0

### Added
- **Scene selection on the settings page**: the scenes of every device are listed with ticks, so you choose which ones
  appear in HomeKit without typing names. *Add new scenes automatically* decides whether scenes created later in the
  Nanoleaf app show up too. Switches you keep stay the same accessories, so Home app scenes using them keep working.
- The plugin stores the scene list of each device (`nanoleaf-scene-bridge-scenes.json` in the Homebridge storage
  folder) for the settings page.
- The log reports switches removed because their scene was deselected or deleted.

## 0.2.1

### Fixed
- **No scenes on newer models** such as the Nanoleaf Outdoor String Lights (NL73K1, firmware 4.x): their device info
  has no scene list, so it is now read from the `/effects` endpoints.
- These models reset a third parallel connection (`ECONNRESET`); requests to a device are now sent one at a time.
- Devices without an event stream are only polled, without retrying the stream every 10 seconds.
- Scene names keep the characters HomeKit accepts (`&`, `!`, `(`, `:` …), e.g. *Relax & Refresh*.

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
