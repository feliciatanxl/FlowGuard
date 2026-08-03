"""Send a FAKE SecurePi detection event to FlowGuard — WITHOUT the camera.

Camera-independent end-to-end test of the FlowGuard cloud integration: builds one
synthetic event (pest / unattended / crowd / restricted-motion) and either prints it
(--dry-run) or POSTs it via the same edge client SecurePi uses. With --with-snapshot it
also generates a tiny real JPEG, uploads it to the snapshot endpoint, and puts the
returned URL into the event — exercising the full upload → link path with no camera.

Examples:
    # Just show the payload — no network, no config needed:
    python edge/send_test_event.py --dry-run --type pest

    # POST to a running FlowGuard backend (reads env), uploading a real snapshot:
    FLOWGUARD_API_URL=http://localhost:5001 \
    EDGE_INGEST_TOKEN=dev-securepi-token \
    SECUREPI_DEVICE_ID=securepi-kitchen-01 \
    SECUREPI_CAMERA_LOCATION="Kitchen Camera 01" \
    python edge/send_test_event.py --type pest --with-snapshot

The camera is never opened; this only exercises the HTTP path. The bearer token is
NEVER printed.
"""

import argparse
import base64
import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # edge/ on path
from flowguard_api import FlowGuardApiClient  # noqa: E402

# Fixed timestamp so the deterministic event_id is stable across runs (retry/idempotent-safe).
FIXED_TS = "2026-07-29T09:00:00Z"

# A minimal but VALID 1x1 JPEG, so --with-snapshot uploads a real image the browser can open.
_TINY_JPEG_B64 = (
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof"
    "Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB"
    "AAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q=="
)

PRESETS = {
    "pest": dict(event_type="pest_detection", alert_type="Pest Detection",
                 zone_name="Kitchen", object_class="rat", severity="High",
                 confidence=0.92, track_id=1),
    "rat": dict(event_type="pest_detection", alert_type="Pest Detection",
                zone_name="Kitchen", object_class="rat", severity="High",
                confidence=0.92, track_id=1),
    "unattended": dict(event_type="unattended_object", alert_type="Unattended Object",
                       zone_name="Lobby", object_class="backpack", severity="High",
                       confidence=0.88, duration_seconds=35, track_id=12),
    "crowd": dict(event_type="crowd_density", alert_type="Overcrowding",
                  zone_name="Lobby", object_class="person", severity="Medium",
                  confidence=0.90, track_id=None),
    "motion": dict(event_type="restricted_motion", alert_type="Restricted-Zone Motion",
                   zone_name="Chemical Storage", severity="High", track_id=None,
                   sensor_metadata={"distance_cm": 18.4, "object_close": True, "pir_ready": True}),
}


def _write_tiny_jpeg() -> Path:
    """Write a tiny valid JPEG to a temp file and return its path."""
    tmp = Path(tempfile.gettempdir()) / "securepi_test_snapshot.jpg"
    tmp.write_bytes(base64.b64decode(_TINY_JPEG_B64))
    return tmp


def _describe_result(classification, status, body) -> str:
    """Map (classification, status, body) to a short human result line."""
    duplicate = False
    if body:
        try:
            parsed = json.loads(body if isinstance(body, str) else body.decode("utf-8"))
            duplicate = bool(isinstance(parsed, dict) and parsed.get("duplicate"))
        except (ValueError, AttributeError, UnicodeDecodeError):
            pass
    if classification == "success":
        return "accepted (idempotent duplicate)" if duplicate else "accepted"
    if classification == "config_error":
        return "auth/config error — check EDGE_INGEST_TOKEN / FLOWGUARD_API_URL"
    if classification == "permanent":
        return "rejected (permanent — payload invalid)"
    return "queued/retry (transient — will retry)"


def main(argv=None):
    parser = argparse.ArgumentParser(description="Send a fake SecurePi event to FlowGuard (no camera).")
    parser.add_argument("--type", choices=sorted(PRESETS), default="pest")
    parser.add_argument("--dry-run", action="store_true", help="Print the payload; do not send.")
    parser.add_argument("--with-snapshot", action="store_true",
                        help="Generate a tiny real JPEG, upload it, and attach the returned URL.")
    args = parser.parse_args(sys.argv[1:] if argv is None else list(argv))

    # In dry-run we don't need a configured backend; otherwise read env.
    client = (FlowGuardApiClient.from_env(enabled=False) if args.dry_run
              else FlowGuardApiClient.from_env())
    preset = dict(PRESETS[args.type])

    snapshot_url = None
    if args.with_snapshot and not args.dry_run:
        if not client.api_url or not client.token:
            print("ERROR: set FLOWGUARD_API_URL and EDGE_INGEST_TOKEN to upload a snapshot.", file=sys.stderr)
            return 2
        snap_path = _write_tiny_jpeg()
        snapshot_url = client.upload_snapshot(snap_path)
        if snapshot_url:
            preset["snapshot_url"] = snapshot_url
        else:
            print("WARNING: snapshot upload failed; sending the event without a snapshot URL.", file=sys.stderr)

    event = client.build_event(timestamp=FIXED_TS, **preset)

    if args.dry_run:
        print(json.dumps(event, indent=2))
        return 0

    if not client.api_url or not client.token:
        print("ERROR: set FLOWGUARD_API_URL and EDGE_INGEST_TOKEN (or use --dry-run).", file=sys.stderr)
        return 2

    classification, status, body = client.send_event(event)

    # Clear, token-free diagnostics.
    print(f"Resolved URL: {client.api_url}{client.endpoint_path}")
    print(f"Event ID:     {event.get('event_id')}")
    print(f"Device ID:    {event.get('device_id')}")
    print(f"Alert type:   {event.get('alert_type')}  (object: {event.get('object_class')})")
    if args.with_snapshot:
        print(f"Snapshot:     {'uploaded -> ' + snapshot_url if snapshot_url else 'not uploaded'}")
    print(f"HTTP status:  {status}")
    print(f"Result:       {_describe_result(classification, status, body)}")
    return 0 if classification == "success" else 1


if __name__ == "__main__":
    raise SystemExit(main())
