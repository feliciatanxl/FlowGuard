#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>

// ===============================
// Ultrasonic pins
// ===============================
const int TRIG_PIN = 11;
const int ECHO_PIN = 10;

// ===============================
// Output pins
// ===============================
const int BUZZER_PIN = 17;
const int LED_PIN = 19;

// ===============================
// TFT pins
// ===============================
const int TFT_SCLK = 12;
const int TFT_MOSI = 4;
const int TFT_RST  = 8;
const int TFT_DC   = 9;
const int TFT_CS   = 15;

// Custom SPI connection
Adafruit_ST7735 tft(&SPI, TFT_CS, TFT_DC, TFT_RST);

// Alert when object is this close
const float ALERT_DISTANCE_CM = 20.0;

// Used to prevent the entire screen from flashing
bool previousAlertState = false;
bool firstScreenDraw = true;

// Function declarations
float getDistanceCM();
void drawNormalScreen();
void drawAlertScreen();
void updateDistanceDisplay(float distance, bool alert);
void setAlarm(bool enabled);

void setup() {
  Serial.begin(115200);

  // Ultrasonic setup
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  digitalWrite(TRIG_PIN, LOW);

  // Output setup
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);

  digitalWrite(LED_PIN, LOW);
  noTone(BUZZER_PIN);

  // Start custom SPI:
  // SCLK, MISO, MOSI, CS
  SPI.begin(TFT_SCLK, -1, TFT_MOSI, TFT_CS);

  // Start ST7735 TFT
  tft.initR(INITR_BLACKTAB);
  tft.setRotation(1);
  tft.setTextWrap(false);

  drawNormalScreen();

  Serial.println("FlowGuard distance monitor started");
}

void loop() {
  float distance = getDistanceCM();

  bool alertState =
      distance > 0 &&
      distance <= ALERT_DISTANCE_CM;

  // Redraw full screen only when status changes
  if (firstScreenDraw || alertState != previousAlertState) {
    if (alertState) {
      drawAlertScreen();
    } else {
      drawNormalScreen();
    }

    previousAlertState = alertState;
    firstScreenDraw = false;
  }

  // Update live distance number
  updateDistanceDisplay(distance, alertState);

  // Control LED and buzzer
  setAlarm(alertState);

  if (distance > 0) {
    Serial.print("Distance: ");
    Serial.print(distance, 1);
    Serial.println(" cm");
  } else {
    Serial.println("No ultrasonic reading");
  }

  delay(150);
}

// ======================================
// Measure ultrasonic distance
// ======================================
float getDistanceCM() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);

  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);

  digitalWrite(TRIG_PIN, LOW);

  unsigned long duration =
      pulseIn(ECHO_PIN, HIGH, 30000);

  if (duration == 0) {
    return -1;
  }

  return duration * 0.0343 / 2.0;
}

// ======================================
// Normal FlowGuard screen
// ======================================
void drawNormalScreen() {
  tft.fillScreen(ST77XX_BLACK);

  // Header
  tft.fillRect(0, 0, tft.width(), 24, ST77XX_BLUE);

  tft.setTextColor(ST77XX_WHITE);
  tft.setTextSize(2);
  tft.setCursor(18, 5);
  tft.print("FLOWGUARD");

  // Status
  tft.setTextColor(ST77XX_GREEN);
  tft.setTextSize(2);
  tft.setCursor(40, 31);
  tft.print("NORMAL");

  tft.setTextColor(ST77XX_WHITE);
  tft.setTextSize(1);
  tft.setCursor(46, 52);
  tft.print("DISTANCE");

  tft.setTextColor(ST77XX_CYAN);
  tft.setTextSize(1);
  tft.setCursor(25, 112);
  tft.print("Threshold: ");

  tft.print(ALERT_DISTANCE_CM, 0);
  tft.print(" cm");
}

// ======================================
// Red FlowGuard alert screen
// ======================================
void drawAlertScreen() {
  tft.fillScreen(ST77XX_RED);

  // Header
  tft.fillRect(0, 0, tft.width(), 24, ST77XX_BLACK);

  tft.setTextColor(ST77XX_WHITE);
  tft.setTextSize(2);
  tft.setCursor(18, 5);
  tft.print("FLOWGUARD");

  tft.setTextColor(ST77XX_YELLOW);
  tft.setTextSize(2);
  tft.setCursor(42, 30);
  tft.print("ALERT!");

  tft.setTextColor(ST77XX_WHITE);
  tft.setTextSize(1);
  tft.setCursor(30, 51);
  tft.print("OBJECT TOO CLOSE");

  tft.setCursor(25, 112);
  tft.print("Threshold: ");

  tft.print(ALERT_DISTANCE_CM, 0);
  tft.print(" cm");
}

// ======================================
// Update live distance number
// ======================================
void updateDistanceDisplay(float distance, bool alert) {
  uint16_t backgroundColor =
      alert ? ST77XX_RED : ST77XX_BLACK;

  // Clear only the number area
  tft.fillRect(
    0,
    64,
    tft.width(),
    42,
    backgroundColor
  );

  if (distance <= 0) {
    tft.setTextColor(ST77XX_YELLOW);
    tft.setTextSize(2);
    tft.setCursor(19, 77);
    tft.print("NO READING");
    return;
  }

  // Display live distance
  tft.setTextColor(ST77XX_WHITE);
  tft.setTextSize(3);

  // Move cursor based on number size
  if (distance < 10) {
    tft.setCursor(20, 72);
  } else if (distance < 100) {
    tft.setCursor(8, 72);
  } else {
    tft.setCursor(0, 72);
  }

  tft.print(distance, 1);

  tft.setTextSize(2);
  tft.print("cm");
}

// ======================================
// LED and buzzer alarm
// ======================================
void setAlarm(bool enabled) {
  if (enabled) {
    digitalWrite(LED_PIN, HIGH);

    // Works with a passive buzzer
    tone(BUZZER_PIN, 2000);
  } else {
    digitalWrite(LED_PIN, LOW);
    noTone(BUZZER_PIN);
  }
}