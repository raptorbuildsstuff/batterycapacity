# Battery Capacity Tester

A battery discharge tester with Arduino firmware and an Electron desktop app for real-time monitoring.

## Overview

Discharge-test batteries (Li-ion, NiMH, etc.) and measure their actual capacity in mAh. The firmware runs on an ESP32-S2, streams live voltage/current data over WebSocket, and the desktop app charts it in real time.

## Project Structure

```
battery_tester_esp32s2/      ESP32-S2 firmware (ADC + Ohm's law)
electron-app/                Electron desktop companion app
```

## Hardware

- ESP32-S2 dev board
- 2x 4.5k ohm resistors (voltage divider on ADC)
- Relay module (GPIO11)
- 5 ohm 10W load resistor
- No external sensor needed — uses built-in ADC + Ohm's law

## Firmware Setup

1. Install the [Arduino IDE](https://www.arduino.cc/en/software)
2. Add ESP32 board support: add `https://espressif.github.io/arduino-esp32/package_esp32_index.json` in Board Manager URLs
3. Install required libraries via Library Manager:
   - WebSockets (by Markus Sattler / Links2004)
   - ArduinoJson (by Benoit Blanchon, v7+)
4. Edit WiFi credentials in `battery_tester_esp32s2.ino`
5. Select "ESP32S2 Dev Module" and upload

## Desktop App

### Prerequisites
- [Node.js](https://nodejs.org/) (LTS recommended)

### Run from source
```bash
cd electron-app
npm install
npm start
```

### Build installer
```bash
cd electron-app
npm run dist
```

Builds for Windows (NSIS), macOS (DMG), and Linux (AppImage/DEB).

### Features
- Auto-discovers testers on your network via mDNS/Bonjour
- Real-time voltage, current, and power charts
- Test history with save/load

## How It Works

1. The firmware connects to your WiFi and starts a WebSocket server
2. The desktop app discovers it via mDNS and connects
3. Start a discharge test — the relay closes and current flows through the load resistor
4. Live measurements stream to the app until the battery hits the cutoff voltage
5. Final capacity (mAh) is calculated and the test is saved

## License

MIT
