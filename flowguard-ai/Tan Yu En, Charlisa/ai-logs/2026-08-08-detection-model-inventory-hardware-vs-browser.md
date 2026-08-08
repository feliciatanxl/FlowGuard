# AI Log — Detection Model Inventory: Hardware vs Browser Source Modes
**Date:** 2026-08-08
**Branch:** feature/object-detection-v2
**Tool:** Claude Code (Opus 5)

---

## Task 1 — Which AI model does the hardware use?

**Prompt:** "what ai model am i using for the hardware"

**Response summary:** Established that "the hardware" is not one model, and that the answer differs by hardware path. Located the sources by listing the hardware-adjacent directories (`raspberry-pi/`, `edge/`, `arduino/`, `facial-recognition/`) and grepping the repo for detection-framework markers (`yolo|tflite|onnx|hailo|coral|edgetpu|mobilenet|nanodet|.pt|.rpk`).

**Raspberry Pi 5 + Sony IMX500 (SecurePi edge node)** — inference runs on the IMX500 sensor's own NPU, not the Pi CPU; `docs/securepi-flowguard-edge-ai.md:30-31` states the Pi CPU only reads detection tensors out of Picamera2 metadata and performs tracking/alert logic, and explicitly warns the IMX500 path must not be described as CPU inference on an ordinary camera. Two model options exist:

- **Stock (the working path):** precompiled COCO **SSD MobileNetV2** or **NanoDet** `.rpk` shipped with the IMX500 packages, supporting `person`, `backpack`, `handbag`, `suitcase` (`securepi-flowguard-edge-ai.md:193`, `:201`).
- **Custom (not validated):** **YOLOv8-n** trained on six classes — `person`, `backpack`, `handbag`, `suitcase`, `rat`, `mouse` — via `dataset prep → YOLOv8-n training → ONNX export → Sony IMX500 compilation → .rpk + labels copied to Pi` (`:187-188`). Required for pest detection, and blocked: the on-device parser handles SSD three-tensor `_pp` or NanoDet output, **not raw YOLOv8 tensors**, so it needs a YOLO decode + class-wise NMS branch (`:214`, `:217`).

Also noted the Pi 4 + Camera Module 3 development path that runs `best.pt` on the Pi CPU (`:39`), useful for validating shared tracking logic but unable to validate `.rpk` loading or IMX500 output parsing.

**Second, separate Pi node:** `raspberry-pi/pi_camera_steam.py` runs **no model at all** — it is a Flask MJPEG/snapshot node on port 8081 with a single capture thread and a latest-frame-only JPEG cache. All inference for that node happens off-device.

For contrast, identified the server-side models in `ai-service/`: **YOLOv8n** (`yolov8n.pt`, ultralytics) at `main.py:28` and **InsightFace `buffalo_l`** at `main.py:55`, both CPU-only in Cloud Run per the Dockerfile comments.

**Caveat recorded at the time:** every hardware-side fact here comes from `docs/securepi-flowguard-edge-ai.md`, not from the Pi's executing code. As the 2026-08-06 log established, `securePi.py` is absent from this branch and the Pi runs a separate-lineage copy from its own folder, so the doc is the only in-repo authority and was not cross-checked against the device this session.

**Outcome:** Answered. Summarised as: for the demo, the hardware runs **stock COCO SSD MobileNetV2/NanoDet on the IMX500**, with a custom six-class YOLOv8-n trained but not yet runtime-compatible. No correction requested.

---

## Task 2 — And for webcam / uploaded video?

**Prompt:** "wait then for webcam and upload video what ai model isthat"

**Response summary:** Traced both browser source modes and found they share one identical path — only the hardware mode diverges. `sourceMode` is `'camera'`, `'file'`, or `'hardware'` (`client/src/pages/ObjectDetection.jsx:132`). For the first two, the browser draws the video frame to a canvas, encodes base64 JPEG, and POSTs it through the Node proxy at `server/routes/yolo.js:65` to the ai-service endpoint at `ai-service/main.py:1297`, which calls `_yolo_model(...)` at `main.py:886`.

So webcam and upload both use **server-side YOLOv8n** (`yolov8n.pt`, stock COCO weights, ultralytics), loaded once at startup — *not* browser-side inference. Inference config is env-driven at `main.py:589-591`: `imgsz=768`, `conf=0.18`, plus a hardcoded `iou=0.45` and an optional `YOLO_CLASS_IDS` filter that defaults to all classes.

Flagged that a second model is layered on top: detected person boxes are cropped and passed to `_recognize_person_crop` (`main.py:855`, called at `:925`) to attach a name via **InsightFace `buffalo_l`** — so a webcam or upload session is actually YOLOv8n + InsightFace running together, gated by `_FACE_RECOG_MAX_PEOPLE`.

The only difference between the two browser modes is capture quality, not the model — `ObjectDetection.jsx:428-429` gives uploaded video `maxWidth` 1280 / JPEG quality 0.72 versus the webcam's 960 / 0.62, with a source comment that this preserves smaller objects in uploaded CCTV footage. Also confirmed hardware mode deliberately skips the analyze-frame poll (`ObjectDetection.jsx:225`), so no frames are ever sent to YOLOv8n when the Pi is the source.

**Outcome:** Answered with a three-row source-mode/model table. Accepted — no correction.

---

## Task 3 — Can the webcam use the same model as the hardware?

**Prompt:** "then can the webcam use the same model as the hardware"

**Response summary:** Split the question into the compiled artifact versus the trained weights, then read the class-handling code to assess what would actually break.

