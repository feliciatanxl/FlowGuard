"""Arduino PIR + ultrasonic serial bridge for FlowGuard SecurePi.

The Arduino sketch emits one JSON object per line. This bridge keeps the latest
safe telemetry in memory and opens a bounded inspection window when either PIR
motion is reported or ultrasonic distance changes significantly from a stable
baseline. When FlowGuard backend settings are configured, the same trigger also
creates a SecurePi edge alert so WhatsApp/security notifications can fire even
before camera classification has identified what moved.
"""
import json
import os
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field


DEFAULT_SERIAL_PORT = os.getenv("EDGE_SERIAL_PORT", "/dev/ttyACM0")
DEFAULT_SERIAL_BAUD = int(os.getenv("EDGE_SERIAL_BAUD", "9600"))
DEFAULT_DISTANCE_CHANGE_CM = float(os.getenv("EDGE_SENSOR_DISTANCE_CHANGE_CM", "30"))
DEFAULT_INSPECTION_WINDOW_SECONDS = float(os.getenv("EDGE_INSPECTION_WINDOW_SECONDS", "30"))
DEFAULT_RECONNECT_SECONDS = float(os.getenv("EDGE_SERIAL_RECONNECT_SECONDS", "3"))
DEFAULT_SENSOR_ALERT_COOLDOWN_SECONDS = float(os.getenv("EDGE_SENSOR_ALERT_COOLDOWN_SECONDS", "60"))
BASELINE_ALPHA = float(os.getenv("EDGE_SENSOR_BASELINE_ALPHA", "0.08"))
NODE_SERVER_URL = (
    os.getenv("FLOWGUARD_NODE_URL")
    or os.getenv("NODE_SERVER_URL")
    or os.getenv("FLOWGUARD_BACKEND_URL")
    or ""
).rstrip("/")
EDGE_INGEST_TOKEN = os.getenv("EDGE_INGEST_TOKEN", "")
EDGE_DEVICE_ID = os.getenv("EDGE_DEVICE_ID", "flowguard-pi-camera")
EDGE_ZONE_NAME = os.getenv("EDGE_ZONE_NAME", os.getenv("AI_ZONE_NAME", "SecurePi Sensor Zone"))
EDGE_CAMERA_LOCATION = os.getenv("EDGE_CAMERA_LOCATION", "Pi Camera Module 3")
HTTP_TIMEOUT_SECONDS = float(os.getenv("EDGE_ALERT_HTTP_TIMEOUT_SECONDS", "5"))


def _finite_distance(value):
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def parse_sensor_line(line):
    """Return the Arduino sensor JSON object, or None for boot/status chatter."""
    if isinstance(line, bytes):
        line = line.decode("utf-8", errors="replace")
    text = str(line or "").strip()
    if not text or not text.startswith("{"):
        return None
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return None
    if data.get("type") != "sensor_status":
        return None
    return {
        "pir_ready": bool(data.get("pir_ready")),
        "motion": bool(data.get("motion")),
        "distance_cm": _finite_distance(data.get("distance_cm")),
        "object_close": bool(data.get("object_close")),
        "uptime_ms": int(data.get("uptime_ms") or 0),
    }


def _safe_event_part(value):
    text = str(value or "").strip().lower()
    cleaned = "".join(ch if ch.isalnum() or ch in "._:-" else "-" for ch in text)
    return cleaned.strip("-")[:80] or "sensor"


def _alert_labels(trigger):
    if trigger == "pir":
        return "PIR Motion Sensor", "motion detected"
    if trigger == "ultrasonic":
        return "Ultrasonic Sensor", "object distance change"
    return "PIR + Ultrasonic Sensor", "combined sensor trigger"


