/*
 * Battery Tester Firmware — ESP32-S2 (ADC + Ohm's Law)
 *
 * Board: "ESP32S2 Dev Module"
 *   USB CDC On Boot: Enabled
 *
 * Board Manager URL:
 *   https://espressif.github.io/arduino-esp32/package_esp32_index.json
 *
 * Required Libraries (install via Library Manager):
 *   - WebSockets             (by Markus Sattler / Links2004)
 *   - ArduinoJson            (by Benoit Blanchon, v7+)
 *
 * Hardware — just 5 components:
 *   - ESP32-S2 dev board
 *   - 5Ω 10W load resistor
 *   - Relay module on GPIO11 (active HIGH)
 *   - 2× 4.5kΩ resistors (voltage divider)
 *   - Status LED on GPIO15 (active HIGH)
 *
 * Circuit:
 *   Battery + ──┬──── Load (5Ω) ──── Relay ──── Battery - / GND
 *               │                                    │
 *              4.5kΩ                                  │
 *               │                                    │
 *               ├──── GPIO10 (ADC1_CH9)               │
 *               │                                    │
 *              4.5kΩ                                  │
 *               │                                    │
 *               └────────────────────────────────────┘
 *
 *   Relay IN  → GPIO11
 *   Relay VCC → 5V (VBUS)
 *   Relay GND → GND
 *
 * How it works:
 *   ADC reads battery voltage through a 1:1 voltage divider (÷2).
 *   Current = V_battery / R_load  (Ohm's law, that's it)
 *   With relay open:  reads true open-circuit voltage (OCV)
 *   With relay closed: reads voltage under load → calculate I, P, mAh
 */

#include <WiFi.h>
#include <ESPmDNS.h>
#include <WebSocketsServer.h>
#include <ArduinoJson.h>
// No external ADC library needed — raw analogRead + manual calibration

// ─── Configuration ───────────────────────────────────────────────────────────

const char *WIFI_SSID = "";
const char *WIFI_PASS = "";

const char *MDNS_HOSTNAME = "batttest";

#define PIN_ADC    10   // ADC1_CH9 — voltage sense through divider
#define PIN_RELAY  11   // Relay control
#define PIN_LED    15   // Status LED (active HIGH)

const float LOAD_RESISTANCE     = 5.0;    // Ω — measure yours and update
const float DIVIDER_RATIO       = 2.0;    // 4.5k / 4.5k = 1:1, so ×2 to get real voltage
const float CUTOFF_VOLTAGE      = 2.80;   // V — stop discharge below this
const float MAX_VOLTAGE          = 4.30;   // V — refuse to test above this (safety)
const unsigned long SAMPLE_INTERVAL_MS = 500;
const int ADC_SAMPLES           = 32;     // Average this many ADC reads per measurement
const float ADC_CAL_FACTOR      = 0.8;    // Correction: real mV / reported mV (2098/2620)

// ─── Logging ─────────────────────────────────────────────────────────────────

#define LOG_LEVEL 4

static void logPrefix(const char *level) {
  unsigned long s = millis() / 1000;
  unsigned long m = s / 60;
  s %= 60;
  char buf[16];
  snprintf(buf, sizeof(buf), "[%3lu:%02lu] ", m, s);
  Serial.print(buf);
  Serial.print(level);
  Serial.print(' ');
}

#if LOG_LEVEL >= 1
  #define LOG_E(fmt, ...) do { logPrefix("ERR"); Serial.printf(fmt "\n", ##__VA_ARGS__); } while(0)
#else
  #define LOG_E(fmt, ...) ((void)0)
#endif
#if LOG_LEVEL >= 2
  #define LOG_W(fmt, ...) do { logPrefix("WRN"); Serial.printf(fmt "\n", ##__VA_ARGS__); } while(0)
#else
  #define LOG_W(fmt, ...) ((void)0)
#endif
#if LOG_LEVEL >= 3
  #define LOG_I(fmt, ...) do { logPrefix("INF"); Serial.printf(fmt "\n", ##__VA_ARGS__); } while(0)
#else
  #define LOG_I(fmt, ...) ((void)0)
#endif
#if LOG_LEVEL >= 4
  #define LOG_D(fmt, ...) do { logPrefix("DBG"); Serial.printf(fmt "\n", ##__VA_ARGS__); } while(0)
#else
  #define LOG_D(fmt, ...) ((void)0)
#endif

// ─── Globals ─────────────────────────────────────────────────────────────────

