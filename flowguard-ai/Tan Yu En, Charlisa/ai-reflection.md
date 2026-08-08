# AI Reflection — Object Detection Module (Charlisa)

This module was built with the help of Claude Code. Raw prompt logs are in
[`ai-logs/`](./ai-logs/). My individual scope covers the full object-detection surface, not just
the YOLO dashboard: Camera Inventory, Detection Setup, Monitoring Zones, detection thresholds,
alert lifecycle, camera health, the SecurePi edge device and its PIR/ultrasonic sensor node, and
FM/Staff role-based access across all of it.

The work ran in roughly four phases, and the AI's usefulness changed noticeably between them:
(1) replacing frontend mock state with a real backend, (2) making Detection Setup actually drive
the AI engine instead of being cosmetic, (3) de-duplicating and de-hardcoding the detection
configuration, and (4) integrating real hardware — the Pi camera, a custom YOLO checkpoint, face
naming, and the Arduino sensor node.

## What AI helped with

### Phase 1 — Camera Inventory and Detection Setup off mock data
- Auditing the existing pages (`ObjectDetection.jsx`, `Cameras.jsx`, `CameraInventory.jsx`,
  `DetectionSettings.jsx`) against my corrected individual scope, and finding that Camera
  Inventory and the live camera wall were **100% frontend mock state** — no backend model, no
  route, nothing survived a page refresh.
- Designing and building the new `Camera` Sequelize model + `/api/cameras` CRUD route (FM
  create/edit/deactivate, Staff view-only, validation, duplicate-code `409`).
- Extending `MonitoringZone` in place with the Detection Setup fields (`monitored_classes`,
  `density_threshold`, `unattended_threshold_seconds`, `alert_cooldown_seconds`, `severity`,
  `assigned_team`, `detection_enabled`) rather than introducing a parallel table.
- Closing a real, already-documented security gap: `/api/zones` and `/api/detection-alerts` had
  **zero authentication** before this pass (flagged in `docs/rbac-access-control-report.md` as a
  known risk). Added `verifyToken`/`requireRole`, plus a `verifyServiceOrRole` middleware so the
  Python AI engine can still post alerts server-to-server via a shared `AI_SERVICE_KEY`.
- Rewiring `CameraInventory.jsx`, `Cameras.jsx`, and `DetectionSettings.jsx` off mock arrays and
  onto the real APIs, with loading/empty/offline states and Staff-vs-FM read-only UI.

