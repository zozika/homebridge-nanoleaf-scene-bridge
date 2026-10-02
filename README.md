# homebridge-nanoleaf-scene-bridge

A [Homebridge](https://homebridge.io) plugin (v1.8+ and v2) that brings the **scenes** of your Wi-Fi Nanoleaf
devices (including Matter over Wi-Fi models) into Apple Home. Every scene becomes a switch that shows whether the
scene is active, so you can build real Home app scenes, automations and Siri commands from them.

[![npm](https://img.shields.io/npm/v/homebridge-nanoleaf-scene-bridge)](https://www.npmjs.com/package/homebridge-nanoleaf-scene-bridge)
[![Build and test](https://github.com/zozika/homebridge-nanoleaf-scene-bridge/actions/workflows/build.yml/badge.svg)](https://github.com/zozika/homebridge-nanoleaf-scene-bridge/actions/workflows/build.yml)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-☕-yellow)](https://www.buymeacoffee.com/palmaiz)

> 🇭🇺 Magyar leírás lent: [Magyarul](#magyarul)

## Why switches?

Homebridge cannot create Home app scenes: HomeKit scenes live in your Home (iCloud) and can only be created by you or
by an iOS app. This plugin exposes one switch per Nanoleaf scene; you then create a Home app scene once per Nanoleaf
scene that turns its switch on. From then on it works like any other HomeKit scene.

## Features

- One switch per Nanoleaf scene; the switch of the active scene is on, all others are off (radio-button behaviour)
- Instant updates when the scene is changed in the Nanoleaf app or on the device (server-sent events), with polling as a fallback
- New scenes get a switch automatically, deleted scenes are removed
- Stable accessories: the switches keep their identity across restarts and IP address changes, so your Home app scenes keep working
- When the device is offline the switches show *No Response* instead of being deleted
- Automatic pairing: hold the power button, the token is stored for you
- Configurable behaviour when the active scene's switch is turned off: lights off, back to the previous scene, or nothing
- Optional name prefix and include / exclude lists
- Scene names are cleaned up for HomeKit (e.g. emoji are removed)
- Multiple devices
- No runtime dependencies

Thread-only Nanoleaf devices are not supported, because they do not offer the local Wi-Fi OpenAPI.

## Install

From the Homebridge UI search for `homebridge-nanoleaf-scene-bridge`, or:

```bash
npm install -g homebridge-nanoleaf-scene-bridge
```

## Setup

1. Give your Nanoleaf a fixed IP address in your router (DHCP reservation).
2. Add the device's IP address in the plugin settings and restart Homebridge. The log shows *Not paired yet*.
3. Hold the power button on the Nanoleaf for 5–7 seconds until the light flashes. The log shows *Paired successfully*.
4. In the Home app, move the scene switches to a room of their own (e.g. "Nanoleaf") so they don't clutter your Home view.
5. For each Nanoleaf scene you want: Home app → **+** → **Add Scene** → **Custom**, name it (e.g. *Aurora*), add the
   *Aurora* switch and set it to **On**. You can add other accessories to the same scene too.

## Configuration

```json
{
  "platform": "NanoleafSceneBridge",
  "name": "Nanoleaf Scenes",
  "devices": [
    { "host": "192.168.1.50" }
  ],
  "offAction": "off"
}
```

| Key | Description |
| --- | --- |
| `devices[].host` | IP address or `.local` hostname of the device |
| `devices[].port` | API port, default `16021` |
| `devices[].token` | Optional auth token. Leave empty to pair automatically; the token is saved to `nanoleaf-scene-bridge-tokens.json` in the Homebridge storage folder |
| `offAction` | Turning off the active scene's switch: `off` turns the lights off (default), `previous` switches back to the previous scene, `none` does nothing |
| `namePrefix` | Text put in front of every scene name, e.g. `"Nanoleaf "` |
| `include` | Only expose these scenes (case-insensitive). Empty means all |
| `exclude` | Hide these scenes |
| `pollInterval` | Fallback polling interval in seconds, default `15`, minimum `5` |

## Troubleshooting

- **Pairing does not complete.** Pairing mode lasts about 30 seconds; the plugin retries every 5 seconds while it waits.
  Make sure Homebridge can reach the device on port 16021 (same network / VLAN routing).
- **"The auth token was rejected".** The device was reset or the token was revoked. Hold the power button again to pair.
- **Command line helper.** `npx nanoleaf-scene-bridge pair <host>` requests a token,
  `npx nanoleaf-scene-bridge info <host> <token>` lists the scenes the device reports.

## Support

If this plugin lights up your home, you can [buy me a coffee](https://www.buymeacoffee.com/palmaiz) ☕. Thank you!

## Development

```bash
npm install
npm test        # builds and runs the tests
npm run watch
```

---

## Magyarul

A plugin a Wi-Fi-s (a Matter over Wi-Fi-s is) Nanoleaf eszközök **scene-jeit** hozza át az Apple Home-ba. Minden
scene-ből egy kapcsoló lesz, amely mutatja, hogy a scene aktív-e. Ezekből a Home appban rendes jeleneteket,
automatizálásokat és Siri-parancsokat készíthetsz.

### Miért kapcsolók?

Homebridge plugin nem tud Home app jelenetet létrehozni, ezt csak te vagy egy iOS app teheti meg. Ezért minden Nanoleaf
scene-hez egyszer létre kell hoznod egy jelenetet a Home appban, amely bekapcsolja a scene kapcsolóját. Utána úgy
működik, mint bármely más HomeKit jelenet.

### Tudja

- Scene-enként egy kapcsoló; mindig az aktív scene kapcsolója van bekapcsolva
- A Nanoleaf appban vagy az eszközön végzett váltást azonnal követi
- Új scene-hez automatikusan új kapcsoló jön létre, törölt scene-hez a kapcsoló eltűnik
- A kapcsolók újraindítás és IP-cím változás után is ugyanazok maradnak, így a Home app jelenetek nem vesznek el
- Offline eszköznél a kapcsolók „Nem válaszol” állapotba kerülnek, nem törlődnek
- Automatikus párosítás a bekapcsológombbal
- Beállítható, mi történjen, ha az aktív scene kapcsolóját kikapcsolod
- Név-előtag, valamint a mutatott és rejtett scene-ek listája

A csak Threadet tudó Nanoleaf eszközöket nem támogatja.

### Beállítás

1. Adj fix IP-címet a Nanoleafnek a routerben.
2. Add meg az IP-címet a plugin beállításaiban, és indítsd újra a Homebridge-et.
3. Tartsd nyomva a Nanoleaf bekapcsológombját 5–7 másodpercig, amíg a fény villogni nem kezd. A logban megjelenik: *Paired successfully*.
4. A Home appban tedd a kapcsolókat egy külön szobába (pl. „Nanoleaf”).
5. Minden kívánt scene-hez: Home app → **+** → **Jelenet hozzáadása** → **Egyéni**, nevezd el (pl. *Aurora*), add hozzá
   az *Aurora* kapcsolót, és állítsd **BE**-re.

### Hibaelhárítás

- **Nem sikerül a párosítás:** a párosítási mód kb. 30 másodpercig tart, a plugin 5 másodpercenként próbálkozik.
  Ellenőrizd, hogy a Homebridge eléri-e az eszközt a 16021-es porton.
- **„The auth token was rejected”:** az eszközt visszaállították, vagy a token érvénytelen lett. Párosítsd újra a gombbal.

### Támogatás

Ha a plugin bevilágítja az otthonod, meghívhatsz egy [kávéra](https://www.buymeacoffee.com/palmaiz) ☕. Köszönöm!
