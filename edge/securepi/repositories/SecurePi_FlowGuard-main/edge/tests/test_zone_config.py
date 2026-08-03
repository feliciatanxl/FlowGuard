"""Off-device tests for the SecurePi edge zone-config client (fetch/validate/cache/apply).

No real network: a fake ``urlopen`` is injected. Run with:
    python -m pytest edge/tests/test_zone_config.py -q
or standalone:
    python edge/tests/test_zone_config.py
"""
import json
import sys
import types
import urllib.error
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
TESTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(TESTS_DIR))

# Reuse test_securepi.py's shared recording cv2 stub (see test_camera3.py for why), so the
# whole suite shares one sys.modules['cv2'] regardless of collection order.
try:
    import test_securepi  # noqa: F401  -- installs the shared recording cv2 stub
except ImportError:  # pragma: no cover - standalone fallback
    sys.modules.setdefault("cv2", types.SimpleNamespace(
        imwrite=lambda p, i: Path(p).write_bytes(b"jpg") > 0, rectangle=lambda *a, **k: None,
        putText=lambda *a, **k: None, FONT_HERSHEY_SIMPLEX=0, imshow=lambda *a, **k: None,
        waitKey=lambda *a, **k: -1, destroyAllWindows=lambda: None))

import zone_config as zc  # noqa: E402
from securePi import Config  # noqa: E402

VALID = {
    "zone_id": 3, "zone_name": "Kitchen", "detection_enabled": True,
    "detection_type": "pest_detection",
    "monitored_classes": ["person", "backpack", "handbag", "suitcase", "rat", "mouse"],
    "unattended_threshold_seconds": 300, "alert_cooldown_seconds": 30, "severity": "High",
}


class FakeResp:
    def __init__(self, code, body):
        self._code = code
        self._body = body if isinstance(body, bytes) else json.dumps(body).encode("utf-8")

    @property
    def status(self):
        return self._code

    def read(self):
        return self._body

    def close(self):
        pass


def urlopen_ok(body, counter=None, captured=None):
    def _u(req, timeout=None):
        if counter is not None:
            counter["n"] += 1
        if captured is not None:
            captured["url"] = req.full_url
            captured["auth"] = req.headers.get("Authorization")
        return FakeResp(200, body)
    return _u


def urlopen_status(code):
    def _u(req, timeout=None):
        raise urllib.error.HTTPError(req.full_url, code, "err", {}, None)
    return _u


def urlopen_network_error(req=None, timeout=None):
    raise urllib.error.URLError("no route to host")


# ---- URL construction -----------------------------------------------------
def test_build_config_url_normalises_slash_and_double_path():
    assert zc.build_config_url("https://h.example") == "https://h.example/api/edge/config"
    assert zc.build_config_url("https://h.example/") == "https://h.example/api/edge/config"
    # Base already includes the path -> not appended twice.
    assert zc.build_config_url("https://h.example/api/edge/config") == "https://h.example/api/edge/config"


# ---- validation -----------------------------------------------------------
def test_validate_accepts_good_config():
    out = zc.validate_zone_config(VALID)
    assert out is not None and out["zone_id"] == 3 and out["detection_enabled"] is True
    assert out["monitored_classes"] == VALID["monitored_classes"]


def test_validate_rejects_bad_configs():
    assert zc.validate_zone_config("not a dict") is None
    assert zc.validate_zone_config({"zone_name": "no id"}) is None            # missing zone_id
    assert zc.validate_zone_config({"zone_id": 1, "monitored_classes": "x"}) is None  # not a list
    assert zc.validate_zone_config({"zone_id": 1, "detection_enabled": "yes"}) is None  # not bool
    assert zc.validate_zone_config({"zone_id": 1, "unattended_threshold_seconds": "x"}) is None  # not numeric


def test_validate_strips_unknown_keys():
    out = zc.validate_zone_config({**VALID, "secret_token": "should-not-survive"})
    assert "secret_token" not in out                                          # only known fields kept


# ---- fetch ----------------------------------------------------------------
def test_fetch_success_sends_bearer_and_returns_config():
    captured = {}
    out = zc.fetch_zone_config("https://h.example", "secret-token", zone_id=3,
                               urlopen=urlopen_ok(VALID, captured=captured))
    assert out["zone_id"] == 3
    assert captured["auth"] == "Bearer secret-token"     # token in header only
    assert "secret-token" not in captured["url"]         # never in the URL/query


