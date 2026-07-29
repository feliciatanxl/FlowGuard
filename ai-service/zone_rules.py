"""Pure Detection Setup zone-resolution logic for the YOLO analyse endpoint.

Deliberately has NO imports of cv2/ultralytics/insightface/psycopg2 so it can be unit
tested (see tests/test_zone_resolution.py) without booting the YOLO/InsightFace models
or needing a live Postgres connection — importing main.py directly triggers all of that
at module load time.

main.py's resolve_zone_for_request() is a thin DB-backed wrapper around
resolve_zone_config() below: it fetches rows from Postgres and hands them to this pure
branching logic, which decides what "the selected camera's Detection Setup rule" means.
"""

import json
import os


def _read_default_zone_threshold_sec():
    """Used only when a requested camera/zone can't be resolved to a rule (5 min
    fallback). Configurable via the DEFAULT_ZONE_THRESHOLD_SEC env var; falls back to
    300 if unset or not a valid positive integer, so old deployments without the
    variable keep behaving exactly as before."""
    raw = os.getenv("DEFAULT_ZONE_THRESHOLD_SEC")
    if raw is None:
        return 300
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return 300
    return value if value > 0 else 300


DEFAULT_ZONE_THRESHOLD_SEC = _read_default_zone_threshold_sec()


def _parse_monitored_classes(raw):
    """monitored_classes is stored as a JSON text array (e.g. '["backpack","suitcase"]').
    An empty/invalid/missing value means "no zone-specific restriction" -> []."""
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        return []
    return [c for c in parsed if isinstance(c, str)] if isinstance(parsed, list) else []


def zone_row_to_config(row, applied_camera_id=None):
    """row = (id, zone_name, time_threshold, unattended_threshold_seconds, detection_enabled,
    density_threshold, alert_cooldown_seconds, monitored_classes, severity).

    The last four fields are optional (older callers/tests may pass a 5-tuple without
    them) — each resolves to None/[] so main.py falls back to its own global default.
    """
    (zone_id, zone_name, time_threshold, unattended_threshold_seconds, detection_enabled,
     *rest) = row
    density_threshold = rest[0] if len(rest) > 0 else None
    alert_cooldown_seconds = rest[1] if len(rest) > 1 else None
    monitored_classes = _parse_monitored_classes(rest[2] if len(rest) > 2 else None)
    severity = rest[3] if len(rest) > 3 else None
    threshold = (
        unattended_threshold_seconds if unattended_threshold_seconds is not None
        else int(time_threshold) * 60
    )
    return {
        "applied_camera_id": applied_camera_id,
        "applied_zone_id": zone_id,
        "applied_zone_name": zone_name,
        "applied_threshold_seconds": threshold,
        "detection_enabled": bool(detection_enabled),
        "density_threshold": density_threshold,
        "alert_cooldown_seconds": alert_cooldown_seconds,
        "monitored_classes": monitored_classes,
        "severity": severity,
        "zone_error": None,
    }


def error_config(camera_id, zone_id, error):
    return {
        "applied_camera_id": camera_id,
        "applied_zone_id": zone_id,
        "applied_zone_name": None,
        "applied_threshold_seconds": DEFAULT_ZONE_THRESHOLD_SEC,
        "detection_enabled": False,
        "density_threshold": None,
        "alert_cooldown_seconds": None,
        "monitored_classes": [],
        "severity": None,
        "zone_error": error,
    }


def resolve_zone_config(camera_id, zone_id, fetch_camera_zone_id, fetch_zone_row):
    """Branches to the exact Detection Setup rule for a selected camera/zone.

    camera_id / zone_id: ids sent by the frontend (either may be None). When
    camera_id is present, the camera's current DB zone wins over any client-sent
    zone_id, because the frontend copy can be stale after Detection Setup changes.
    fetch_camera_zone_id(camera_id) -> (found: bool, zone_id: int|None)
        found=False means "no such camera" (deleted/never existed).
    fetch_zone_row(zone_id) -> tuple|None
        (id, zone_name, time_threshold, unattended_threshold_seconds, detection_enabled)
        or None when the zone doesn't exist (or was soft-deleted).

    Callers with neither camera_id nor zone_id should use the legacy global-fallback
    path instead (see main.py's resolve_zone_for_request) — this function assumes at
    least one id was supplied.
    """
    resolved_zone_id = zone_id
    if camera_id is not None:
        found, cam_zone_id = fetch_camera_zone_id(camera_id)
        if not found:
            return error_config(camera_id, None, "camera_not_found")
        resolved_zone_id = cam_zone_id

    if resolved_zone_id is None:
        # Valid camera, but Detection Setup has not assigned it to a zone yet.
        return error_config(camera_id, None, "camera_has_no_zone")

    zone_row = fetch_zone_row(resolved_zone_id)
    if zone_row is None:
        return error_config(camera_id, resolved_zone_id, "zone_not_found")

    return zone_row_to_config(zone_row, applied_camera_id=camera_id)