def build_sensor_alert_payload(state, trigger, now=None, cooldown_seconds=DEFAULT_SENSOR_ALERT_COOLDOWN_SECONDS):
    now = time.time() if now is None else now
    alert_type, object_class = _alert_labels(trigger)
    event_bucket = int(now // max(cooldown_seconds, 1))
    device_id = EDGE_DEVICE_ID
    sensor_metadata = {
        "trigger": trigger,
        "pir_ready": state.pir_ready,
        "motion": state.motion,
        "distance_cm": state.distance_cm,
        "object_close": state.object_close,
        "baseline_distance_cm": state.baseline_distance_cm,
        "distance_change_cm": state.distance_change_cm,
        "inspection_active": now < state.inspection_until,
        "inspection_remaining_seconds": round(max(0, state.inspection_until - now), 1),
        "uptime_ms": state.uptime_ms,
    }
    return {
        "event_id": ":".join([
            _safe_event_part(device_id),
            "sensor",
            _safe_event_part(trigger),
            str(event_bucket),
        ]),
        "zone_name": EDGE_ZONE_NAME,
        "camera_location": EDGE_CAMERA_LOCATION,
        "alert_type": alert_type,
        "object_class": object_class,
        "severity": "Medium",
        "status": "Active",
        "duration_seconds": 0,
        "device_id": device_id,
        "sensor_metadata": sensor_metadata,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
    }


def post_sensor_alert(payload):
    if not NODE_SERVER_URL or not EDGE_INGEST_TOKEN:
        return {"sent": False, "reason": "edge alert endpoint is not configured"}
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{NODE_SERVER_URL}/api/edge/detection-alerts",
        data=body,
        headers={
            "Authorization": f"Bearer {EDGE_INGEST_TOKEN}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_SECONDS) as res:
            return {"sent": 200 <= res.status < 300, "status": res.status}
    except urllib.error.HTTPError as err:
        return {"sent": False, "status": err.code, "reason": str(err)[:160]}
    except Exception as err:
        return {"sent": False, "reason": str(err)[:160]}


@dataclass
class SensorState:
    connected: bool = False
    serial_port: str = DEFAULT_SERIAL_PORT
    last_error: str | None = None
    last_seen_at: float | None = None
    pir_ready: bool = False
    motion: bool = False
    distance_cm: float | None = None
    object_close: bool = False
    baseline_distance_cm: float | None = None
    distance_change_cm: float | None = None
    trigger: str | None = None
    inspection_until: float = 0.0
    malformed_lines: int = 0
    uptime_ms: int = 0
    last_alert_at: float = 0.0
    last_alert_trigger: str | None = None
    last_alert_error: str | None = None

    def as_dict(self, now=None):
        now = time.time() if now is None else now
        inspection_active = now < self.inspection_until
        return {
            "connected": self.connected,
            "serial_port": self.serial_port,
            "last_error": self.last_error,
            "last_seen_age_seconds": None if self.last_seen_at is None else round(max(0, now - self.last_seen_at), 2),
            "pir_ready": self.pir_ready,
            "pir": self.motion,
            "motion": self.motion,
            "distance_cm": self.distance_cm,
            "object_close": self.object_close,
            "baseline_distance_cm": self.baseline_distance_cm,
            "distance_change_cm": self.distance_change_cm,
            "trigger": self.trigger,
            "inspection_active": inspection_active,
            "inspection_remaining_seconds": round(max(0, self.inspection_until - now), 1),
            "malformed_lines": self.malformed_lines,
            "uptime_ms": self.uptime_ms,
            "last_alert_trigger": self.last_alert_trigger,
            "last_alert_age_seconds": None if not self.last_alert_at else round(max(0, now - self.last_alert_at), 2),
            "last_alert_error": self.last_alert_error,
        }


class SensorBridge(threading.Thread):
    def __init__(
        self,
        port=DEFAULT_SERIAL_PORT,
        baud=DEFAULT_SERIAL_BAUD,
        distance_change_cm=DEFAULT_DISTANCE_CHANGE_CM,
        inspection_window_seconds=DEFAULT_INSPECTION_WINDOW_SECONDS,
        reconnect_seconds=DEFAULT_RECONNECT_SECONDS,
        sensor_alert_cooldown_seconds=DEFAULT_SENSOR_ALERT_COOLDOWN_SECONDS,
        serial_factory=None,
        alert_sender=post_sensor_alert,
    ):
        super().__init__(daemon=True, name="flowguard-sensor-bridge")
        self.port = port
        self.baud = baud
        self.distance_change_cm = distance_change_cm
        self.inspection_window_seconds = inspection_window_seconds
        self.reconnect_seconds = reconnect_seconds
        self.sensor_alert_cooldown_seconds = sensor_alert_cooldown_seconds
        self.serial_factory = serial_factory
        self.alert_sender = alert_sender
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._state = SensorState(serial_port=port)

    def stop(self):
        self._stop_event.set()

    def snapshot(self):
        with self._lock:
            state = SensorState(**self._state.__dict__)
        return state.as_dict()

    def apply_reading(self, reading, now=None):
        now = time.time() if now is None else now
        distance = _finite_distance(reading.get("distance_cm"))
        trigger_reasons = []
        alert_payload = None

        with self._lock:
            state = self._state
            state.connected = True
            state.last_error = None
            state.last_seen_at = now
            state.pir_ready = bool(reading.get("pir_ready"))
            state.motion = bool(reading.get("motion"))
            state.object_close = bool(reading.get("object_close"))
            state.distance_cm = distance
            state.uptime_ms = int(reading.get("uptime_ms") or 0)

            if distance is not None:
                if state.baseline_distance_cm is None:
                    state.baseline_distance_cm = distance
                    state.distance_change_cm = 0.0
                else:
                    state.distance_change_cm = abs(distance - state.baseline_distance_cm)
                    if state.distance_change_cm >= self.distance_change_cm:
                        trigger_reasons.append("ultrasonic")
                    else:
                        state.baseline_distance_cm = (
                            (1 - BASELINE_ALPHA) * state.baseline_distance_cm
                            + BASELINE_ALPHA * distance
                        )

            if state.motion:
                trigger_reasons.append("pir")

            if trigger_reasons:
                state.trigger = "_and_".join(sorted(set(trigger_reasons)))
                state.inspection_until = max(
                    state.inspection_until,
                    now + self.inspection_window_seconds,
                )
                cooldown_elapsed = now - state.last_alert_at >= self.sensor_alert_cooldown_seconds
                trigger_changed = state.trigger != state.last_alert_trigger
                if self.alert_sender and (cooldown_elapsed or trigger_changed):
                    alert_payload = build_sensor_alert_payload(
                        state,
                        state.trigger,
                        now,
                        self.sensor_alert_cooldown_seconds,
                    )
                    state.last_alert_at = now
                    state.last_alert_trigger = state.trigger
                    state.last_alert_error = None

            snapshot = state.as_dict(now)

        if alert_payload:
            threading.Thread(
                target=self._send_alert,
                args=(alert_payload,),
                daemon=True,
                name="flowguard-sensor-alert",
            ).start()

        return snapshot

    def _send_alert(self, payload):
        result = self.alert_sender(payload)
        if result and result.get("sent"):
            return
        with self._lock:
            self._state.last_alert_error = (result or {}).get("reason") or f"HTTP {(result or {}).get('status')}"

    def _open_serial(self):
        if self.serial_factory:
            return self.serial_factory(self.port, self.baud)
        import serial  # imported lazily so tests/dev machines do not need pyserial
        return serial.Serial(self.port, self.baud, timeout=1)

    def run(self):
        while not self._stop_event.is_set():
            serial_conn = None
            try:
                serial_conn = self._open_serial()
                with self._lock:
                    self._state.connected = True
                    self._state.last_error = None
                while not self._stop_event.is_set():
                    raw = serial_conn.readline()
                    if not raw:
                        continue
                    reading = parse_sensor_line(raw)
                    if reading is None:
                        with self._lock:
                            self._state.malformed_lines += 1
                        continue
                    self.apply_reading(reading)
            except Exception as err:
                with self._lock:
                    self._state.connected = False
                    self._state.last_error = str(err)[:160]
                self._stop_event.wait(self.reconnect_seconds)
            finally:
                try:
                    if serial_conn is not None:
                        serial_conn.close()
                except Exception:
                    pass
