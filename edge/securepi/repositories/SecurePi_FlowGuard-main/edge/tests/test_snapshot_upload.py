"""Off-device tests for SecurePi snapshot upload + outbox integration.

No real network: a fake ``urlopen`` routes by URL (upload vs ingest) so we can assert
the upload happens once, its URL is persisted, and a failed upload never loses the alert.

    python -m pytest edge/tests/test_snapshot_upload.py -q
"""
import json
import os
import sys
import tempfile
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import flowguard_api as fg  # noqa: E402


class FakeResp:
    def __init__(self, code, body=b"{}"):
        self._code = code
        self._body = body if isinstance(body, bytes) else body.encode("utf-8")

    @property
    def status(self):
        return self._code

    def read(self):
        return self._body

    def close(self):
        pass


SNAP_URL = "https://flowguard.example/api/edge/snapshots/edge_abcdef.jpg"


def routing_urlopen(counts, *, upload_code=201, upload_url=SNAP_URL, ingest_code=201):
    """A fake urlopen that answers snapshot-upload and ingest POSTs differently, counting each."""
    def _u(req, timeout=None):
        url = req.full_url
        if url.endswith("/api/edge/snapshots"):
            counts["upload"] += 1
            if upload_code >= 400:
                raise urllib.error.HTTPError(url, upload_code, "err", {}, None)
            body = json.dumps({"snapshot_url": upload_url}).encode("utf-8") if upload_url else b"{}"
            return FakeResp(upload_code, body)
        counts["ingest"] += 1
        if ingest_code >= 400:
            raise urllib.error.HTTPError(url, ingest_code, "err", {}, None)
        return FakeResp(ingest_code)
    return _u


def _client(tmp, urlopen, **kw):
    return fg.FlowGuardApiClient(
        "https://flowguard.example", "secret-token", enabled=True,
        device_id="securepi-test", camera_location="Test Cam",
        outbox_dir=os.path.join(tmp, "outbox"), auto_flush=False, urlopen=urlopen, **kw)


def _jpg(tmp, name="snap.jpg"):
    p = Path(tmp) / name
    p.write_bytes(b"\xff\xd8\xff\xe0JFIFdata\xff\xd9")
    return p


# ---- upload_snapshot unit --------------------------------------------------
def test_upload_success_returns_url():
    with tempfile.TemporaryDirectory() as tmp:
        counts = {"upload": 0, "ingest": 0}
        client = _client(tmp, routing_urlopen(counts))
        url = client.upload_snapshot(_jpg(tmp))
        assert url == SNAP_URL and counts["upload"] == 1


def test_upload_missing_file_returns_none():
    with tempfile.TemporaryDirectory() as tmp:
        counts = {"upload": 0, "ingest": 0}
        client = _client(tmp, routing_urlopen(counts))
        assert client.upload_snapshot(Path(tmp) / "nope.jpg") is None
        assert counts["upload"] == 0                      # never even attempted


def test_upload_rejects_non_image_extension():
    with tempfile.TemporaryDirectory() as tmp:
        counts = {"upload": 0, "ingest": 0}
        client = _client(tmp, routing_urlopen(counts))
        bad = Path(tmp) / "snap.txt"
        bad.write_bytes(b"not an image")
        assert client.upload_snapshot(bad) is None
        assert counts["upload"] == 0


def test_upload_http_error_returns_none():
    with tempfile.TemporaryDirectory() as tmp:
        counts = {"upload": 0, "ingest": 0}
        client = _client(tmp, routing_urlopen(counts, upload_code=500))
        assert client.upload_snapshot(_jpg(tmp)) is None


# ---- flush integration -----------------------------------------------------
def test_flush_uploads_snapshot_then_persists_url_no_reupload():
    with tempfile.TemporaryDirectory() as tmp:
        counts = {"upload": 0, "ingest": 0}
        # Ingest fails (500) so the event stays queued for a second flush.
        client = _client(tmp, routing_urlopen(counts, ingest_code=500))
        snap = _jpg(tmp)
        event = client.build_event(event_type="pest_detection", alert_type="Pest Detection",
                                   zone_name="Kitchen", object_class="rat", track_id=1,
                                   snapshot_path=str(snap), timestamp="2026-07-29T09:00:00Z")
        path = client.enqueue_event(event)

        client.flush_outbox()                              # upload succeeds, ingest 500 (kept)
        persisted = json.loads(path.read_text())
        assert persisted["snapshot_url"] == SNAP_URL       # URL persisted into the outbox file
        assert counts["upload"] == 1

        client.flush_outbox()                              # retry: must NOT upload again
        assert counts["upload"] == 1                       # still 1 — idempotent, no duplicate upload
        assert counts["ingest"] == 2                       # the alert itself is retried


def test_failed_upload_still_sends_alert():
    with tempfile.TemporaryDirectory() as tmp:
        counts = {"upload": 0, "ingest": 0}
        # Upload fails, ingest succeeds -> the alert must still reach the cloud.
        client = _client(tmp, routing_urlopen(counts, upload_code=503))
        snap = _jpg(tmp)
        event = client.build_event(event_type="pest_detection", alert_type="Pest Detection",
                                   zone_name="Kitchen", object_class="rat", track_id=2,
                                   snapshot_path=str(snap), timestamp="2026-07-29T09:00:00Z")
        path = client.enqueue_event(event)
        stats = client.flush_outbox()
        assert stats["sent"] == 1 and not path.exists()    # alert delivered despite upload failure
        assert counts["upload"] == 1 and counts["ingest"] == 1


def test_existing_url_is_not_reuploaded():
    with tempfile.TemporaryDirectory() as tmp:
        counts = {"upload": 0, "ingest": 0}
        client = _client(tmp, routing_urlopen(counts))
        event = client.build_event(event_type="pest_detection", alert_type="Pest Detection",
                                   zone_name="Kitchen", object_class="rat", track_id=3,
                                   snapshot_url="https://already/uploaded.jpg",
                                   snapshot_path="/pi/local/x.jpg", timestamp="2026-07-29T09:00:00Z")
        client.enqueue_event(event)
        client.flush_outbox()
        assert counts["upload"] == 0                       # already has a URL -> never re-uploads
        assert counts["ingest"] == 1


if __name__ == "__main__":
    import logging
    logging.disable(logging.CRITICAL)
    failures = 0
    for name in sorted(n for n in dir() if n.startswith("test_")):
        try:
            globals()[name]()
            print(f"PASS {name}")
        except AssertionError as exc:
            failures += 1
            print(f"FAIL {name}: {exc}")
    sys.exit(1 if failures else 0)