WebSocketsServer ws(81);
// No esp_adc_cal — using raw analogRead + manual calibration

enum TestState { IDLE, RUNNING, COMPLETE, ERROR_STATE };
TestState state = IDLE;

const char* stateStr() {
  switch (state) {
    case IDLE:        return "idle";
    case RUNNING:     return "running";
    case COMPLETE:    return "complete";
    case ERROR_STATE: return "error";
    default:          return "unknown";
  }
}

float voltage_V    = 0.0;
float current_mA   = 0.0;
float power_mW     = 0.0;
float capacity_mAh = 0.0;
float energy_mWh   = 0.0;
float ocVoltage    = 0.0;  // Open-circuit voltage (measured before relay close)
float internalResistance_mOhm = 0.0;

unsigned long testStartMs   = 0;
unsigned long lastSampleMs  = 0;
unsigned long testElapsedMs = 0;
unsigned long sampleCount   = 0;

// ─── ADC ─────────────────────────────────────────────────────────────────────

float readVoltage() {
  // Re-apply config each time (WiFi stack can reconfigure GPIOs)
  analogSetPinAttenuation(PIN_ADC, ADC_11db);

  // Collect samples with settling delay
  int readings[ADC_SAMPLES];
  for (int i = 0; i < ADC_SAMPLES; i++) {
    readings[i] = analogRead(PIN_ADC);
    delayMicroseconds(500);
  }

  // Sort for median filtering (simple insertion sort, only 32 elements)
  for (int i = 1; i < ADC_SAMPLES; i++) {
    int key = readings[i];
    int j = i - 1;
    while (j >= 0 && readings[j] > key) {
      readings[j + 1] = readings[j];
      j--;
    }
    readings[j + 1] = key;
  }

  // Use middle 50% — discard top and bottom quartiles as outliers
  int lo = ADC_SAMPLES / 4;
  int hi = (ADC_SAMPLES * 3) / 4;
  uint32_t sum = 0;
  for (int i = lo; i < hi; i++) {
    sum += readings[i];
  }
  float rawAvg = (float)sum / (hi - lo);

  float rawMV  = rawAvg * (3300.0 / 8191.0);
  float adcMV  = rawMV * ADC_CAL_FACTOR;
  float realMV = adcMV * DIVIDER_RATIO;

  LOG_D("ADC min=%d max=%d med=%d avg=%.0f -> %.0fmV -> batt=%.0fmV",
        readings[0], readings[ADC_SAMPLES - 1], readings[ADC_SAMPLES / 2],
        rawAvg, adcMV, realMV);

  return realMV / 1000.0;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

void setRelay(bool on) {
  digitalWrite(PIN_RELAY, on ? HIGH : LOW);
  digitalWrite(PIN_LED, on ? HIGH : LOW);
  LOG_D("Relay %s, LED %s", on ? "CLOSED" : "OPEN", on ? "ON" : "OFF");
}

void readSensor() {
  voltage_V = readVoltage();

  if (state == RUNNING) {
    current_mA = (voltage_V / LOAD_RESISTANCE) * 1000.0;  // Ohm's law: I = V / R
    power_mW   = voltage_V * current_mA;                   // P = V × I
  } else {
    current_mA = 0.0;
    power_mW   = 0.0;
  }

  // Clamp noise
  if (voltage_V < 0.05) voltage_V = 0.0;
  if (current_mA < 1.0) current_mA = 0.0;

  LOG_D("ADC  V=%.3fV  I=%.1fmA  P=%.1fmW  state=%s", voltage_V, current_mA, power_mW, stateStr());
}

void broadcastReading() {
  JsonDocument doc;
  doc["state"]    = stateStr();
  doc["voltage"]  = round(voltage_V * 1000.0) / 1000.0;
  doc["current"]  = round(current_mA * 100.0) / 100.0;
  doc["power"]    = round(power_mW * 100.0) / 100.0;
  doc["capacity"] = round(capacity_mAh * 100.0) / 100.0;
  doc["energy"]   = round(energy_mWh * 100.0) / 100.0;
  doc["elapsed"]  = testElapsedMs;
  doc["intR"]     = round(internalResistance_mOhm * 10.0) / 10.0;
  doc["cutoff"]   = CUTOFF_VOLTAGE;
  doc["ts"]       = millis();

  String json;
  serializeJson(doc, json);
  ws.broadcastTXT(json);
}

// ─── Test Control ────────────────────────────────────────────────────────────

void startTest() {
  if (state == RUNNING) {
    LOG_W("Start ignored — test already running");
    return;
  }

  // Read open-circuit voltage BEFORE closing relay (this works now!)
  LOG_I("Start requested, reading OCV...");
  ocVoltage = readVoltage();
  LOG_I("OCV = %.3fV", ocVoltage);

  if (ocVoltage < CUTOFF_VOLTAGE) {
    state = ERROR_STATE;
    LOG_E("Battery below cutoff (%.2fV < %.2fV)", ocVoltage, CUTOFF_VOLTAGE);
    return;
  }

  if (ocVoltage > MAX_VOLTAGE) {
    state = ERROR_STATE;
    LOG_E("Voltage too high (%.2fV > %.2fV) — check connections", ocVoltage, MAX_VOLTAGE);
    return;
  }

  // Reset accumulators
  capacity_mAh = 0.0;
  energy_mWh   = 0.0;
  internalResistance_mOhm = 0.0;
  testElapsedMs = 0;
  sampleCount  = 0;

  // Close relay to start discharge
  LOG_I("Closing relay...");
  setRelay(true);
  delay(250);

  // Read loaded voltage and calculate IR
  float loadedV = readVoltage();
  float loadedI = (loadedV / LOAD_RESISTANCE) * 1000.0;  // mA
  LOG_I("Under load: %.3fV @ %.1fmA", loadedV, loadedI);

  if (loadedI < 10.0) {
    setRelay(false);
    state = ERROR_STATE;
    LOG_E("No current detected (%.1fmA) — check battery/wiring", loadedI);
    return;
  }

  // Real internal resistance from OCV vs loaded voltage
  float vDrop = ocVoltage - loadedV;
  internalResistance_mOhm = (vDrop / (loadedI / 1000.0)) * 1000.0;
  LOG_I("IR = %.1f mOhm (OCV=%.3fV, loaded=%.3fV, drop=%.3fV)",
        internalResistance_mOhm, ocVoltage, loadedV, vDrop);

  testStartMs  = millis();
  lastSampleMs = testStartMs;

  state = RUNNING;
  LOG_I(">>> TEST STARTED  OCV=%.3fV  loaded=%.3fV @ %.1fmA  IR=%.1f mOhm <<<",
        ocVoltage, loadedV, loadedI, internalResistance_mOhm);
}

void stopTest(bool completed) {
  setRelay(false);
  TestState prev = state;
  state = completed ? COMPLETE : IDLE;

  if (completed) {
    LOG_I(">>> TEST COMPLETE  capacity=%.1f mAh  energy=%.1f mWh  time=%lus  samples=%lu <<<",
          capacity_mAh, energy_mWh, testElapsedMs / 1000, sampleCount);
  } else {
    LOG_W("Test stopped by user after %lus (was %s)", testElapsedMs / 1000, prev == RUNNING ? "running" : stateStr());
  }
  LOG_I("Final: %.3fV  %.1fmA  %.1f mAh  %.1f mWh", voltage_V, current_mA, capacity_mAh, energy_mWh);
}

// ─── WebSocket Events ────────────────────────────────────────────────────────

void onWebSocketEvent(uint8_t num, WStype_t type, uint8_t *payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      LOG_I("[WS] Client #%u connected", num);
      broadcastReading();
      break;

    case WStype_DISCONNECTED:
      LOG_I("[WS] Client #%u disconnected", num);
      break;

    case WStype_TEXT: {
      LOG_D("[WS] RX #%u: %.*s", num, (int)length, payload);

      JsonDocument doc;
      DeserializationError err = deserializeJson(doc, payload, length);
      if (err) {
        LOG_E("[WS] JSON parse error: %s", err.c_str());
        break;
      }

      const char *cmd = doc["cmd"];
      if (!cmd) {
        LOG_W("[WS] Message missing 'cmd' field");
        break;
      }

      LOG_I("[WS] Command: %s", cmd);

      if (strcmp(cmd, "start") == 0) {
        startTest();
      } else if (strcmp(cmd, "stop") == 0) {
        stopTest(false);
      } else if (strcmp(cmd, "status") == 0) {
        broadcastReading();
      } else {
        LOG_W("[WS] Unknown command: %s", cmd);
      }
      break;
    }

    default:
      break;
  }
}