### Phase 2 — Making Detection Setup actually drive detection
- Wiring `unattended_threshold_seconds` into `ai-service/main.py` so Detection Setup's threshold
  actually changes detection behaviour (with a fallback to the legacy minutes-based
  `time_threshold` for zones that haven't set the new field).
- Extracting `ai-service/zone_rules.py` as a **pure** zone-resolution module with deliberately no
  `cv2`/`ultralytics`/`insightface`/`psycopg2` imports, so the branching logic is unit-testable
  without booting the YOLO and InsightFace models or needing a live Postgres — importing `main.py`
  triggers all of that at module load. `main.py`'s `resolve_zone_for_request()` is now a thin
  DB-backed wrapper around `resolve_zone_config()`.
- Deciding, inside that resolution, that **the camera's current DB zone wins over a client-sent
  `zone_id`**, because the frontend's copy goes stale the moment Detection Setup is edited in
  another tab.
- Carrying the zone's `density_threshold` through the same path, so a zone's max-occupancy rule
  overrides the global `PERSON_CRITICAL_COUNT` default instead of being display-only.
- Building `server/utils/detectionAlertBridge.js`, the shared alert→`IncidentLog` type mapping used
  by **both** `detectionAlerts.js` (AI engine + manual FM/Staff alerts) and `edgeDetectionAlerts.js`
  (SecurePi), plus reverse sync so resolving/deleting an incident propagates back to its alert
  without recursion.

### Phase 3 — De-hardcoding and de-duplicating configuration
- Two hardcoded-values audits (`2026-08-03`, re-run `2026-08-06`) across `main.py`,
  `yolo_service.py`, `zone_rules.py`, the `Dockerfile`, both alert routes and the frontend.
- Creating `server/config/detectionTypes.js` as the single source of truth for `detection_type`,
  replacing a three-way copy-paste that was kept in sync only by a comment, and later extending it
  with the SecurePi edge categories (`PEST_DETECTION`, `RESTRICTED_MOTION`, `FORGOTTEN_BELONGING`,
  `ITEM_MOVEMENT`).
- Making the AI service's fallback threshold env-configurable (`DEFAULT_ZONE_THRESHOLD_SEC`),
  documented in `ai-service/.env.example`, with identical behaviour for deployments that never set
  it. Written up in `docs/Tan Yu En, Charlisa/zone-detection-hardcoding-cleanup.md`.

### Phase 4 — Real hardware: Pi camera, custom model, face naming, sensors
- Debugging why the SecurePi live feed was black despite the laptop and Pi being on the same
  hotspot. `Test-NetConnection` showed ping succeeding but TCP port 8001 refused, which located the
  fault Pi-side; the root cause was that MJPEG streaming is opt-in (`stream_enabled: bool = False`)
  and `--stream` was never passed, so the server simply never bound the port. Three earlier
  hypotheses (stale DHCP IP, the `hostname -i` vs `-I` trap, a branch mismatch) were investigated
  and discarded first.
- Adding a **per-source YOLO model**: `YOLO_WEBCAM_MODEL_PATH` loads my custom `best.pt` checkpoint
  and `_select_yolo_for_source()` applies it **only** to Browser Webcam frames, leaving uploads and
  the background detector on the stock COCO model. `YOLO_WEBCAM_CONFIDENCE` and
  `YOLO_WEBCAM_CLASS_IDS` are configured separately for the same reason.
- Face-recognition naming: a `_person_name_cache` keyed by a lightweight centroid tracker
  (`_assign_person_track`, tuned by `PERSON_TRACK_MATCH_DISTANCE_PX` / `PERSON_TRACK_TTL_SECONDS`),
  so a recognised name sticks to a person across frames instead of being re-derived every frame,
  and alerts carry `person_name` plus an `identity_status` of `VERIFIED`/`UNKNOWN`.
- After-hours restricted-zone motion and pest alerting: `_is_after_hours_now()` against a
  configurable window, a configurable `RESTRICTED_MOTION_CLASSES` set, and per-track cooldowns so
  one lingering subject doesn't spam alerts.
- The Arduino PIR + ultrasonic node (`arduino/FlowGuard_Ardunio.ino` emitting one JSON line per
  ~500 ms, assembled with `Serial.print()` and `F()` literals rather than a JSON library to avoid
  heap fragmentation) and its Pi-side reader `raspberry-pi4/sensor_bridge.py` — stdlib-only,
  threaded, with an EWMA distance baseline and a bounded inspection window.
- Persisting that telemetry: a `sensor_metadata` JSONB column on `detection_alerts`
  (`20260807_detection_alert_sensor_metadata.sql`), sanitised on the edge-ingest path, and rendered
  in the new `SecurityCamera.jsx` page alongside identity status and stream diagnostics.
- Writing the backend Jest tests, the frontend Vitest tests, the Python tests, the API/DB
  documentation, and this reflection.

## What I manually reviewed
- **Scope boundary.** Before any code changed, I confirmed with the assistant exactly which files
  were mine (Camera/MonitoringZone/DetectionAlert models, cameras/zones/detectionAlerts routes, the
  camera/detection pages, and the AI engine's alert-posting + threshold functions) and which
  were explicitly off-limits (Felicia's Face Enrollment, Gate Scanner, Attendance, Security Review,
  User/Tenant Management). I checked the diff against this list before accepting it.
- **Real vs. fake data.** I checked that Camera Inventory and the Object Detection camera picker
  are backed by the actual `/api/cameras` endpoint — no hardcoded camera arrays remain in either
  page, and no bounding boxes are synthesized (they still come from real YOLO inference).
- **The two-threshold decision.** I deliberately kept `time_threshold` (minutes, legacy, read by
  the AI engine) and `unattended_threshold_seconds` (seconds, new, Detection-Setup-facing) as
  separate columns rather than reinterpreting the old one, then confirmed the AI engine's fallback
  logic actually prefers the new field when it's set.
- **Auth gap closure.** I traced that the Python AI engine's `_fire_alert` was the only caller of
  `POST /api/detection-alerts`, so adding role enforcement there needed a service-key bypass rather
  than a JWT — I verified all three call sites in `main.py` go through the same `_fire_alert`
  function, so one header addition covers every alert path.
- **The custom checkpoint's class indices.** `best.pt` is a 6-class model; the COCO `YOLO_CLASS_IDS`
  values are meaningless against it. I checked that the webcam path uses its own class-id setting
  defaulting to "all", and documented the trap in `.env.example` rather than leaving someone to
  discover it by getting silently empty detections.
- **Where the snapshot actually breaks.** I traced the full snapshot path and confirmed the server
  side is complete (multer field `snapshot`, JPEG-only filter, size cap, authenticated blob fetch
  in the UI) and that the gap is entirely Pi-side: its bridge posts `application/json` and never
  attaches the JPEG. I verified this by grepping the Pi's own source for `multipart|form-data|
  boundary` and getting no hits at all — not by assuming.
- **That a Pi filesystem path is never used as an image source.** `ObjectDetection.jsx` gates image
  `src` on `^https?://` or the `/api/detection-alerts/:id/snapshot/:file` form. I confirmed the
  guard is still intact after the snapshot work, since a local Pi path rendered as a `src` is both
  broken and a small information leak.

## What code I accepted / rejected / adjusted
- **Accepted:** extending `MonitoringZone` in place (no new `DetectionSetup` table) — the app's
  detection rules are genuinely one-per-zone, so a second table would have been unused complexity.
- **Accepted:** splitting `zone_rules.py` out of `main.py`. The suggestion came from wanting the
  logic tested, and it turned out to be the only way to test it at all — `main.py` loads YOLO and
  InsightFace at import time, so any test touching it needs the models present.
- **Adjusted:** the original plan considered keeping `time_threshold`'s minutes-only semantics and
  only documenting the seconds conversion. After review, I asked for the AI engine to actually
  consume the new seconds field (with a documented fallback) so Detection Setup isn't cosmetic.
- **Adjusted:** the first proposal applied the custom `best.pt` model everywhere. I scoped it to
  the Browser Webcam source only — it's trained for that framing, and swapping the model under
  uploaded video and the background detector would have silently changed behaviour I hadn't tested.
- **Adjusted:** the incident-type text fallback originally matched the generic person/crowd
  heuristic first, which meant a rat sighting could be logged as `OVERCROWDING`. I had the specific
  edge categories matched *before* the generic one, and left a comment saying the order is load-bearing.
- **Rejected:** letting the PIR/ultrasonic sensors raise alerts on their own. A sensor trip only
  opens a bounded inspection window; the camera still has to classify what moved. A PIR sensor
  cannot tell a person from a curtain, and an alert that can't say what it saw isn't actionable.
- **Rejected:** a fuller rewrite of the AI engine's per-camera stream routing. The stock pipeline
  only supports one active video source; pretending the camera picker on Object Detection switches
  real streams would have been dishonest. I kept the picker as a labeling control and documented
  the limitation instead of overselling the integration.
- **Rejected (deferred):** rebuilding the Pi's snapshot upload from the repo's copy of the edge
  code. The Pi runs a different-lineage build from its own folder, and two attempts to extract its
  bridge class failed, so writing a patch against the repo version would have been guesswork. I had
  the assistant write a precise, contract-accurate prompt for the Pi's own agent instead.
- **Added beyond the original request:** a double-click delete confirmation on Camera Inventory.
  Deletion is now a real, persisted deactivation (previously it just mutated in-memory mock state),
  so an accidental click has real consequences — worth the small addition.

## How I verified correctness
- `cd server && npx jest "tests/Tan Yu En, Charlisa"` → **8 suites / 190 tests pass** (cameras,
  detection-setup, detection-types-config, detection-alerts, detection-alert-bridge,
  edge-detection-alerts, incident-auth, incident-detection-sync).
- `cd server && npx jest` (whole repo) → **50 of 51 suites and 757 tests pass**. The one suite that
  doesn't run is `tests/gcs-detection-snapshots.test.js` (Felicia's GCS snapshot work), which fails
  at import with `Cannot find module '@google-cloud/storage'` — the dependency isn't installed in my
  local checkout. It is a missing local dependency, not a failing assertion, and it is not one of
  my suites, but I'm recording it rather than quoting a clean number.
- `cd client && npx vitest run "tests/Tan Yu En, Charlisa"` → **9 files / 99 tests pass**, covering
  detection-settings and analyze-frame payload shapes, Object Detection source-mode transitions,
  snapshot/timestamp refresh, SecurePi URL resolution and connection testing, and the new
  SecurityCamera identity and fast-CCTV rendering.
- `python -m pytest ai-service/tests -q` → **16 passed** (zone resolution branching + the
  `DEFAULT_ZONE_THRESHOLD_SEC` env override).
- `python -m pytest raspberry-pi4/ -q` → **25 passed** (sensor-line parsing, inspection-window
  behaviour, Pi camera stream).
- `cd client && npx vite build` → clean production build.
- **Live hardware check**, which the test suites can't do: with `--stream` passed, port 8001 opened,
  `GET /health` returned `{"status":"online","camera":"IMX500","streaming":true}`, and `/video_feed`
  delivered `multipart/x-mixed-replace` at ~6.8 fps against a configured `STREAM_FPS=8` — 860 KB and
  27 JPEG start-of-image markers in 4 seconds. This is the only evidence that the stream genuinely
  works; the jsdom tests prove the URL wiring, not the camera.
- Manual reasoning check on the RBAC matrix: unauthenticated → 401, Staff on FM-only camera/zone
  writes → 403, Staff on GET → 200, FM on everything → 200 — cross-checked against the actual
  `requireRole` calls in each route file, not just the test file's assertions.

## Limitations / risks (documented, not hidden)
- **Pi snapshots still don't reach the website.** The server ingest path is complete and now even
  refreshes a duplicate event's snapshot and timestamp, but the Pi's bridge posts JSON with no
  attached JPEG, so the UI correctly shows *"Snapshot captured on the edge device; remote upload
  unavailable."* This is a known ~15-line Pi-side change; the prompt for it is written and
  contract-verified, but it has not been executed on the device.
- **`FACE_MATCH_THRESHOLD` is still bypassed in two places.** `main.py` hardcodes `sim > 0.45` at
  two call sites instead of reading the env-configurable `_FACE_MATCH_THRESHOLD`, so tuning that
  variable silently has no effect during YOLO person-tracking. This was found in the 2026-08-03
  audit, confirmed still present on 2026-08-06, and is a correctness bug rather than untidiness —
  it is the single highest-value item left open.
- **Single-source YOLO pipeline.** The engine still analyzes one active source at a time. Model
  selection is now per-source, but the Object Detection camera picker still labels which inventory
  camera the current feed represents rather than routing each camera's real stream into detection.
- **`_refresh_zone_info`'s global fallback survives.** Per-camera/per-zone resolution now goes
  through `resolve_zone_config`, so the original "one zone process-wide" problem is fixed for any
  caller that sends an id. The old `ORDER BY time_threshold ASC LIMIT 1` query remains as the
  fallback for callers that send neither — notably the background detection loop, which therefore
  still picks one zone globally.
- **`/people-count` 404s on the Pi's build**, so the live people-count stays empty in hardware mode
  even though video renders fine. The repo's edge source implements the endpoint; the device is
  running an older build.
- **`--stream` is not durable.** The Pi process currently runs in the foreground and dies with the
  SSH session. It needs to go into the preset `.args` file or the `deploy/securepi.service` unit
  before this is demo-safe.
- **Sensor telemetry is advisory.** `sensor_metadata` is stored and displayed, but by design nothing
  branches on it — a PIR trip or distance change only widens the camera's inspection window. It also
  depends on `pyserial` and a specific `/dev/ttyACM0`-style port on the Pi.
- **`assigned_team` is free text**, not a foreign key to any team record. It is a human-readable
  contact hint on a zone, and nothing validates or resolves it.
- **Camera-code uniqueness is app-level, not a DB constraint.** Case-insensitive duplicate checking
  happens in the route (`findCameraByCode`), not a Postgres unique index — acceptable for this
  scale, but a race between two simultaneous creates could theoretically both pass the check.
- **`.env.example` carries a machine-specific example path.** The commented
  `YOLO_WEBCAM_MODEL_PATH=C:/Users/charb/Downloads/best.pt` is my local path. It is inert while
  commented out, but it should become a relative or repo-local path before anyone else uses the file.
