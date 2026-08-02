#!/usr/bin/env python3
"""SecurePi — Raspberry Pi 4 + Camera Module 3 CPU-inference runner.

Captures normal frames with Picamera2, runs the six-class custom ``best.pt`` with
Ultralytics on the Pi CPU, and feeds the resulting common ``Detection`` objects into the
SAME shared pipeline (person/bag/pest trackers, unattended + pest logic, cooldown,
snapshot capture + upload, FlowGuard outbox) used by the IMX500 path. Use this on the
development hardware (Pi 4 + Camera Module 3 / IMX708), which has no on-sensor inference.

The two camera paths differ ONLY here at the detector/input layer:

    Camera Module 3  ->  Picamera2 captures a frame  ->  Ultralytics runs best.pt on CPU
                     ->  common Detection objects  ->  [shared MonitorPipeline]
    IMX500 (securePi.py) ->  on-sensor inference  ->  metadata parser
                     ->  common Detection objects  ->  [shared MonitorPipeline]

Camera contention: this OWNS the camera while running. The facial-recognition process
(also Camera Module 3) cannot open the same camera at the same time — STOP facial
recognition before running this. A future combined design would share one Picamera2
capture; rewriting facial recognition is out of scope here.

Example:
    python3 edge/run_camera3.py --model models/best.pt --zone-id 3 \
        --device-id securepi-kitchen-01 --imgsz 320 --confidence 0.50 \
        --frame-skip 2 --headless
"""

from __future__ import annotations

import argparse
import logging
import os
import signal
import sys
import time
from pathlib import Path

import cv2

try:
    from picamera2 import Picamera2
    _PICAMERA2_AVAILABLE = True
except ImportError:  # let --help / tests work off-device
    Picamera2 = None  # type: ignore[assignment]
    _PICAMERA2_AVAILABLE = False

sys.path.insert(0, str(Path(__file__).resolve().parent))  # edge/ on path

from securePi import (  # noqa: E402
    Config, MonitorPipeline, DEFAULT_RUNTIME_DIR, _sigterm_exit,
    _resolve_project_path, _env_flag, _build_flowguard_client,
)

LOGGER = logging.getLogger("securepi.camera3")

# Default to the six-class custom model copied into the SecurePi repo. NOT a stock model.
DEFAULT_CAMERA3_MODEL = "models/best.pt"


