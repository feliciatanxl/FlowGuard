import importlib.util
import pathlib
import sys
import threading
import time


MODULE_PATH = pathlib.Path(__file__).resolve().parent / "sensor_bridge.py"
_spec = importlib.util.spec_from_file_location("sensor_bridge", MODULE_PATH)
sensor_bridge = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = sensor_bridge
_spec.loader.exec_module(sensor_bridge)


def test_parse_sensor_line_accepts_arduino_status_json():
    reading = sensor_bridge.parse_sensor_line(
        b'{"type":"sensor_status","pir_ready":true,"motion":true,'
        b'"distance_cm":146.2,"object_close":false,"uptime_ms":31000}\n'
    )

    assert reading == {
        "pir_ready": True,
        "motion": True,
        "distance_cm": 146.2,
        "object_close": False,
        "uptime_ms": 31000,
    }


def test_parse_sensor_line_ignores_boot_chatter_and_malformed_json():
    assert sensor_bridge.parse_sensor_line("System started") is None
    assert sensor_bridge.parse_sensor_line("{bad json") is None


def test_pir_motion_opens_inspection_window_without_using_object_close():
    bridge = sensor_bridge.SensorBridge(
        distance_change_cm=30,
        inspection_window_seconds=30,
        alert_sender=None,
    )
    state = bridge.apply_reading({
        "pir_ready": True,
        "motion": True,
        "distance_cm": 150,
        "object_close": False,
        "uptime_ms": 31000,
    }, now=100)

    assert state["inspection_active"] is True
    assert state["trigger"] == "pir"
    assert state["inspection_remaining_seconds"] == 30


def test_ultrasonic_distance_change_opens_inspection_window_from_stable_baseline():
    bridge = sensor_bridge.SensorBridge(
        distance_change_cm=30,
        inspection_window_seconds=20,
        alert_sender=None,
    )
    bridge.apply_reading({
        "pir_ready": True,
        "motion": False,
        "distance_cm": 180,
        "object_close": False,
        "uptime_ms": 1000,
    }, now=10)

    state = bridge.apply_reading({
        "pir_ready": True,
        "motion": False,
        "distance_cm": 120,
        "object_close": False,
        "uptime_ms": 1500,
    }, now=11)

    assert state["inspection_active"] is True
    assert state["trigger"] == "ultrasonic"
    assert state["distance_change_cm"] == 60


def test_sensor_trigger_posts_edge_alert_payload_to_sender():
    sent = []
    done = threading.Event()

    def fake_sender(payload):
        sent.append(payload)
        done.set()
        return {"sent": True, "status": 201}

    bridge = sensor_bridge.SensorBridge(
        distance_change_cm=30,
        inspection_window_seconds=20,
        sensor_alert_cooldown_seconds=60,
        alert_sender=fake_sender,
    )

    state = bridge.apply_reading({
        "pir_ready": True,
        "motion": True,
        "distance_cm": 120,
        "object_close": False,
        "uptime_ms": 31000,
    }, now=120)

    assert state["trigger"] == "pir"
    assert done.wait(1)
    assert sent[0]["alert_type"] == "PIR Motion Sensor"
    assert sent[0]["object_class"] == "motion detected"
    assert sent[0]["severity"] == "Medium"
    assert sent[0]["event_id"].endswith(":sensor:pir:2")
    assert sent[0]["sensor_metadata"]["motion"] is True
    assert sent[0]["sensor_metadata"]["inspection_active"] is True


def test_sensor_alert_cooldown_suppresses_repeated_same_trigger():
    sent = []
    first = threading.Event()

    def fake_sender(payload):
        sent.append(payload)
        first.set()
        return {"sent": True, "status": 201}

    bridge = sensor_bridge.SensorBridge(
        distance_change_cm=30,
        sensor_alert_cooldown_seconds=60,
        alert_sender=fake_sender,
    )

    bridge.apply_reading({
        "pir_ready": True,
        "motion": True,
        "distance_cm": 120,
        "object_close": False,
        "uptime_ms": 31000,
    }, now=120)
    assert first.wait(1)
    bridge.apply_reading({
        "pir_ready": True,
        "motion": True,
        "distance_cm": 119,
        "object_close": False,
        "uptime_ms": 32000,
    }, now=130)
    time.sleep(0.05)

    assert len(sent) == 1
