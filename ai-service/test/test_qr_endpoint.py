"""FastAPI /api/qr/decode tests — Cloud QR snapshot decoder (candidate only).

The endpoint decodes a base64 still into a CANDIDATE FlowGuard booking reference.
It must require the service key, validate/limit input safely, and NEVER approve
access, verify a booking, or write any record. InsightFace/YOLO/psycopg2 are
replaced with fakes BEFORE importing main so the suite runs on any machine.

Run from the repo root:
    ai-service/.venv/Scripts/python -m pytest ai-service/test/test_qr_endpoint.py -v
"""
import base64
import importlib.util
import os
import pathlib
import sys
import types

import numpy as np
import pytest

os.environ["AI_SERVICE_KEY"] = "test-qr-key"
os.environ["QR_MAX_IMAGE_BYTES"] = "4096"  # small cap so an oversized test is cheap

# ---------------------------------------------------------------------------
# Fakes injected before importing main.py (no real model / DB / YOLO).
# ---------------------------------------------------------------------------
class FakeFaceAnalysis:
    def __init__(self, name=None, **kwargs):
        self.models = {"detection": object(), "recognition": object()}

    def prepare(self, ctx_id=None, det_size=None):
        pass

    def get(self, img):
        return []


_insightface = types.ModuleType("insightface")
_insightface_app = types.ModuleType("insightface.app")
_insightface_app.FaceAnalysis = FakeFaceAnalysis
_insightface.app = _insightface_app
sys.modules["insightface"] = _insightface
sys.modules["insightface.app"] = _insightface_app

_ultralytics = types.ModuleType("ultralytics")
_ultralytics.YOLO = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("YOLO disabled"))
sys.modules["ultralytics"] = _ultralytics


class FakePsycopg2(types.ModuleType):
    def __init__(self):
        super().__init__("psycopg2")

    def connect(self, *a, **k):
        raise RuntimeError("database disabled in tests")


sys.modules["psycopg2"] = FakePsycopg2()

BASE = pathlib.Path(__file__).resolve().parents[1]
# main.py imports sibling modules (zone_rules); put ai-service/ on the path.
if str(BASE) not in sys.path:
    sys.path.insert(0, str(BASE))
_spec = importlib.util.spec_from_file_location("ai_main_qr_under_test", BASE / "main.py")
main = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(main)

import cv2  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

client = TestClient(main.app)
AUTH = {"X-AI-Service-Key": "test-qr-key"}

SMALL = np.full((32, 32, 3), 127, dtype=np.uint8)  # tiny — well under the 4 KB cap


def data_url(mat, ext=".jpg", mime="image/jpeg"):
    ok, buf = cv2.imencode(ext, mat)
    assert ok
    return f"data:{mime};base64," + base64.b64encode(buf.tobytes()).decode()


# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------
def test_requires_the_service_key():
    body = {"image": data_url(SMALL)}
    assert client.post("/api/qr/decode", json=body).status_code == 401
    assert client.post("/api/qr/decode", json=body, headers={"X-AI-Service-Key": "wrong"}).status_code == 401


# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------
def test_rejects_unsupported_content_type():
    res = client.post("/api/qr/decode", json={"image": "data:image/gif;base64,AAAA"}, headers=AUTH)
    assert res.status_code == 415


def test_rejects_malformed_base64():
    res = client.post("/api/qr/decode", json={"image": "data:image/jpeg;base64,%%%%"}, headers=AUTH)
    assert res.status_code == 400


def test_rejects_non_image_bytes():
    junk = "data:image/jpeg;base64," + base64.b64encode(b"totally not an image").decode()
    res = client.post("/api/qr/decode", json={"image": junk}, headers=AUTH)
    assert res.status_code == 400


def test_rejects_oversized_image():
    big = np.random.randint(0, 255, (256, 256, 3), dtype=np.uint8)  # noise → poor compression
    res = client.post("/api/qr/decode", json={"image": data_url(big)}, headers=AUTH)
    assert res.status_code == 413


# ---------------------------------------------------------------------------
# Decode results (decode core monkeypatched for determinism)
# ---------------------------------------------------------------------------
def test_valid_jpeg_with_flowguard_ref_returns_candidate(monkeypatch):
    monkeypatch.setattr(main, "_decode_qr_candidate", lambda img: "fg-abc123")
    res = client.post("/api/qr/decode", json={"image": data_url(SMALL)}, headers=AUTH)
    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    assert body["bookingRef"] == "FG-ABC123"        # normalised/upper-cased
    assert body["decoder"] == "opencv-cloud"
    assert isinstance(body["decodeMs"], int)


def test_valid_png_accepted(monkeypatch):
    monkeypatch.setattr(main, "_decode_qr_candidate", lambda img: "")
    res = client.post("/api/qr/decode", json={"image": data_url(SMALL, ".png", "image/png")}, headers=AUTH)
    assert res.status_code == 200
    assert res.json()["success"] is False


def test_no_qr_returns_safe_no_result(monkeypatch):
    monkeypatch.setattr(main, "_decode_qr_candidate", lambda img: "")
    body = client.post("/api/qr/decode", json={"image": data_url(SMALL)}, headers=AUTH).json()
    assert body == {"success": False, "bookingRef": None, "decodeMs": body["decodeMs"], "decoder": "opencv-cloud", "message": "No valid FlowGuard QR code detected"}


def test_decoded_but_invalid_content_is_rejected(monkeypatch):
    # A QR that decodes to arbitrary text is NOT a FlowGuard ref.
    monkeypatch.setattr(main, "_decode_qr_candidate", lambda img: "https://evil.example/pwn")
    body = client.post("/api/qr/decode", json={"image": data_url(SMALL)}, headers=AUTH).json()
    assert body["success"] is False
    assert body["bookingRef"] is None


# ---------------------------------------------------------------------------
# Non-authoritative guarantees — it can only ever return a candidate.
# ---------------------------------------------------------------------------
def test_success_response_has_no_access_or_audit_fields(monkeypatch):
    monkeypatch.setattr(main, "_decode_qr_candidate", lambda img: "FG-OKOK99")
    body = client.post("/api/qr/decode", json={"image": data_url(SMALL)}, headers=AUTH).json()
    for forbidden in ("access", "reasonCode", "gateAccessLog", "status", "approved"):
        assert forbidden not in body
    # Never echoes the uploaded image back.
    assert "image" not in body


# ---------------------------------------------------------------------------
# End-to-end decode of a REAL QR (only if an encoder is available in this build).
# ---------------------------------------------------------------------------
def test_real_qr_end_to_end_if_encoder_available():
    encoder_factory = getattr(cv2, "QRCodeEncoder", None)
    if encoder_factory is None or not hasattr(encoder_factory, "create"):
        pytest.skip("cv2.QRCodeEncoder not available in this OpenCV build")
    enc = cv2.QRCodeEncoder.create()
    qr = enc.encode("FG-REAL42")
    # Upscale so the modules are large enough to re-decode reliably.
    qr = cv2.resize(qr, (256, 256), interpolation=cv2.INTER_NEAREST)
    qr = cv2.cvtColor(qr, cv2.COLOR_GRAY2BGR)
    # Use a generous cap for this one real image.
    import importlib
    prev = main._QR_MAX_IMAGE_BYTES
    main._QR_MAX_IMAGE_BYTES = 6 * 1024 * 1024
    try:
        body = client.post("/api/qr/decode", json={"image": data_url(qr)}, headers=AUTH).json()
    finally:
        main._QR_MAX_IMAGE_BYTES = prev
    assert body["success"] is True
    assert body["bookingRef"] == "FG-REAL42"
