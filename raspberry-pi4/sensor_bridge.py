"""Arduino PIR + ultrasonic serial bridge for FlowGuard SecurePi.

The Arduino sketch emits one JSON object per line. This bridge keeps the latest
safe telemetry in memory and opens a bounded inspection window when either PIR
motion is reported or ultrasonic distance changes significantly from a stable
baseline. Sensor triggers never create an alert by themselves; camera detection
and recognition remain responsible for classifying what moved.
"""
import json
import os
import threading
import time
from dataclasses import dataclass, field


DEFAULT_SERIAL_PORT = os.getenv("EDGE_SERIAL_PORT", "/dev/ttyACM0")
DEFAULT_SERIAL_BAUD = int(os.getenv("EDGE_SERIAL_BAUD", "9600"))
DEFAULT_DISTANCE_CHANGE_CM = float(os.getenv("EDGE_SENSOR_DISTANCE_CHANGE_CM", "30"))
DEFAULT_INSPECTION_WINDOW_SECONDS = float(os.getenv("EDGE_INSPECTION_WINDOW_SECONDS", "30"))
DEFAULT_RECONNECT_SECONDS = float(os.getenv("EDGE_SERIAL_RECONNECT_SECONDS", "3"))
BASELINE_ALPHA = float(os.getenv("EDGE_SENSOR_BASELINE_ALPHA", "0.08"))


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
        }


class SensorBridge(threading.Thread):
    def __init__(
        self,
        port=DEFAULT_SERIAL_PORT,
        baud=DEFAULT_SERIAL_BAUD,
        distance_change_cm=DEFAULT_DISTANCE_CHANGE_CM,
        inspection_window_seconds=DEFAULT_INSPECTION_WINDOW_SECONDS,
        reconnect_seconds=DEFAULT_RECONNECT_SECONDS,
        serial_factory=None,
    ):
        super().__init__(daemon=True, name="flowguard-sensor-bridge")
        self.port = port
        self.baud = baud
        self.distance_change_cm = distance_change_cm
        self.inspection_window_seconds = inspection_window_seconds
        self.reconnect_seconds = reconnect_seconds
        self.serial_factory = serial_factory
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

            return state.as_dict(now)

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
