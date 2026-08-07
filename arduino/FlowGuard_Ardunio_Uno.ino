// FlowGuard PIR + ultrasonic sensor node.
//
// Emits ONE machine-readable JSON object per line, ~every 500 ms, for the
// SecurePi sensor bridge (edge/sensor_bridge.py) to parse. No third-party JSON
// library is used — the line is assembled with plain Serial.print() calls and
// F() string literals (kept in flash, so no heap/String fragmentation).
//
// Serial line schema (one line, terminated by "\n"):
//   {"type":"sensor_status",
//    "pir_ready":   bool,          // false during the 30 s PIR warm-up
//    "motion":      bool,          // PIR motion (always false until pir_ready)
//    "distance_cm": float | null,  // null when the ultrasonic gets no echo
//    "object_close":bool,          // distance <= distanceThresholdCm
//    "uptime_ms":   unsigned long} // millis() since boot
//
// HC-SR04 ultrasonic sensor
const int trigPin = 11;
const int echoPin = 10;
const int ultrasonicLedPin = 4;

// PIR motion sensor
const int pirPin = 7;
const int pirLedPin = 9;

// Ultrasonic LED turns on when an object is within this distance
const float distanceThresholdCm = 20.0;

// Allow PIR sensor to stabilise
const unsigned long pirWarmupTime = 30000;
unsigned long startTime;

unsigned long lastPrintTime = 0;

float readDistanceCm() {
  // Ensure trigger begins LOW
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);

  // Send a 10-microsecond trigger pulse
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);

  // Wait for echo, with a 30 ms timeout
  unsigned long duration = pulseIn(echoPin, HIGH, 30000UL);

  // No echo received
  if (duration == 0) {
    return -1;
  }

  // Convert travel time into distance
  return duration * 0.0343 / 2.0;
}

void setup() {
  Serial.begin(9600);

  pinMode(trigPin, OUTPUT);
  pinMode(echoPin, INPUT);
  pinMode(ultrasonicLedPin, OUTPUT);

  pinMode(pirPin, INPUT);
  pinMode(pirLedPin, OUTPUT);

  digitalWrite(trigPin, LOW);
  digitalWrite(ultrasonicLedPin, LOW);
  digitalWrite(pirLedPin, LOW);

  startTime = millis();

  Serial.println("System started");
  Serial.println("PIR warming up for 30 seconds...");
}

void loop() {
  // -------------------------
  // Ultrasonic sensor
  // -------------------------
  float distance = readDistanceCm();

  bool objectClose =
      distance > 0 &&
      distance <= distanceThresholdCm;

  digitalWrite(
      ultrasonicLedPin,
      objectClose ? HIGH : LOW
  );

  // -------------------------
  // PIR sensor
  // -------------------------
  bool pirReady =
      millis() - startTime >= pirWarmupTime;

  int motion = LOW;

  if (pirReady) {
    motion = digitalRead(pirPin);
  }

  digitalWrite(pirLedPin, motion);

  // -------------------------
  // Machine-readable status line (JSON, one object per line, ~2 Hz)
  // -------------------------
  // Built with Serial.print() + F() literals — no String concatenation, so no
  // heap fragmentation. distance_cm is null when there was no echo; motion is
  // reported false until the PIR has finished warming up.
  if (millis() - lastPrintTime >= 500) {
    lastPrintTime = millis();

    Serial.print(F("{\"type\":\"sensor_status\",\"pir_re ady\":"));
    Serial.print(pirReady ? F("true") : F("false"));

    Serial.print(F(",\"motion\":"));
    Serial.print((pirReady && motion == HIGH) ? F("true") : F("false"));

    Serial.print(F(",\"distance_cm\":"));
    if (distance < 0) {
      Serial.print(F("null"));
    } else {
      Serial.print(distance, 1);  // one decimal place
    }

    Serial.print(F(",\"object_close\":"));
    Serial.print(objectClose ? F("true") : F("false"));

    Serial.print(F(",\"uptime_ms\":"));
    Serial.print(millis());
    Serial.println(F("}"));
  }

  delay(100);
}