def parse_args(argv=None) -> argparse.Namespace:
    d = Config()  # single source of truth for defaults
    p = argparse.ArgumentParser(
        description="SecurePi — Camera Module 3 (Pi 4, Ultralytics CPU) object/pest monitor.",
    )
    p.add_argument("--model", default=os.environ.get("SECUREPI_MODEL_PATH", DEFAULT_CAMERA3_MODEL),
                   help="Path to the six-class Ultralytics model (default: SECUREPI_MODEL_PATH "
                        f"or {DEFAULT_CAMERA3_MODEL}).")
    p.add_argument("--zone", default=d.zone,
                   help="Location/zone tag recorded in the event log and used to group snapshots.")
    p.add_argument("--zone-id", dest="zone_id", default=os.environ.get("SECUREPI_ZONE_ID"),
                   help="MonitoringZone id for fetching live zone config (default from SECUREPI_ZONE_ID).")
    # --- Detection knobs ---
    p.add_argument("--imgsz", type=int, default=d.imgsz,
                   help="Ultralytics inference size (default: %(default)s).")
    p.add_argument("--confidence", "--min-confidence", dest="min_confidence", type=float,
                   default=d.min_confidence,
                   help="Minimum person/object confidence 0..1 (default: %(default)s).")
    p.add_argument("--pest-confidence", type=float, default=d.pest_confidence,
                   help="Confidence threshold for pest detections 0..1 (default: %(default)s).")
    p.add_argument("--frame-skip", type=int, default=d.frame_skip,
                   help="Run inference on every Nth captured frame (default: %(default)s; 1 = every frame).")
    # Sentinel (None) defaults so we can tell an EXPLICIT CLI override apart from the
    # code default — an explicit value wins over the server zone config (precedence).
    p.add_argument("--unattended-time", type=float, default=None,
                   help="Seconds before an unattended object alerts (overrides zone config).")
    p.add_argument("--alert-cooldown", type=float, default=None,
                   help="Seconds between repeat alerts (overrides zone config).")
    p.add_argument("--pest-confirmation-time", type=float, default=d.pest_confirmation_time,
                   help="Seconds a pest must stay visible to be confirmed (default: %(default)s).")
    p.add_argument("--pest-confirmation-frames", type=int, default=d.pest_confirmation_frames,
                   help="Consecutive frames that alternatively confirm a pest (default: %(default)s).")
    # --- Runtime output / mode ---
    p.add_argument("--headless", action="store_true", help="Run without a preview window.")
    p.add_argument("--runtime-dir", type=Path, default=d.runtime_dir,
                   help="Root directory for runtime output (default: %(default)s).")
    p.add_argument("--max-snapshots", type=int, default=d.max_snapshots,
                   help="Keep at most this many snapshots (default: %(default)s).")
    p.add_argument("--frame-width", type=int, default=d.frame_size[0], help="Capture width (default: %(default)s).")
    p.add_argument("--frame-height", type=int, default=d.frame_size[1], help="Capture height (default: %(default)s).")
    p.add_argument("--debug-tensors", action="store_true",
                   help="(IMX500 only — ignored here) present for CLI parity.")
    # --- Zone config (edge) ---
    p.add_argument("--zone-config-enabled", dest="zone_config_enabled", action="store_true",
                   default=_env_flag("FLOWGUARD_ZONE_CONFIG_ENABLED"),
                   help="Fetch live zone config from the backend (default from FLOWGUARD_ZONE_CONFIG_ENABLED).")
    p.add_argument("--no-zone-config", dest="zone_config_enabled", action="store_false",
                   help="Disable fetching live zone config.")
    p.add_argument("--allow-detection-when-disabled", dest="allow_override_disabled", action="store_true",
                   help="DEV ONLY: run detection even if zone config says detection_enabled=false (logged).")
    # --- FlowGuard cloud integration (names align with securePi._build_flowguard_client) ---
    p.add_argument("--flowguard-enabled", dest="flowguard_enabled", action="store_true",
                   default=_env_flag("FLOWGUARD_EDGE_ENABLED"),
                   help="Send detection events to FlowGuard (default from FLOWGUARD_EDGE_ENABLED).")
    p.add_argument("--flowguard-url", dest="flowguard_url", default=os.environ.get("FLOWGUARD_API_URL"),
                   help="FlowGuard backend base URL (default from FLOWGUARD_API_URL).")
    p.add_argument("--device-id", dest="device_id", default=os.environ.get("SECUREPI_DEVICE_ID"),
                   help="Stable device id (default from SECUREPI_DEVICE_ID).")
    p.add_argument("--camera-location", dest="camera_location", default=os.environ.get("SECUREPI_CAMERA_LOCATION"),
                   help="Human camera label sent to FlowGuard (default from SECUREPI_CAMERA_LOCATION).")
    p.add_argument("--outbox-dir", dest="outbox_dir", default=os.environ.get("SECUREPI_OUTBOX_DIR"),
                   help="Disk-backed outbox directory (default <runtime-dir>/alerts/outbox).")
    p.add_argument("-v", "--verbose", action="store_true", help="Enable debug logging.")
    return p.parse_args(sys.argv[1:] if argv is None else list(argv))


def build_config(args) -> tuple[Config, set]:
    """Build a Config from CLI args and return it plus the set of zone-config keys the
    user explicitly overrode on the CLI (those must win over the server zone config)."""
    cli_overrides = set()
    unattended = args.unattended_time
    if unattended is None:
        unattended = Config().unattended_time_sec
    else:
        cli_overrides.add("unattended_threshold_seconds")
    cooldown = args.alert_cooldown
    if cooldown is None:
        cooldown = Config().alert_cooldown_sec
    else:
        cli_overrides.add("alert_cooldown_seconds")

    config = Config(
        headless=args.headless,
        min_confidence=args.min_confidence,
        pest_confidence=args.pest_confidence,
        imgsz=args.imgsz,
        frame_skip=max(1, args.frame_skip),
        unattended_time_sec=unattended,
        alert_cooldown_sec=cooldown,
        pest_alert_cooldown_sec=cooldown,
        pest_confirmation_time=args.pest_confirmation_time,
        pest_confirmation_frames=args.pest_confirmation_frames,
        runtime_dir=args.runtime_dir,
        zone=args.zone,
        max_snapshots=args.max_snapshots,
        frame_size=(args.frame_width, args.frame_height),
        model_path=_resolve_project_path(args.model),
    )
    return config, cli_overrides