def test_fetch_http_error_returns_none():
    assert zc.fetch_zone_config("https://h.example", "t", zone_id=3, urlopen=urlopen_status(500)) is None


def test_fetch_network_error_returns_none():
    assert zc.fetch_zone_config("https://h.example", "t", zone_id=3, urlopen=urlopen_network_error) is None


def test_fetch_without_identifiers_returns_none():
    assert zc.fetch_zone_config("https://h.example", "t", urlopen=urlopen_ok(VALID)) is None


# ---- cache ----------------------------------------------------------------
def test_cache_round_trip_and_only_known_fields(tmp_path=None):
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        cache = Path(tmp) / "config" / "zone_config.json"
        zc.save_cached_config(cache, {**VALID, "secret_token": "nope"})
        raw = json.loads(cache.read_text())
        assert "secret_token" not in raw                 # secrets never written to cache
        loaded = zc.load_cached_config(cache)
        assert loaded["zone_id"] == 3


def test_invalid_cache_is_ignored():
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        cache = Path(tmp) / "zone_config.json"
        cache.write_text("{ not valid json")
        assert zc.load_cached_config(cache) is None       # never raises


# ---- resolve (server -> cache -> local) -----------------------------------
def test_resolve_server_success_caches():
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        cache = Path(tmp) / "zone_config.json"
        cfg, source = zc.resolve_zone_config("https://h.example", "t", cache_path=cache,
                                             zone_id=3, urlopen=urlopen_ok(VALID))
        assert source == "server" and cfg["zone_id"] == 3
        assert cache.is_file()                            # cached for next time


def test_resolve_falls_back_to_cache_on_outage():
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        cache = Path(tmp) / "zone_config.json"
        zc.save_cached_config(cache, VALID)               # seed a last-known-good cache
        cfg, source = zc.resolve_zone_config("https://h.example", "t", cache_path=cache,
                                             zone_id=3, urlopen=urlopen_network_error)
        assert source == "cache" and cfg["zone_id"] == 3  # outage -> cached config used


def test_resolve_local_when_no_server_or_cache():
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        cache = Path(tmp) / "zone_config.json"
        cfg, source = zc.resolve_zone_config("https://h.example", "t", cache_path=cache,
                                             zone_id=3, urlopen=urlopen_network_error)
        assert source == "local" and cfg is None


# ---- apply ----------------------------------------------------------------
def test_apply_disabled_and_monitored_and_thresholds():
    cfg = Config()
    zc.apply_zone_config(cfg, {"zone_id": 3, "zone_name": "Kitchen", "detection_enabled": False,
                               "monitored_classes": ["rat", "person"],
                               "unattended_threshold_seconds": 300, "alert_cooldown_seconds": 45},
                         cli_overrides=set())
    assert cfg.detection_enabled is False
    assert cfg.pest_labels == {"rat"} and cfg.unattended_object_labels == set()
    assert cfg.unattended_time_sec == 300.0 and cfg.alert_cooldown_sec == 45.0


def test_apply_cli_override_wins_over_server():
    cfg = Config(unattended_time_sec=15.0)
    zc.apply_zone_config(cfg, {"zone_id": 3, "detection_enabled": True, "monitored_classes": [],
                               "unattended_threshold_seconds": 300},
                         cli_overrides={"unattended_threshold_seconds"})
    assert cfg.unattended_time_sec == 15.0                # explicit CLI value preserved


def test_apply_disabled_not_bypassed_without_dev_flag():
    cfg = Config()
    zc.apply_zone_config(cfg, {"zone_id": 3, "detection_enabled": False}, cli_overrides=set())
    assert cfg.detection_enabled is False                 # not silently re-enabled


def test_apply_dev_flag_can_force_detection():
    cfg = Config()
    zc.apply_zone_config(cfg, {"zone_id": 3, "detection_enabled": False}, cli_overrides=set(),
                         allow_override_disabled=True)
    assert cfg.detection_enabled is True                  # DEV override, logged loudly


if __name__ == "__main__":
    import logging
    logging.disable(logging.CRITICAL)
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for test in tests:
        test()
        print(f"{test.__name__} OK")
    print(f"ALL {len(tests)} TESTS PASSED")
