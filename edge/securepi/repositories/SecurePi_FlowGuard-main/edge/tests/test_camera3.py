"""Off-device tests for the Camera Module 3 path: model-name validation, Ultralytics
output conversion, bounding-box clamping, confidence filtering, the detection_enabled
gate and monitored_classes filtering.

Runs on any machine — cv2 and picamera2/ultralytics are not required (cv2 is stubbed
before import; the pure conversion/validation helpers need neither). Usage:

    python edge/tests/test_camera3.py          # standalone
    python -m pytest edge/tests/test_camera3.py # or via pytest
"""
import sys
import types
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
TESTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(TESTS_DIR))

# securePi imports cv2 at module load. Reuse test_securepi.py's recording cv2 stub (which
# writes placeholder snapshots and records draw calls) so the whole suite shares ONE
# sys.modules['cv2'] regardless of collection order. Fall back to a local writing stub
# if test_securepi can't be imported (e.g. this file run in isolation from another dir).
try:
    import test_securepi  # noqa: F401  -- installs the shared recording cv2 stub
except ImportError:  # pragma: no cover - standalone fallback
    sys.modules.setdefault("cv2", types.SimpleNamespace(
        imwrite=lambda path, img: Path(path).write_bytes(b"jpg") > 0,
        rectangle=lambda *a, **k: None, putText=lambda *a, **k: None,
        FONT_HERSHEY_SIMPLEX=0, imshow=lambda *a, **k: None,
        waitKey=lambda *a, **k: -1, destroyAllWindows=lambda: None))

import camera3_detector as c3  # noqa: E402
import zone_config as zc  # noqa: E402
from securePi import Config, Detection, MonitorPipeline, split_detections  # noqa: E402
import securePi  # noqa: E402

SIX_CLASS = {0: "person", 1: "backpack", 2: "handbag", 3: "suitcase", 4: "rat", 5: "mouse"}


# --------------------------------------------------------------------------
# Model-name validation
# --------------------------------------------------------------------------
def test_validate_six_class_names_ok():
    c3.validate_model_names(SIX_CLASS)                                  # dict form
    c3.validate_model_names(["person", "backpack", "handbag", "suitcase", "rat", "mouse"])  # list form


def test_validate_rejects_stock_yolo():
    try:
        c3.validate_model_names({0: "person", 1: "bicycle", 2: "car"})
        raise AssertionError("should have rejected an unexpected class mapping")
    except ValueError as exc:
        assert "Unexpected model class mapping" in str(exc)


def test_validate_rejects_wrong_order():
    swapped = {0: "person", 1: "handbag", 2: "backpack", 3: "suitcase", 4: "rat", 5: "mouse"}
    try:
        c3.validate_model_names(swapped)
        raise AssertionError("wrong ORDER must be rejected, not silently remapped")
    except ValueError:
        pass


# --------------------------------------------------------------------------
# Ultralytics output -> common Detection conversion
# --------------------------------------------------------------------------
def test_conversion_xyxy_to_xywh():
    dets = c3.ultralytics_to_detections(
        boxes_xyxy=[[10, 20, 50, 80]], scores=[0.9], class_ids=[4],
        names=SIX_CLASS, frame_w=640, frame_h=480, threshold=0.5)
    assert len(dets) == 1
    assert dets[0].label == "rat"
    assert dets[0].box == (10, 20, 40, 60)          # (x, y, w=x2-x1, h=y2-y1)
    assert abs(dets[0].score - 0.9) < 1e-9


def test_conversion_clamps_to_frame():
    dets = c3.ultralytics_to_detections(
        boxes_xyxy=[[-5, -10, 700, 500]], scores=[0.9], class_ids=[0],
        names=SIX_CLASS, frame_w=640, frame_h=480, threshold=0.5)
    assert dets[0].box == (0, 0, 640, 480)          # clamped inside the captured frame


def test_conversion_confidence_filtering():
    dets = c3.ultralytics_to_detections(
        boxes_xyxy=[[0, 0, 10, 10], [20, 20, 30, 30]], scores=[0.40, 0.80],
        class_ids=[4, 5], names=SIX_CLASS, frame_w=100, frame_h=100, threshold=0.5)
    assert [d.label for d in dets] == ["mouse"]      # the 0.40 rat is dropped


def test_conversion_drops_degenerate_box():
    dets = c3.ultralytics_to_detections(
        boxes_xyxy=[[50, 50, 50, 90]], scores=[0.9], class_ids=[4],  # zero width
        names=SIX_CLASS, frame_w=100, frame_h=100, threshold=0.5)
    assert dets == []


# --------------------------------------------------------------------------
# detection_enabled gate + monitored_classes filtering (shared pipeline)
# --------------------------------------------------------------------------
def test_detection_disabled_fires_no_alerts():
    cfg = Config(detection_enabled=False, pest_confirmation_frames=1, pest_confirmation_time=0)
    pipe = MonitorPipeline(cfg, client=None)
    fired = {"n": 0}
    original = securePi._fire_pest_alert
    securePi._fire_pest_alert = lambda *a, **k: fired.__setitem__("n", fired["n"] + 1)
    try:
        pipe.process([Detection("rat", 0.95, (30, 30, 20, 20))], now=1.0, frame_factory=lambda: object())
    finally:
        securePi._fire_pest_alert = original
    assert fired["n"] == 0                            # disabled -> no alert created


def test_monitored_classes_excludes_class_before_alert():
    cfg = Config()
    zc.apply_zone_config(cfg, {"zone_id": 3, "detection_enabled": True,
                               "monitored_classes": ["person", "rat"]}, cli_overrides=set())
    # backpack (an unattended-object class) is no longer monitored -> dropped by routing.
    persons, objects, pests = split_detections([
        Detection("backpack", 0.9, (10, 10, 30, 30)),
        Detection("rat", 0.9, (60, 60, 20, 20)),
    ], cfg)
    assert objects == []                              # excluded class ignored
    assert [p.label for p in pests] == ["rat"]


# --------------------------------------------------------------------------
# Snapshot pruning: newest file survives even on a modification-time tie
# --------------------------------------------------------------------------
def test_pruning_keeps_newest_on_mtime_tie():
    import os
    import tempfile
    from securePi import save_snapshot_worker
    with tempfile.TemporaryDirectory() as tmp:
        directory = Path(tmp)
        files = []
        for i in range(5):
            f = directory / f"alert_bag{i}_20260101-000000.jpg"
            f.write_bytes(b"x")
            files.append(f)
        new = directory / "alert_bag9_20260101-000000.jpg"
        new.write_bytes(b"x")
        # Force an IDENTICAL modification timestamp on ALL files (the failure condition).
        for f in files + [new]:
            os.utime(f, (1_000_000, 1_000_000))
        # keep=3: three files must be pruned, but the just-written `new` must survive.
        save_snapshot_worker(None, new, directory, keep=3, protect=new)
        remaining = sorted(f.name for f in directory.glob("*.jpg"))
        assert len(remaining) == 3, remaining
        assert new.name in remaining                  # newest file never pruned on a tie


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for test in tests:
        test()
        print(f"{test.__name__} OK")
    print(f"ALL {len(tests)} TESTS PASSED")
