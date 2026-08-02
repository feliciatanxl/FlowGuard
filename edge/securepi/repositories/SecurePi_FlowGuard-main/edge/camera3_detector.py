#!/usr/bin/env python3
"""Camera Module 3 (Raspberry Pi 4) CPU-inference detector for SecurePi.

Runs the six-class custom model (``securepi_model_bundle/best.pt``, copied to
``models/best.pt``) with Ultralytics on the Pi CPU and converts each result into the
SAME common ``Detection`` objects the IMX500 path produces, so both feed the identical
shared pipeline (trackers, unattended/pest logic, snapshot upload, FlowGuard outbox).
See ``run_camera3.py`` for the runner.

Import-safe off-device: Ultralytics is imported lazily so ``--help`` and the off-device
unit tests (which exercise the pure conversion/validation helpers) work without it.
"""

from __future__ import annotations

import logging

from securePi import Detection  # the shared detection structure — box is (x, y, w, h) px

LOGGER = logging.getLogger("securepi.camera3")

# Authoritative six-class mapping for the custom model. run_camera3 REFUSES to run a
# model whose names differ (e.g. stock yolov8n.pt with 80 COCO classes) because a silent
# mismatch would mislabel every detection. Matches securepi_model_bundle/dataset.yaml.
EXPECTED_NAMES = {0: "person", 1: "backpack", 2: "handbag", 3: "suitcase", 4: "rat", 5: "mouse"}


def validate_model_names(names) -> None:
    """Raise ValueError unless *names* is exactly the expected six-class mapping.

    Accepts an Ultralytics ``model.names`` dict ({0: 'person', ...}) or a list in index
    order. The label text is compared case-insensitively but the index/order is strict.
    """
    if isinstance(names, dict):
        actual = {int(k): str(v).lower() for k, v in names.items()}
    else:
        actual = {i: str(v).lower() for i, v in enumerate(names or [])}
    if actual != EXPECTED_NAMES:
        raise ValueError(
            "Unexpected model class mapping.\n"
            f"  expected: {EXPECTED_NAMES}\n"
            f"  actual:   {actual}\n"
            "Refusing to run: a wrong class order/mapping silently mislabels every "
            "detection. Use the six-class custom best.pt (person, backpack, handbag, "
            "suitcase, rat, mouse) — NOT the stock yolov8n.pt."
        )


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def ultralytics_to_detections(boxes_xyxy, scores, class_ids, names,
                              frame_w: int, frame_h: int,
                              threshold: float = 0.0) -> list:
    """Convert Ultralytics xyxy outputs into common ``Detection`` objects.

    * ``xyxy`` (original-image space) → ``(x, y, w, h)`` pixels, the repo's box
      convention — so the boxes are interchangeable with the IMX500 path's.
    * Boxes are clamped to the actual captured frame, so a box can never exceed it.
    * Confidence stays a 0..1 float; detections below *threshold* are dropped here (the
      shared pipeline then applies each category's own threshold).
    * The class index maps to a lower-case label via *names* (by position).

    Pure and dependency-light (plain iterables) so it is unit-testable off-device.
    """
    detections = []
    if isinstance(names, (list, tuple)):
        def label_of(i):
            return str(names[i]).lower() if 0 <= i < len(names) else str(i)
    else:
        def label_of(i):
            return str(names.get(i, i)).lower()

    for box, score, cls in zip(boxes_xyxy, scores, class_ids):
        s = float(score)
        if s < threshold:
            continue
        x1, y1, x2, y2 = float(box[0]), float(box[1]), float(box[2]), float(box[3])
        # Normalise in case a model ever emits reversed corners.
        if x2 < x1:
            x1, x2 = x2, x1
        if y2 < y1:
            y1, y2 = y2, y1
        x1 = _clamp(x1, 0, frame_w)
        y1 = _clamp(y1, 0, frame_h)
        x2 = _clamp(x2, 0, frame_w)
        y2 = _clamp(y2, 0, frame_h)
        w = x2 - x1
        h = y2 - y1
        if w <= 0 or h <= 0:
            continue  # degenerate/off-frame box
        detections.append(
            Detection(label_of(int(cls)), s, (round(x1), round(y1), round(w), round(h)))
        )
    return detections


class Camera3Detector:
    """Loads best.pt with Ultralytics and turns a captured frame into Detections."""

    def __init__(self, config) -> None:
        try:
            from ultralytics import YOLO
        except ImportError as exc:  # pragma: no cover - import guard
            raise RuntimeError(
                "Ultralytics is required for the Camera Module 3 path. Install it into "
                "the Pi venv (pip install ultralytics + a CPU torch build). The IMX500 "
                "path does not need it."
            ) from exc
        self.imgsz = int(getattr(config, "imgsz", 320))
        # Lowest of the two category thresholds so pest candidates below min_confidence
        # still reach split_detections(), which applies each category's own threshold.
        self.threshold = min(config.min_confidence, config.pest_confidence)
        self.model = YOLO(config.model_path)
        validate_model_names(self.model.names)  # fail loudly on a wrong/stock model
        LOGGER.info("Camera Module 3 detector ready: model=%s imgsz=%d names=%s",
                    config.model_path, self.imgsz, self.model.names)

    def detect(self, frame) -> list:
        """Run inference on a BGR frame (Picamera2 RGB888 delivers BGR) and convert.

        Ultralytics rescales its outputs back to the ORIGINAL image size, so the returned
        xyxy are already in the captured-frame pixel space.
        """
        h, w = int(frame.shape[0]), int(frame.shape[1])
        results = self.model.predict(frame, imgsz=self.imgsz, conf=self.threshold, verbose=False)
        if not results:
            return []
        boxes = getattr(results[0], "boxes", None)
        if boxes is None or len(boxes) == 0:
            return []
        xyxy = boxes.xyxy.tolist()
        scores = boxes.conf.tolist()
        class_ids = [int(c) for c in boxes.cls.tolist()]
        return ultralytics_to_detections(xyxy, scores, class_ids, self.model.names, w, h, self.threshold)
