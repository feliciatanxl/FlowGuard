"""Pi camera server tests — shared latest-frame cache architecture.

Run from the repo root with the ai-service virtualenv (has cv2 + flask):
    ai-service/.venv/Scripts/python -m pytest "raspberry-pi/Tan Xiu Li, Felicia" -v

The module under test is import-safe off-device: Picamera2 is only imported
inside main(), and CaptureLoop takes any camera object with capture_array().
"""
import importlib.util
import inspect
import pathlib
import threading
import time

import pytest

MODULE_PATH = pathlib.Path(__file__).resolve().parent / "pi_camera_steam.py"
_spec = importlib.util.spec_from_file_location("pi_camera_steam", MODULE_PATH)
pi = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pi)

ALLOWED_ORIGIN = pi.DEFAULT_FLOWGUARD_FRONTEND_ORIGIN
UNAPPROVED_ORIGIN = "https://unapproved.example"


class FakeCamera:
    """Stands in for Picamera2: counts every capture_array call."""

    def __init__(self):
        self.capture_calls = 0

    def capture_array(self):
        self.capture_calls += 1
        return f"raw-frame-{self.capture_calls}"


def fake_encode(frame, quality=80):
    return f"jpeg::{frame}".encode()


class FakeSensorBridge:
    def snapshot(self):
        return {
            "connected": True,
            "pir": True,
            "motion": True,
            "distance_cm": 146.2,
            "distance_change_cm": 82.4,
            "trigger": "pir_and_ultrasonic",
            "inspection_active": True,
        }


@pytest.fixture
def cache():
    return pi.FrameCache()


@pytest.fixture
def client(cache):
    app = pi.create_app(cache)
    app.testing = True
    return app.test_client()


# ---------------------------------------------------------------------------
# 1-2. /snapshot and /video_feed serve from the shared cache and never touch
#      the camera themselves.
# ---------------------------------------------------------------------------

def test_snapshot_serves_the_cached_jpeg_without_any_camera_capture(cache, client):
    cache.publish(b"jpeg::frame-1")
    res = client.get("/snapshot")
    assert res.status_code == 200
    assert res.data == b"jpeg::frame-1"
    assert res.headers["Content-Type"] == "image/jpeg"

    # A second snapshot returns the same cached frame — no new encode/capture.
    res2 = client.get("/snapshot")
    assert res2.data == b"jpeg::frame-1"


def test_snapshot_returns_503_before_the_first_frame_exists(client):
    res = client.get("/snapshot")
    assert res.status_code == 503


def test_routes_are_structurally_unable_to_capture_or_re_encode():
    # create_app receives ONLY the cache — no camera object — and its routes
    # never call capture_array or imencode themselves.
    app_source = inspect.getsource(pi.create_app)
    assert "capture_array" not in app_source
    assert "imencode" not in app_source
    assert list(inspect.signature(pi.create_app).parameters)[0] == "cache"


def test_video_feed_waits_for_new_sequences_instead_of_busy_capturing(cache):
    # Consumer semantics: wait_for_next blocks until a NEWER frame is published
    # (bounded), rather than polling capture_array itself.
    cache.publish(b"jpeg::a")
    jpg, seq, _ = cache.wait_for_next(0, timeout=0.1)
    assert jpg == b"jpeg::a" and seq == 1

    # No newer frame -> bounded timeout, no frame returned (no busy loop).
    jpg_none, seq_same, _ = cache.wait_for_next(seq, timeout=0.05)
    assert jpg_none is None and seq_same == seq

    # A publish from another thread wakes the waiter with the new sequence.
    def publish_later():
        time.sleep(0.05)
        cache.publish(b"jpeg::b")

    t = threading.Thread(target=publish_later)
    t.start()
    jpg2, seq2, _ = cache.wait_for_next(seq, timeout=1.0)
    t.join()
    assert jpg2 == b"jpeg::b" and seq2 == 2


def test_snapshot_and_video_feed_share_one_cache_with_one_encode_per_frame(cache, client):
    camera = FakeCamera()
    loop = pi.CaptureLoop(camera, cache, target_fps=100, encode=fake_encode)
    loop.start()
    try:
        deadline = time.time() + 2.0
        while cache.latest()[1] < 2 and time.time() < deadline:
            time.sleep(0.01)
        assert cache.latest()[1] >= 2, "capture thread never produced frames"

        captures_before = camera.capture_calls
        snap = client.get("/snapshot")
        assert snap.status_code == 200
        assert snap.data.startswith(b"jpeg::raw-frame-")
        # /snapshot triggered ZERO additional camera captures (allowing for the
        # background thread's own paced ticks is unnecessary: we compare after
        # stopping it below).
    finally:
        loop.stop()
        loop.join(timeout=2.0)

    stable_captures = camera.capture_calls
    for _ in range(5):
        client.get("/snapshot")
    assert camera.capture_calls == stable_captures  # snapshots never capture


def test_cache_retains_only_the_latest_jpeg(cache):
    cache.publish(b"jpeg::old")
    cache.publish(b"jpeg::latest")
    jpeg, sequence, _ = cache.latest()
    assert jpeg == b"jpeg::latest"
    assert sequence == 2


# ---------------------------------------------------------------------------
# 3. Controlled target FPS.
# ---------------------------------------------------------------------------

