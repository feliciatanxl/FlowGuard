#!/usr/bin/env python3
"""SecurePi edge zone-configuration client.

Fetches the live MonitoringZone config for this device from the FlowGuard backend
(``GET /api/edge/config``, authenticated with the edge token) so a change a Facilities
Manager makes on the FlowGuard website reaches the Raspberry Pi. Standard-library only
(``urllib``); crash-safe disk cache; never logs the token or writes secrets to the cache.

Precedence (documented; later wins where a value is present):

    safe code defaults  ->  local preset / env  ->  cached server config
        ->  current server config  ->  explicit CLI override

A CLI override never SILENTLY re-enables detection when the applicable config says
``detection_enabled=false`` — that only happens with the explicit, loudly-logged dev
flag ``--allow-detection-when-disabled``.

Failure handling: a cloud outage, HTTP error, or invalid JSON falls back to the last
known good cached config (validated before use), else to the local defaults/preset — it
never crashes the camera process, and never silently enables detection that a valid
cached config says is disabled.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Optional

LOGGER = logging.getLogger("securepi.zone_config")

DEFAULT_CONFIG_PATH = "/api/edge/config"


def build_config_url(api_url: Optional[str], endpoint_path: str = DEFAULT_CONFIG_PATH) -> str:
    """Join a BASE api_url with the config path, tolerating a trailing slash or a base
    that already includes the path (prevents /api/edge/config/api/edge/config)."""
    base = (api_url or "").rstrip("/")
    if base.endswith(endpoint_path):
        return base
    return f"{base}{endpoint_path}"


def validate_zone_config(data, logger: logging.Logger = LOGGER) -> Optional[dict]:
    """Validate a raw config object and return a normalized dict, or None if invalid.

    Only known fields are kept, so an unexpected/injected key can never reach the cache
    or the runtime config. Rejects (returns None) rather than raising, so a bad server or
    cache payload never crashes the caller."""
    if not isinstance(data, dict):
        logger.warning("[zone-config] rejected: payload is not a JSON object.")
        return None
    if data.get("zone_id") is None:
        logger.warning("[zone-config] rejected: missing zone_id.")
        return None
    monitored = data.get("monitored_classes", [])
    if monitored is not None and not isinstance(monitored, list):
        logger.warning("[zone-config] rejected: monitored_classes is not a list.")
        return None
    detection_enabled = data.get("detection_enabled", True)
    if not isinstance(detection_enabled, bool):
        logger.warning("[zone-config] rejected: detection_enabled is not a boolean.")
        return None
    for key in ("unattended_threshold_seconds", "alert_cooldown_seconds"):
        value = data.get(key)
        if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float))):
            logger.warning("[zone-config] rejected: %s is not numeric.", key)
            return None
    return {
        "zone_id": data.get("zone_id"),
        "zone_name": data.get("zone_name"),
        "detection_enabled": detection_enabled,
        "detection_type": data.get("detection_type"),
        "monitored_classes": [str(c) for c in (monitored or [])],
        "unattended_threshold_seconds": data.get("unattended_threshold_seconds"),
        "alert_cooldown_seconds": data.get("alert_cooldown_seconds"),
        "severity": data.get("severity"),
    }


def fetch_zone_config(api_url, token, *, device_id=None, zone_id=None, zone_name=None,
                      camera_location=None, timeout: float = 5.0, urlopen=None,
                      logger: logging.Logger = LOGGER) -> Optional[dict]:
    """GET the live zone config. Returns a validated dict, or None on any failure.

    The token rides in the Authorization header only (never a query param, never logged).
    Never raises — a transport/HTTP/JSON error returns None so the caller falls back."""
    urlopen = urlopen or urllib.request.urlopen
    params = {}
    if device_id:
        params["device_id"] = str(device_id)
    if zone_id is not None:
        params["zone_id"] = str(zone_id)
    if zone_name:
        params["zone_name"] = str(zone_name)
    if camera_location:
        params["camera_location"] = str(camera_location)
    if not params:
        logger.warning("[zone-config] no device_id/zone_id/zone_name/camera_location — skipping fetch.")
        return None
    if not api_url or not token:
        logger.warning("[zone-config] FLOWGUARD_API_URL / EDGE_INGEST_TOKEN incomplete — skipping fetch.")
        return None

    url = build_config_url(api_url) + "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"}, method="GET")
    try:
        response = urlopen(request, timeout=timeout)
        status = getattr(response, "status", None)
        if status is None and hasattr(response, "getcode"):
            status = response.getcode()
        try:
            raw = response.read()
        finally:
            if hasattr(response, "close"):
                response.close()
        if status != 200:
            logger.warning("[zone-config] server returned HTTP %s — using cached/local config.", status)
            return None
        return validate_zone_config(json.loads(raw.decode("utf-8")), logger=logger)
    except urllib.error.HTTPError as exc:
        logger.warning("[zone-config] HTTP %s fetching config — using cached/local config.", exc.code)
        return None
    except (urllib.error.URLError, ValueError, OSError) as exc:
        logger.warning("[zone-config] could not fetch config (%s) — using cached/local config.", exc)
        return None


def load_cached_config(cache_path, logger: logging.Logger = LOGGER) -> Optional[dict]:
    """Load and VALIDATE a cached config, or None if absent/unreadable/invalid."""
    path = Path(cache_path)
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, OSError) as exc:
        logger.warning("[zone-config] cached config unreadable (%s) — ignoring.", exc)
        return None
    return validate_zone_config(data, logger=logger)


def save_cached_config(cache_path, data, logger: logging.Logger = LOGGER) -> None:
    """Atomically cache the LAST KNOWN GOOD config. Only validated, known fields are
    written — never secrets, never unexpected keys."""
    validated = validate_zone_config(data, logger=logger)
    if validated is None:
        return
    path = Path(cache_path)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp-cfg-", suffix=".json")
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(validated, handle)
        os.replace(tmp, path)
    except OSError as exc:
        logger.warning("[zone-config] could not write cache (%s).", exc)


def resolve_zone_config(api_url, token, *, cache_path, device_id=None, zone_id=None,
                        zone_name=None, camera_location=None, timeout: float = 5.0,
                        urlopen=None, logger: logging.Logger = LOGGER):
    """Resolve the config to apply, following the documented precedence for the
    server/cache tiers. Returns ``(config_dict_or_None, source)`` where source is one of
    'server' | 'cache' | 'local'. On a successful fetch the result is cached."""
    server = fetch_zone_config(api_url, token, device_id=device_id, zone_id=zone_id,
                               zone_name=zone_name, camera_location=camera_location,
                               timeout=timeout, urlopen=urlopen, logger=logger)
    if server is not None:
        save_cached_config(cache_path, server, logger=logger)
        logger.info("[zone-config] applied CURRENT server config for zone %s (%s).",
                    server.get("zone_id"), server.get("zone_name"))
        return server, "server"
    cached = load_cached_config(cache_path, logger=logger)
    if cached is not None:
        logger.info("[zone-config] server unavailable — applied LAST CACHED config for zone %s (%s).",
                    cached.get("zone_id"), cached.get("zone_name"))
        return cached, "cache"
    logger.info("[zone-config] no server or cached config available — using local defaults/preset.")
    return None, "local"


def apply_zone_config(config, server_cfg, *, cli_overrides=None,
                      allow_override_disabled: bool = False,
                      logger: logging.Logger = LOGGER) -> None:
    """Apply a validated zone config onto a securePi ``Config`` in place.

    * ``detection_enabled=false`` disables new alerts (unless the explicit dev override is
      set, which is logged loudly).
    * ``monitored_classes`` (when non-empty) restricts the person/object/pest label sets,
      so an excluded class is ignored before any alert is generated.
    * ``unattended_threshold_seconds`` / ``alert_cooldown_seconds`` update the timers,
      UNLESS the operator passed an explicit CLI override for that value (which wins).
    """
    cli_overrides = cli_overrides or set()
    if not server_cfg:
        return

    enabled = server_cfg.get("detection_enabled")
    if enabled is False:
        if allow_override_disabled:
            logger.warning("[zone-config] zone %s says detection_enabled=false, but "
                           "--allow-detection-when-disabled is set (DEV ONLY) — detection "
                           "will run anyway.", server_cfg.get("zone_id"))
            config.detection_enabled = True
        else:
            config.detection_enabled = False
            logger.warning("[zone-config] detection is DISABLED for zone %s (%s) — the "
                           "camera keeps running but NO new alerts will be created.",
                           server_cfg.get("zone_id"), server_cfg.get("zone_name"))
    elif enabled is True:
        config.detection_enabled = True

    monitored = server_cfg.get("monitored_classes")
    if isinstance(monitored, list) and monitored:
        allowed = {str(c).strip().lower() for c in monitored}
        config.person_labels = set(config.person_labels) & allowed
        config.unattended_object_labels = set(config.unattended_object_labels) & allowed
        config.pest_labels = set(config.pest_labels) & allowed
        logger.info("[zone-config] monitored_classes=%s -> person=%s objects=%s pests=%s",
                    sorted(allowed), sorted(config.person_labels),
                    sorted(config.unattended_object_labels), sorted(config.pest_labels))

    if "unattended_threshold_seconds" not in cli_overrides:
        value = server_cfg.get("unattended_threshold_seconds")
        if isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0:
            config.unattended_time_sec = float(value)
            logger.info("[zone-config] unattended_time_sec <- %.0fs (server).", float(value))

    if "alert_cooldown_seconds" not in cli_overrides:
        value = server_cfg.get("alert_cooldown_seconds")
        if isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0:
            config.alert_cooldown_sec = float(value)
            config.pest_alert_cooldown_sec = float(value)
            logger.info("[zone-config] alert_cooldown_sec <- %.0fs (server).", float(value))
