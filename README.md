# Battery Capacity Tester

**Desktop application for discharge-testing batteries and measuring actual capacity in mAh**

[Features](#features) | [Installation](#installation) | [Hardware Setup](#hardware-setup) | [Usage](#usage) | [Building](#building)

---

## Overview

An Electron desktop app paired with ESP32-S2 firmware for real-time battery discharge testing. Connect over WiFi, start a test, and watch live voltage, current, and capacity data charted in real time. When the battery hits the cutoff voltage the test stops and the result is saved.

## Features

### Real-time Monitoring
- Live voltage, current, and power display
- Interactive discharge curve charting
- Capacity (mAh) calculation with running total
- Auto-detection of cutoff voltage

### Device Discovery
- Automatic device discovery via mDNS/Bonjour
- WiFi-based WebSocket communication
- No manual IP configuration needed

### Test History
- Save and load previous test results
- Compare discharge curves across batteries
- JSON-based test data storage

---

## Installation

### Download Pre-built Release

Pre-built binaries are available on the [Releases](https://github.com/raptorbuildsstuff/batterycapacity/releases) page:

- **Windows** — `.exe` installer
- **Linux** — `.AppImage`
- **macOS** — `.dmg`

### Build from Source

**Prerequisites:** [Node.js](https://nodejs.org/) 18+ with npm

```bash
cd electron-app
npm install
npm start
```

---

## Hardware Setup

### Required Components
- ESP32-S2 dev board
- 5 ohm 10W load resistor
- Relay module (active HIGH)
- 2x 4.5k ohm resistors (voltage divider)
- Status LED (optional)

### Wiring Diagram

```
Battery + ──┬──── Load (5 ohm) ──── Relay ──── Battery - / GND
            │                                    │
           4.5k                                  │
            │                                    │
            ├──── GPIO10 (ADC1_CH9)              │
            │                                    │
           4.5k                                  │
            │                                    │
            └────────────────────────────────────┘

Relay IN  → GPIO11
Relay VCC → 5V (VBUS)
Relay GND → GND
LED       → GPIO15 (active HIGH)
```

### ESP32-S2 Firmware

1. Install the [Arduino IDE](https://www.arduino.cc/en/software)
2. Add the ESP32 board manager URL:
   ```
   https://espressif.github.io/arduino-esp32/package_esp32_index.json
   ```
3. Install required libraries via Library Manager:
   - **WebSockets** (by Markus Sattler / Links2004)
   - **ArduinoJson** (by Benoit Blanchon, v7+)
4. Edit WiFi credentials in `battery_tester_esp32s2/battery_tester_esp32s2.ino`
5. Select board **"ESP32S2 Dev Module"** and upload

---

## Usage

1. Power on the ESP32-S2 — it connects to your WiFi and starts a WebSocket server
2. Open the Battery Tester desktop app
3. The app auto-discovers the device via mDNS
4. Connect and start a discharge test
5. The relay closes, current flows through the load resistor, and live data streams to the app
6. When the battery hits the cutoff voltage, the test stops and capacity is saved

---

## Building

```bash
cd electron-app
npm run build:win      # Windows (.exe)
npm run build:linux    # Linux (.AppImage)
npm run build:mac      # macOS (.dmg)
```

## Project Structure

```
battery_tester_esp32s2/      ESP32-S2 Arduino firmware
electron-app/
├── main.js                  Electron main process
├── preload.js               IPC bridge
├── renderer/
│   ├── index.html           UI markup
│   ├── app.js               Frontend logic
│   └── styles.css           Styling
├── lib/                     Bundled libraries
└── scripts/                 Build helpers
```

---

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test on your platform
5. Submit a pull request

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