def _maybe_apply_zone_config(args, config, cli_overrides) -> None:
    """Fetch + apply live zone config when enabled; safe no-op on any failure."""
    if not getattr(args, "zone_config_enabled", False):
        return
    try:
        from zone_config import resolve_zone_config, apply_zone_config
    except ImportError:
        LOGGER.warning("[zone-config] zone_config module unavailable — using local config.")
        return
    token = os.environ.get("EDGE_INGEST_TOKEN")
    cache_path = Path(config.runtime_dir) / "config" / "zone_config.json"
    server_cfg, source = resolve_zone_config(
        args.flowguard_url, token, cache_path=cache_path,
        device_id=args.device_id, zone_id=args.zone_id,
        zone_name=config.zone, camera_location=args.camera_location,
        timeout=float(os.environ.get("SECUREPI_HTTP_TIMEOUT_SEC", "5") or 5),
    )
    apply_zone_config(config, server_cfg, cli_overrides=cli_overrides,
                      allow_override_disabled=getattr(args, "allow_override_disabled", False))
    LOGGER.info("[zone-config] source=%s detection_enabled=%s", source, config.detection_enabled)


def run_camera3(config: Config, client=None) -> None:
    """Capture with Picamera2, infer with Ultralytics best.pt, drive the shared pipeline."""
    if not _PICAMERA2_AVAILABLE:
        raise RuntimeError(
            "Picamera2 is unavailable. Install the Pi camera stack: "
            "`sudo apt install -y python3-picamera2 python3-opencv`."
        )
    from camera3_detector import Camera3Detector  # lazy: needs Ultralytics
    detector = Camera3Detector(config)

    for sub in (config.snapshot_dir, config.log_dir, config.runtime_dir / "alerts"):
        Path(sub).mkdir(parents=True, exist_ok=True)

    if client is not None:
        client.start()  # flush anything queued by a previous run

    picam2 = Picamera2()
    # RGB888 yields a 3-channel BGR array — what OpenCV and Ultralytics expect.
    cam_config = picam2.create_preview_configuration(
        main={"size": config.frame_size, "format": "RGB888"}, buffer_count=4,
    )
    picam2.configure(cam_config)
    picam2.start()

    signal.signal(signal.SIGTERM, _sigterm_exit)  # systemd stop -> clean shutdown

    pipeline = MonitorPipeline(config, client=client)
    LOGGER.info("Camera Module 3 monitor started (%s mode, frame-skip=%d). Press 'q' to quit.",
                "headless" if config.headless else "preview", config.frame_skip)
    if not config.detection_enabled:
        LOGGER.warning("Detection is DISABLED by zone configuration — previewing only, no alerts.")

    frame_index = 0
    try:
        while True:
            frame = picam2.capture_array("main")
            now = time.monotonic()
            frame_index += 1
            run_inference = (frame_index % config.frame_skip == 0)

            if run_inference:
                detections = detector.detect(frame)
                # frame is already in hand, so the factory just returns it.
                out = pipeline.process(detections, now, lambda: frame)
                shown = out if out is not None else frame
            else:
                shown = frame  # skipped frame: preview only, trackers coast

            if not config.headless:
                cv2.imshow("SecurePi - Camera Module 3 Monitor", shown)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break
    except KeyboardInterrupt:
        LOGGER.info("Interrupted by user.")
    finally:
        picam2.stop()
        cv2.destroyAllWindows()
        if client is not None:
            client.stop(wait=True)
        LOGGER.info("Camera Module 3 monitor stopped.")


def main(argv=None) -> None:
    args = parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s", datefmt="%H:%M:%S",
    )
    config, cli_overrides = build_config(args)
    _maybe_apply_zone_config(args, config, cli_overrides)
    client = _build_flowguard_client(args, config)
    run_camera3(config, client=client)


if __name__ == "__main__":
    main()