def test_capture_loop_is_paced_to_a_controlled_target_fps(cache):
    assert pi.TARGET_FPS == 15
    loop = pi.CaptureLoop(FakeCamera(), cache, target_fps=15, encode=fake_encode)
    assert loop.frame_delay == pytest.approx(1.0 / 15)

    # At 20 FPS for ~0.5 s the loop must stay near its budget, not spin freely.
    fast_cache = pi.FrameCache()
    fast_loop = pi.CaptureLoop(FakeCamera(), fast_cache, target_fps=20, encode=fake_encode)
    fast_loop.start()
    time.sleep(0.5)
    fast_loop.stop()
    fast_loop.join(timeout=2.0)
    _, sequence, _ = fast_cache.latest()
    assert 2 <= sequence <= 25  # ~10 expected; far below an unpaced busy loop


# ---------------------------------------------------------------------------
# 4. No frames are persisted to disk.
# ---------------------------------------------------------------------------

def test_no_camera_frames_are_written_to_disk():
    source = MODULE_PATH.read_text(encoding="utf-8")
    assert "imwrite" not in source
    assert '"wb"' not in source and "'wb'" not in source
    assert ".save(" not in source


# ---------------------------------------------------------------------------
# /health operational telemetry (safe fields only).
# ---------------------------------------------------------------------------

def test_health_reports_safe_operational_telemetry_only(cache, client):
    res = client.get("/health")
    body = res.get_json()
    assert body["status"] == "ok"
    assert body["camera"] == "Pi Camera Module 3"
    assert body["targetFps"] == pi.TARGET_FPS
    assert body["sequence"] == 0
    assert body["frameAgeMs"] is None  # no frame yet

    cache.publish(b"jpeg::frame", now=time.time() - 0.2)
    body = client.get("/health").get_json()
    assert body["sequence"] == 1
    assert isinstance(body["frameAgeMs"], int) and body["frameAgeMs"] >= 200
    # Telemetry never exposes image data.
    assert "jpeg" not in str(body) and "image" not in body


def test_health_surfaces_arduino_sensor_inspection_state(cache):
    cache.publish(b"jpeg::frame", now=time.time() - 0.2)
    app = pi.create_app(cache, sensor_bridge=FakeSensorBridge())
    app.testing = True
    client = app.test_client()

    body = client.get("/health").get_json()

    assert body["detection_active"] is True
    assert body["streaming"] is True
    assert body["sensor"]["pir"] is True
    assert body["sensor"]["distance_cm"] == 146.2
    assert body["sensor"]["trigger"] == "pir_and_ultrasonic"


def test_sensor_status_returns_503_when_bridge_disabled(client):
    res = client.get("/sensor_status")
    body = res.get_json()

    assert res.status_code == 503
    assert body["connected"] is False
    assert body["inspection_active"] is False


def test_get_routes_allow_only_the_exact_flowguard_origin_and_disable_caching(cache, client):
    cache.publish(b"jpeg::frame")
    for route in ("/snapshot", "/health", "/"):
        res = client.get(route, headers={"Origin": ALLOWED_ORIGIN})
        assert res.headers["Access-Control-Allow-Origin"] == ALLOWED_ORIGIN
        assert "Origin" in res.headers.get("Vary", "")
        assert "no-store" in res.headers["Cache-Control"]
        assert res.headers["Pragma"] == "no-cache"


def test_video_feed_has_exact_origin_no_store_and_expected_multipart_boundary(cache, client):
    cache.publish(b"jpeg::stream-frame")
    res = client.get(
        "/video_feed",
        headers={"Origin": ALLOWED_ORIGIN},
        buffered=False,
    )
    try:
        assert res.status_code == 200
        assert res.headers["Access-Control-Allow-Origin"] == ALLOWED_ORIGIN
        assert "no-store" in res.headers["Cache-Control"]
        assert res.headers["Content-Type"].startswith(
            "multipart/x-mixed-replace; boundary=frame"
        )
        first_chunk = next(res.response)
        assert first_chunk.startswith(b"--frame\r\nContent-Type: image/jpeg\r\n\r\n")
    finally:
        res.close()


@pytest.mark.parametrize("route", ["/health", "/snapshot", "/video_feed"])
def test_approved_origin_options_has_cors_and_no_store(route, cache, client):
    cache.publish(b"jpeg::frame")
    res = client.options(
        route,
        headers={
            "Origin": ALLOWED_ORIGIN,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "Content-Type",
        },
    )
    assert res.status_code == 200
    assert res.headers["Access-Control-Allow-Origin"] == ALLOWED_ORIGIN
    assert res.headers["Access-Control-Allow-Methods"] == "GET, OPTIONS"
    assert res.headers["Access-Control-Allow-Headers"] == "Content-Type"
    assert "no-store" in res.headers["Cache-Control"]


def test_approved_private_network_options_returns_opt_in(cache, client):
    res = client.options(
        "/snapshot",
        headers={
            "Origin": ALLOWED_ORIGIN,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Private-Network": "true",
        },
    )
    assert res.headers["Access-Control-Allow-Origin"] == ALLOWED_ORIGIN
    assert res.headers["Access-Control-Allow-Private-Network"] == "true"


@pytest.mark.parametrize("route", ["/health", "/snapshot", "/video_feed"])
def test_unapproved_origin_receives_no_cors_or_private_network_opt_in(route, cache, client):
    cache.publish(b"jpeg::frame")
    res = client.options(
        route,
        headers={
            "Origin": UNAPPROVED_ORIGIN,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Private-Network": "true",
        },
    )
    assert "Access-Control-Allow-Origin" not in res.headers
    assert "Access-Control-Allow-Private-Network" not in res.headers
    assert "no-store" in res.headers["Cache-Control"]


def test_server_bind_configuration_is_all_interfaces_on_port_8081():
    assert pi.SERVER_HOST == "0.0.0.0"
    assert pi.SERVER_PORT == 8081
