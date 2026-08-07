import importlib.util
import pathlib
import sys


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
    bridge = sensor_bridge.SensorBridge(distance_change_cm=30, inspection_window_seconds=30)
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
    bridge = sensor_bridge.SensorBridge(distance_change_cm=30, inspection_window_seconds=20)
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