// ─── Setup & Loop ────────────────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  unsigned long serialWait = millis();
  while (!Serial && (millis() - serialWait < 3000)) { delay(10); }
  delay(200);

  Serial.println("\n\n========================================");
  Serial.println("  Battery Tester (ESP32-S2) v2.0");
  Serial.println("  ADC + Ohm's Law — No INA219");
  Serial.println("========================================");
  LOG_I("Log level: %d  Free heap: %u bytes", LOG_LEVEL, ESP.getFreeHeap());

  // GPIO
  pinMode(PIN_RELAY, OUTPUT);
  pinMode(PIN_LED, OUTPUT);
  setRelay(false);
  LOG_I("GPIO: RELAY=%d  LED=%d  ADC=%d", PIN_RELAY, PIN_LED, PIN_ADC);
  LOG_I("Load: %.2f ohm  Divider: x%.1f  Cutoff: %.2fV", LOAD_RESISTANCE, DIVIDER_RATIO, CUTOFF_VOLTAGE);

  // ADC setup — raw analogRead, manual calibration via ADC_CAL_FACTOR
  pinMode(PIN_ADC, INPUT);                     // Explicitly set as input first
  analogReadResolution(13);                    // 13-bit: 0-8191
  analogSetPinAttenuation(PIN_ADC, ADC_11db);  // Full range ~0-3.1V
  LOG_I("ADC: GPIO%d, 12-bit, 11dB atten, cal=%.2f", PIN_ADC, ADC_CAL_FACTOR);

  // Warm up ADC — first reads are unstable, discard them
  for (int i = 0; i < 50; i++) { analogRead(PIN_ADC); delay(50); }
  LOG_D("ADC warmup done (%lums)", millis());

  // Initial voltage read
  float initV = readVoltage();
  LOG_I("Initial voltage: %.3fV (relay open = OCV)", initV);

  // Wi-Fi
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  LOG_I("Connecting to WiFi '%s'...", WIFI_SSID);
  unsigned long wifiStart = millis();
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
    if (millis() - wifiStart > 30000) {
      LOG_E("WiFi timeout — restarting");
      ESP.restart();
    }
  }
  Serial.println();
  LOG_I("WiFi connected! IP: %s  RSSI: %d dBm", WiFi.localIP().toString().c_str(), WiFi.RSSI());

  // mDNS
  if (MDNS.begin(MDNS_HOSTNAME)) {
    MDNS.addService("batttest", "tcp", 81);
    LOG_I("mDNS: %s.local -> port 81", MDNS_HOSTNAME);
  } else {
    LOG_E("mDNS failed");
  }

  // WebSocket
  ws.begin();
  ws.onEvent(onWebSocketEvent);
  LOG_I("WebSocket server on :81");

  LOG_I("Free heap: %u bytes — ready!", ESP.getFreeHeap());
  Serial.println("========================================\n");
}

