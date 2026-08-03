"""Pure Detection Setup zone-resolution logic for the YOLO analyse endpoint.

Deliberately has NO imports of cv2/ultralytics/insightface/psycopg2 so it can be unit
tested (see tests/test_zone_resolution.py) without booting the YOLO/InsightFace models
or needing a live Postgres connection — importing main.py directly triggers all of that
at module load time.

main.py's resolve_zone_for_request() is a thin DB-backed wrapper around
resolve_zone_config() below: it fetches rows from Postgres and hands them to this pure
branching logic, which decides what "the selected camera's Detection Setup rule" means.
"""

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


def zone_row_to_config(row, applied_camera_id=None):
    """row = (id, zone_name, time_threshold, unattended_threshold_seconds, detection_enabled,
    density_threshold)"""
    zone_id, zone_name, time_threshold, unattended_threshold_seconds, detection_enabled, density_threshold = row
    threshold = (
        unattended_threshold_seconds if unattended_threshold_seconds is not None
        else int(time_threshold) * 60
    )
    return {
        "applied_camera_id": applied_camera_id,
        "applied_zone_id": zone_id,
        "applied_zone_name": zone_name,
        "applied_threshold_seconds": threshold,
        # Zone's configured max-occupancy rule (Detection Setup's "Density threshold"
        # field) — None means the zone has no override, so callers fall back to the
        # global PERSON_CRITICAL_COUNT default.
        "applied_density_threshold": density_threshold,
        "detection_enabled": bool(detection_enabled),
        "zone_error": None,
    }


def error_config(camera_id, zone_id, error):
    return {
        "applied_camera_id": camera_id,
        "applied_zone_id": zone_id,
        "applied_zone_name": None,
        "applied_threshold_seconds": DEFAULT_ZONE_THRESHOLD_SEC,
        "applied_density_threshold": None,
        "detection_enabled": False,
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
