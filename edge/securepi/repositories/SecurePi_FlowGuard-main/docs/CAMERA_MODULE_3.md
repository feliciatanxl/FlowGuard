# Camera Module 3 (Raspberry Pi 4) CPU-inference path

This documents the **development-hardware** object-detection path: a Raspberry Pi 4 +
Camera Module 3 (Sony IMX708) running the six-class custom model **`best.pt`** with
Ultralytics on the Pi CPU. It exists so the whole SecurePi → FlowGuard pipeline can be
validated **without** the final AI camera.

> [!IMPORTANT]
> **This path validates shared behaviour, NOT IMX500 deployment.**
> Passing every test here (model loading, six-class labels, detection quality, boxes,
> confidence, tracking, unattended/pest logic, snapshot upload, cloud ingest, incident
> display) proves the **shared** pipeline works. It does **not** prove the Raspberry Pi 5
> + IMX500 AI Camera will work: `.rpk` packaging/loading, output-tensor count/order,
> post-processing, bounding-box scaling, class mapping, confidence behaviour and camera
> metadata parsing **still require physical IMX500 hardware**. See
> [MODELS.md](MODELS.md) → *Known model-parser limitation*.

## Architecture — the two paths differ only at the detector

Both camera paths converge on ONE shared implementation. Only how a frame + its
`Detection` list are produced differs:

```
Camera Module 3  ->  Picamera2 captures a normal frame
                 ->  Ultralytics runs best.pt on the Pi CPU
                 ->  common Detection(label, score, box=(x,y,w,h))  ─┐
                                                                     ├─> [ shared MonitorPipeline ]
IMX500 camera    ->  on-sensor inference -> metadata parser         │      monitored-class filter
                 ->  common Detection(label, score, box=(x,y,w,h))  ─┘      person / bag / pest trackers
                                                                            owner association
                                                                            unattended + pest timers
                                                                            cooldown -> snapshot -> upload
                                                                            FlowGuard outbox + retry
```

The trackers, alert logic, snapshot handling and cloud client are **reused verbatim**
(`securePi.MonitorPipeline`) — there is no second copy for Camera Module 3. The IMX500
runtime (`edge/securePi.py`) is preserved unchanged in behaviour.

## Camera contention with facial recognition

Object detection and the facial-recognition process both open Camera Module 3, and **two
processes cannot open the same camera at once**. For now, **stop the facial-recognition
process before running object detection.** A future combined design would use one shared
Picamera2 capture feeding both; rewriting facial recognition is out of scope here.

## Setup (Raspberry Pi OS Bookworm, 64-bit)

```bash
# 1) System camera stack (apt, not pip — matches libcamera/Qt/firmware)
sudo apt update
sudo apt install -y python3-picamera2 python3-opencv python3-venv

# 2) A venv that can still see the apt-installed picamera2/opencv
python3 -m venv --system-site-packages ~/securepi-venv
source ~/securepi-venv/bin/activate

# 3) Camera Module 3 (CPU-inference) Python deps — Ultralytics + CPU torch
pip install -r edge/requirements-camera3.txt

# 4) Provide the six-class model (git-ignored, never committed)
mkdir -p models
cp /path/to/securepi_model_bundle/best.pt models/best.pt
```

The model is validated at startup — SecurePi refuses to run a model whose classes are not
exactly `person, backpack, handbag, suitcase, rat, mouse` (so a stock `yolov8n.pt` fails
loudly instead of silently mislabelling).

## Verify the camera

```bash
rpicam-hello --list-cameras          # expect sensor: imx708
rpicam-jpeg -o camera-test.jpg --timeout 2000
```

## Run command

```bash
python3 edge/run_camera3.py \
  --model models/best.pt \
  --zone-id 3 \
  --device-id securepi-kitchen-01 \
  --imgsz 320 \
  --confidence 0.50 \
  --frame-skip 2 \
  --headless
```

Configurable defaults (override via CLI/env, not hard-coded): capture 640×480, inference
size `--imgsz 320`, confidence `--confidence 0.50`, `--frame-skip 2`. Omit `--headless`
for a live preview window (needs a desktop/X session).

### Live zone config

Add `--zone-config-enabled` (or `FLOWGUARD_ZONE_CONFIG_ENABLED=true`) plus a configured
`FLOWGUARD_API_URL` / `EDGE_INGEST_TOKEN` so the Pi pulls its MonitoringZone settings from
the FlowGuard website. Precedence (later wins where present):

```
safe code defaults -> local preset/env -> cached server config -> current server config -> explicit CLI override
```

A CLI override never silently re-enables detection when the zone says
`detection_enabled=false` — that needs the explicit, loudly-logged
`--allow-detection-when-disabled` (dev only). A cloud outage falls back to the last-known
cached config, then to local defaults; invalid config is rejected without crashing, and
secrets are never written to the cache.

## Camera-independent cloud test (no camera at all)

```bash
FLOWGUARD_API_URL=http://localhost:5001 \
EDGE_INGEST_TOKEN=dev-securepi-token \
SECUREPI_DEVICE_ID=securepi-kitchen-01 \
SECUREPI_CAMERA_LOCATION="Kitchen Camera 01" \
python3 edge/send_test_event.py --type pest --with-snapshot
```

Prints the resolved URL, event id, HTTP status and result (and uploads a real snapshot
with `--with-snapshot`). Supports `--type pest|rat|unattended|crowd|motion`. The bearer
token is never printed.

## Manual Pi 4 test checklist

| # | Action | Expected |
|---|--------|----------|
| 1 | Person only | person box; no pest/bag alert |
| 2 | Person holding backpack | person + backpack boxes |
| 3 | Bag set down, owner nearby | bag associated with owner; no unattended alert |
| 4 | Owner leaves the bag | unattended timer starts; alert only after the configured duration; cooldown prevents spam |
| 5 | Rat | rat detected; pest confirmation applied; snapshot uploaded; cloud event accepted; **incident side panel shows `rat`** |
| 6 | Mouse | mouse detected (if the test case is recognised) |
| 7 | Detection disabled on the website | no new edge alerts |
| 8 | Class removed from monitored_classes | that class creates no alerts |
| 9 | Cloud disconnected | event retained in the outbox |
| 10 | Cloud restored | queued event sent |
| 11 | Wrong token | clear 401/403 config error; event NOT deleted |
| 12 | Duplicate event id | no duplicate incident |
| 13 | Snapshot | image opens from the Incident side panel |

## Remaining IMX500-only work (physical Pi 5 + IMX500 required)

`.rpk` creation/loading, output-tensor inspection (use the one-shot `--debug-tensors`
option on the IMX500 runner), parser verification, label mapping, bounding-box scaling,
confidence validation, and the end-to-end physical IMX500 test. None of these can be
validated on Camera Module 3.