void loop() {
  ws.loop();

  // WiFi watchdog
  static unsigned long lastWifiCheck = 0;
  unsigned long now = millis();
  if (now - lastWifiCheck > 10000) {
    lastWifiCheck = now;
    if (WiFi.status() != WL_CONNECTED) {
      LOG_W("WiFi lost, reconnecting...");
      WiFi.reconnect();
    }
  }

  if (now - lastSampleMs >= SAMPLE_INTERVAL_MS) {
    readSensor();

    if (state == RUNNING) {
      unsigned long dt = now - lastSampleMs;
      testElapsedMs = now - testStartMs;
      sampleCount++;

      float hours = dt / 3600000.0;
      capacity_mAh += current_mA * hours;
      energy_mWh   += power_mW * hours;

      // Progress log every 30s
      if (sampleCount % 60 == 0) {
        LOG_I("Progress: %lus  %.3fV  %.1fmA  %.1f mAh  %.1f mWh  [%lu]",
              testElapsedMs / 1000, voltage_V, current_mA, capacity_mAh, energy_mWh, sampleCount);
      }

      // Cutoff check
      if (voltage_V <= CUTOFF_VOLTAGE && current_mA > 10.0) {
        LOG_I("Cutoff: %.3fV <= %.2fV", voltage_V, CUTOFF_VOLTAGE);
        stopTest(true);
      }

      // Protection circuit cutoff — voltage drops to ~0 abruptly
      if (voltage_V < 0.1 && sampleCount > 10) {
        LOG_I("Protection circuit cutoff detected: %.3fV (sample %lu)", voltage_V, sampleCount);
        stopTest(true);
      }
    }

    lastSampleMs = now;
    broadcastReading();
  }
}
