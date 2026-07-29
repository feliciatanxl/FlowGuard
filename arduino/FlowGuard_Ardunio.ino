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
  // Serial Monitor output
  // -------------------------
  if (millis() - lastPrintTime >= 500) {
    lastPrintTime = millis();

    Serial.print("Distance: ");

    if (distance < 0) {
      Serial.print("No echo");
    } else {
      Serial.print(distance);
      Serial.print(" cm");
    }

    Serial.print(" | Ultrasonic LED: ");
    Serial.print(objectClose ? "ON" : "OFF");

    Serial.print(" | PIR: ");

    if (!pirReady) {
      Serial.print("Warming up");
    } else {
      Serial.print(motion == HIGH ? "Motion" : "No motion");
    }

    Serial.print(" | PIR LED: ");
    Serial.println(motion == HIGH ? "ON" : "OFF");
  }

  delay(100);
}