**The compiled `.rpk` — no.** It is Sony IMX500-specific, compiled for the sensor's NPU, and cannot be loaded by ultralytics or OpenCV on a laptop or Cloud Run. True for both the stock and any custom `.rpk`. Argued this is no real loss: matching the hardware's *stock* SSD MobileNetV2 would be a downgrade from YOLOv8n.

**The custom six-class weights — yes, nearly drop-in.** Since the hardware pipeline's upstream artifact is a plain ultralytics YOLOv8-n checkpoint (`best.pt`), pointing `main.py:28` at it would run the same trained network the IMX500 is meant to run. Verified *why* it would mostly work rather than asserting it: `main.py:913` branches on class **name** (`results.names[cls_id]`), not raw index, and ultralytics reads names from the checkpoint. `person`, `backpack`, `handbag`, `suitcase` exist in both class sets, so person counting, owner proximity, unattended timers, and face recognition would keep working untouched.

Four concrete breakages identified by reading the code rather than assuming:

1. **`YOLO_CLASS_IDS` must stay unset or be remapped.** `main.py:574-575` documents it as COCO indices (24/26/28 for the bags); a six-class model only has 0–5, so COCO values would filter to nothing. Checked `ai-service/.env.example`, `deployment/cloud-run/env.example`, and the Dockerfile — the var is absent from all three, so the `None`/all-classes default is already safe; the risk is only in setting it later.
2. **`rat`/`mouse` would produce no alerts.** Neither is in `_UNATTENDED_CLASSES`, `_FOOD_CLASSES`, or `_VEHICLE_CLASSES` (`main.py:568-573`), so both fall through to the `else` branch at `main.py:986` → `type: "object"`, `status: "normal"`. The hardware has a dedicated `PestTracker` with its own confidence, time/frame confirmation and cooldown (`securepi-flowguard-edge-ai.md:75`); ai-service has no equivalent.
3. **`mouse` is a genuine semantic collision.** COCO `mouse` (id 64) is a computer mouse; the custom model's `mouse` is a rodent — and the comment at `main.py:587-588` explicitly lists mouse among the office objects the tuned `imgsz`/`conf` values are meant to retain. Same string, opposite meanings, so a rodent would render as harmless office equipment.
4. **Most detectable classes would be lost.** `bottle`, `cup`, `book`, `cell phone`, `laptop` are all in `_UNATTENDED_CLASSES`, plus `banana`/`apple`/`orange` and `truck` in the food and vehicle sets — a six-class model detects none of them, shrinking the unattended-object demo to bags only.

Also noted `best.pt` is not in this repo (it is tracked in the SecurePi repo, and `securepi-flowguard-edge-ai.md:195` says model artifacts should not be committed to FlowGuard).

Recommended adding it as a *selectable* model via a `YOLO_MODEL_PATH` env var defaulting to `yolov8n.pt`, rather than replacing the stock weights — this keeps the COCO class coverage for the main demo while giving a way to show pest detection working while the IMX500 YOLO-decode/NMS issue stays open. Attached the caution from `securepi-flowguard-edge-ai.md:254`: a rodent demo run this way must be described as webcam inference, not a live IMX500 result.

**Unverified assumptions, stated for the record:** the six-class order (`person, backpack, handbag, suitcase, rat, mouse`) is taken from `securepi-flowguard-edge-ai.md:55`, not read from a checkpoint; `best.pt`'s existence, class names, and quality were not inspected, since the file is not in this repo. A real swap should confirm `model.names` before relying on the name-based branching argument above.

**Outcome:** Answered — feasible for the weights, not the compiled artifact. Ended by offering to implement the `YOLO_MODEL_PATH` switch plus a pest branch in `_annotate_detection_frame`; **no code was changed** this session, and the offer was not taken up before the log request.

---

## Task 4 — Save this session log

**Prompt:** "Summarize the entire session as a markdown log, per-task prompt/response-summary/outcome, saved as `<yyyy-mm-dd>-<task>.md` in `ai-logs/<name>/`."

**Response summary:** Followed the established repo convention `flowguard-ai/<Full Name>/ai-logs/` rather than a literal top-level `ai-logs/`, matching this identity's prior logs. Read `2026-08-06-securepi-stream-and-snapshot-retrieval.md` to match its structure and to avoid restating findings already logged, and listed the folder to pick a non-colliding filename.

**Outcome:** Completed — written to `flowguard-ai/Tan Yu En, Charlisa/ai-logs/2026-08-08-detection-model-inventory-hardware-vs-browser.md`. Nothing committed, per this folder's convention.

---

## Session character

Read-only throughout — a model-inventory and feasibility session, no files modified and no commands run against the Pi. All conclusions come from repo source and `docs/securepi-flowguard-edge-ai.md`.

## Open items carried out of this session

1. **`YOLO_MODEL_PATH` env switch not implemented** — the hardcoded `'yolov8n.pt'` at `main.py:28` is the same item already logged on 2026-08-03 and 2026-08-06 as an unactioned hardcoding fix. Task 3 gives it a concrete new motivation beyond tidiness.
2. **No pest branch in ai-service** — `rat`/`mouse` would silently fall through to `status: "normal"`, so loading the custom weights alone would not yield pest alerts.
3. **`mouse` name collision undocumented in code** — worth a comment at `main.py:568-573` before anyone swaps models, since the failure is silent mislabelling rather than an error.
4. **Custom model class order unverified against a real checkpoint** — the name-based branching argument in Task 3 depends on `best.pt`'s `model.names`, which was never inspected.
5. **IMX500 custom-model parser gap unchanged** — the YOLO decode / class-wise NMS branch (`securepi-flowguard-edge-ai.md:214`) is still the blocker for live pest detection on hardware; nothing this session touched it.
