# FlowGuard

FlowGuard is the academic proof of concept for SCCCI Problem Statement 5B, Asset & Manpower Monitoring for Harrison Food Factory. It combines access management, object and space monitoring, Smart Logistics, incident resolution/analytics, and an AI-assisted facility helpdesk with a shared Knowledge Base.

The working application is the source of truth. This repository does not claim production safety certification, production-grade licence-plate recognition, explosive detection, a real gate actuator, or continuous cross-camera person re-identification.

## Problem and users

Harrison Food Factory has multiple tenants, entry points, monitored spaces, and two loading bays. Facilities Managers need a consolidated way to review access, attendance, unattended objects, alerts, incidents, support cases, and delivery traffic. Tenants and Staff need appropriately scoped operational access, while drivers need a public booking pass without a FlowGuard account.

Primary actors are Facilities Manager (`FM`), `Tenant`, `Staff`, public Driver, and trusted AI/SecurePi service callers. Authentication is shared infrastructure, not a student's main assessed feature.

## Official task allocation

| Module | Owner | Implemented scope | Enhanced capability |
|---|---|---|---|
| Module 1 - Facial Recognition & Access Management | Felicia | User enrolment/re-enrolment, Gate Scanner, V-Patrol, attendance, access audit, FM evaluation, PDPA off-boarding | Smart Logistics and loading-bay verification |
| Module 2 - Object Detection & Space Management | Charlisa | Camera and zone configuration, browser/upload/SecurePi sources, people count, unattended-object alerts, alert lifecycle | Configurable edge and zone workflows |
| Module 3 - AI Helpdesk & Facility Support | Lucas | Chat transcripts, Gemini-generated knowledge-base-grounded replies (deterministic keyword-match fallback), automatic ticket escalation, ticket and knowledge-base CRUD | Linked transcript and FM resolution workflow |
| Module 4 - Incident Tracking & Resolution | Gladwin | Automatic incidents from detection alerts, manual incidents, search, resolution updates, notes, and soft deletion | Bidirectional alert/incident synchronisation |
| Shared team infrastructure | Team | Accounts, registration, login, JWT verification, RBAC, CORS, rate limiting, deployment configuration | Not a main assigned module |

## Implemented application

### Facial Recognition & Access Management

- Manual account creation within role limits; three-angle face enrolment and re-enrolment.
- Raspberry Pi Camera Module 3 and laptop webcam capture, with manual image upload for enrolment.
- FM-only Gate Scanner and V-Patrol with transient face tracking, recognition, multiple-face rejection, motion/head-turn liveness, and final same-person confirmation.
- Unknown, stale, suspended, liveness-timeout, identity-mismatch, and multiple-face outcomes fail closed.
- Gate Scanner toggles `Attendance` IN/OUT via `POST /api/attendance/scan`. V-Patrol defaults to **Patrol only** (audit-only `SecurityLog` access events through `POST /api/facial-recognition/access-event`, no attendance change); its optional **Check In** / **Check Out** controls write an explicit `Attendance` IN/OUT through `POST /api/attendance/action`, and only after successful recognition, liveness, and final same-person confirmation. Denied or failed scans create no attendance. Duplicate-cycle protection is a bounded in-process guard — there is no `Attendance.cycleId` column, so it is not a durable cross-restart database guarantee.
- FM-only side-effect-free evaluation workflow with stable participant labels.
- Transactional PDPA off-boarding wipes the embedding, removes attendance, anonymises retained access logs, unlinks booking ownership, retires the evaluation mapping, deletes the user, and requests an AI cache refresh.
- Liveness is a PoC head-turn/motion check, not certified anti-spoofing. Multiple-face rejection is not presented as tailgating detection. No VIP role exists.

### Smart Logistics

- Booking create/read/edit/status/cancel workflows with FM/Tenant/Staff scoping.
- Bay A/B time-slot conflict validation using Singapore wall-clock input normalised to UTC for storage.
- Public Driver Pass with a large QR code and readable booking reference.
- QR decoding uses native `BarcodeDetector`, ZXing fallback, then Node-to-private-FastAPI cloud decoding; manual reference entry remains available.
- Laptop webcam and Raspberry Pi Camera Module 3 sources.
- Proof-of-concept Tesseract plate OCR with manual correction; it is not production-grade LPR.
- FM-authoritative gate verification for invalid, unconfirmed, cancelled, completed, early, late, unreadable, missing, and mismatched inputs.
- Every final gate decision writes `GateAccessLog`; allowed manual overrides require a reason. Entry/exit transitions are idempotent.
- WhatsApp Cloud API can send real messages when configured; default demo mode is safe and simulated. Completion can notify the next driver for the same bay.
- The UI simulates the barrier state. It does not actuate a physical barrier.

### Object Detection & Space Management

- CRUD for `Camera`, `MonitoringZone`, and `DetectionAlert`, with soft deletion on these models.
- Configured classes, people-density threshold, unattended threshold, cooldown, severity, assigned team, enable/disable, and detection type.
- Browser camera/upload analysis through Node's authenticated YOLO proxy, plus optional IMX500/SecurePi edge ingestion.
- People counting and proximity/timer-based unattended-object detection for model-supported classes.
- Every current detection-alert creation path atomically creates and links an `IncidentLog` through `DetectionAlert.incident_log_id`; status, severity, person, and soft deletion synchronise in both directions.
- SecurePi edge events (`POST /api/edge/detection-alerts`, `EDGE_INGEST_TOKEN`) are idempotent on a stable `edge_event_id` and can notify configured FM/security recipients through the WhatsApp Cloud API. Notification runs after the alert commits, and the outcome is stored on the alert. SecurePi remains a separate Pi 5/IMX500 subsystem; physical pest/model and snapshot-contract validation are still required. See the group [SecurePi edge-AI reference](docs/securepi-flowguard-edge-ai.md).

### AI Helpdesk & Facility Support

- `ChatTranscript`, `SupportTicket`, and `KnowledgeBase` persistence.
- Public chat records exchanges and escalates after configured phrases or five user messages — escalation and ticket categorisation are fully deterministic, never decided by the AI reply engine.
- Non-escalating replies are generated by Google Gemini, grounded in the FM-curated `KnowledgeBase` entries (passed as context so the model answers from actual facility policy rather than invented ones); if Gemini is unavailable (no key, network failure, timeout, quota) the response falls back to the previous deterministic keyword/knowledge-base match, so the chatbot degrades rather than breaking.
- FM ticket list/detail reads include the linked transcript; FM can categorise, investigate, resolve/close, archive/restore, or delete a ticket and its linked transcript according to the implemented lifecycle.
- FM Knowledge Base create/read/update/delete, search, and category filtering; chatbot history is restored from its persisted transcript.

### Incident Tracking & Resolution

- Incidents are created automatically with detection alerts and can also be created manually by FM.
- FM can list/search/read incidents, update resolution status/notes/severity/person, and soft-delete records.
- Linked detection alerts mirror resolution, severity, person, and delete operations.
- `resolvedAt` records terminal transitions; the FM-only deep analytics page derives MTTR, confidence buckets, AI accuracy, and the resolution funnel from current incident data.

## Repository layout and architecture

- `client/` - React 19/Vite frontend. The Cloud Run image serves the built SPA through Nginx and proxies `/api/*` and `/user/*` to Node.
- `server/` - Node.js/Express API, Sequelize models, RBAC, integration services, and cron cleanup.
- `ai-service/` - private Python/FastAPI service for InsightFace, QR decoding, and YOLO.
- `raspberry-pi4/` - Raspberry Pi 4 Camera Module 3 snapshot/MJPEG PoC.
- `design/` - group design sources and rendered PNG diagrams.
- `docs/` - group evidence/run sheet plus separately owned documentation.
- `deployment/` - Google Cloud Run guidance and environment placeholders.
- SecurePi source is maintained in dedicated repositories; FlowGuard contains its browser/API integration and `docs/securepi-flowguard-edge-ai.md`, not a copied `edge/securepi/` folder.
- PostgreSQL/Cloud SQL is authoritative. `User.faceVector` is Sequelize `ARRAY(FLOAT)` / PostgreSQL `FLOAT[]`; matching is performed with NumPy. No pgvector extension is used by the application.

Normal cloud request path:

```text
Browser -> public Cloud Run client/Nginx -> public Cloud Run Node server
Node -> private authenticated Cloud Run FastAPI AI service
Node and FastAPI -> Cloud SQL PostgreSQL
SecurePi -> Node edge-ingest endpoint
```

The browser normally calls Node, never private FastAPI. Local QR/plate assistance executes in the browser; cloud QR fallback is Browser -> Node -> FastAPI. Group submission references:

- [Problem statement](design/problem-statement.md)
- [Architecture document](design/architecture.md)
- [Architecture Mermaid](design/architecture-diagram.md) and [architecture PNG](design/png/architecture-diagram.png)
- [ER Mermaid](design/er-diagram.md) and [ER PNG](design/png/er-diagram.png)
- Additional group flows: [facial recognition and access](design/md/facial-recognition-flow.md), [smart logistics](design/md/logistics-flow.md), and [RBAC](design/md/rbac-flow.md)
- [Client-feedback traceability](design/client-feedback-traceability.md)
- [Deployment and verification guide](deployment.md)
- [Group rubric evidence map](docs/group-rubric-evidence-map.md)
- [Final-review run sheet](docs/final-review-run-sheet.md)
- [SecurePi integration reference](docs/securepi-flowguard-edge-ai.md)

## Local setup

Prerequisites: Node.js/npm, Python 3.12-compatible environment for the pinned AI dependencies, and PostgreSQL.

```bash
cd client
npm ci

cd ../server
npm ci

cd ../ai-service
python -m venv .venv
# Windows PowerShell: .venv\Scripts\Activate.ps1
python -m pip install -r requirements-torch.txt
python -m pip install -r requirements.txt
python -m pip check
```

Copy `client/.env.example`, `server/.env.example`, and `ai-service/.env.example` to local environment files and supply your own values. Never commit secrets. Important names include `APP_SECRET`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PWD`, `FACE_AI_URL`, `AI_SERVICE_KEY`, `CLIENT_URL`, and `FRONTEND_URL`.

Run three terminals:

```bash
cd client && npm run dev -- --host
cd server && npm start
cd ai-service && uvicorn main:app --host 0.0.0.0 --port 8501
```

For local development, Node reaches FastAPI through `FACE_AI_URL=http://127.0.0.1:8501`. Production uses the private Cloud Run AI URL and Google identity-token authentication in addition to `X-AI-Service-Key`.

## Edge AI — SecurePi

SecurePi is FlowGuard's separate Raspberry Pi and Sony IMX500 edge-AI subsystem for local person/object tracking, unattended-object decisions, local evidence, and authenticated alert submission. Its source stays in dedicated hardware repositories while FlowGuard provides the edge API, browser, alert, incident, and notification integration. See the [SecurePi Edge AI integration guide](docs/securepi-flowguard-edge-ai.md). The canonical external SecurePi runtime — the Raspberry Pi 5 + Sony IMX500 implementation that has been physically used with this FlowGuard build — is [charlisaa/updated_securePi_FlowGuard](https://github.com/charlisaa/updated_securePi_FlowGuard). It is owned and maintained separately; FlowGuard configures and consumes its local stream and edge alerts but does not copy or deploy that runtime.

## Gate camera source (Raspberry Pi Camera Module 3)

The deployed FlowGuard JavaScript in the laptop browser connects directly to the Pi
over their shared hotspot. Cloud Run does not connect to or proxy the private Pi IP.
Gate Scanner, Gate Verification, V-Patrol, Face Enrolment, and Facial Evaluation use
the same runtime-aware camera configuration. Source priority is:

1. Raspberry Pi Camera Module 3 — only when configured **and** reachable
2. Laptop webcam
3. Photo upload / manual entry

At page start a configured Pi is probed once (cooldown-aware) and shows the state:
`Checking Raspberry Pi Camera Module 3...` → `Pi Camera connected`, or
`Pi Camera unavailable — Laptop Webcam fallback active`, or `Laptop Webcam active`.
The webcam is never delayed by a Pi timeout; the FM can switch sources manually
afterwards. Pi snapshots are decoded through the authenticated `/api/qr/decode`
proxy (never the private AI service directly) and are held in memory only — no frame
is ever written to disk or `localStorage`. `localStorage` contains only the normalized
base URL under `flowguard.piCameraBaseUrl`. An MJPEG preview uses an `<img>` on the
resolved `/video_feed` endpoint; processing always pulls a fresh `/snapshot` still with a
cache-busting query. Switching away from the webcam stops its `MediaStream` tracks,
and QR and plate webcam streams are never active at the same time.

Runtime setup at Settings -> Raspberry Pi Camera is preferred because hotspot IPs can
change without a frontend rebuild. Optional public build-time fallbacks are:

```bash
VITE_ENABLE_PI_CAMERA=true
VITE_PI_CAMERA_HEALTH_URL=http://<PI-IP>:8081/health
VITE_PI_CAMERA_STREAM_URL=http://<PI-IP>:8081/video_feed
VITE_PI_CAMERA_SNAPSHOT_URL=http://<PI-IP>:8081/snapshot
```

The resolution order is a valid runtime base URL, valid Vite endpoints, then
unconfigured webcam fallback. `VITE_ENABLE_PI_CAMERA=false` prevents every Pi probe,
stream, and snapshot request. Never put secrets in `VITE_` values.

Local Raspberry Pi 4 setup (Camera Module 3, Picamera2), serving port 8081:

```bash
sudo apt install -y python3-picamera2 python3-opencv python3-flask
cd raspberry-pi4
python3 pi_camera_steam.py
# routes: /  /health  /video_feed  /snapshot   (hostname -I gives <PI-IP>)
```

Chrome may ask the user to allow local-network access for the deployed origin. Browser
behavior varies, so use Settings -> Test Connection and follow the displayed guidance.
With no runtime or Vite URL the client makes no Pi request and uses the laptop webcam
immediately. The Pi camera endpoints are unauthenticated: use only a trusted demo
network and never forward port 8081 publicly. See
[`docs/Tan Xiu Li, Felicia/pi-camera-module-3-integration-plan.md`](docs/Tan%20Xiu%20Li,%20Felicia/pi-camera-module-3-integration-plan.md)
for the exact hotspot demo procedure.

## FM dashboard live data

`GET /api/dashboard/summary` is the single authoritative FM payload (camera totals,
attendance, urgent High/Critical active-alert count, today's bookings, active vehicles,
open incidents/tickets, the newest five active High/Critical alerts, the seven-day
High/Critical trend, top High/Critical zones, `generatedAt`, and `analyticsAvailable`).
It is served with `no-store` cache headers. The client fetches on mount, then polls every
15 s while the tab is visible, pauses when hidden, refreshes on becoming visible again,
never overlaps requests, and keeps the last good data on a transient failure (showing
"Live data temporarily unavailable" instead of fake zeroes). There is a Refresh button
and a Singapore-time "Last updated" stamp. "Urgent" everywhere means severity
High/Critical **and** an active workflow status (Active/Acknowledged/Investigating/
Escalated/Dispatched) — never Low/Medium and never Cleared.

Verifying the frontend and the alert-ingestion service share the SAME deployed database:
the Node server (dashboard reads) and the detection-alert ingest routes both use the
single `server/models` Sequelize connection configured from `DB_HOST`/`DB_PORT`/`DB_NAME`/
`DB_USER`/`DB_PWD`. Confirm the deployed client's `VITE_API_BASE_URL` (or same-origin
Nginx proxy) points at that same Node service, and that the AI/edge ingest uses the same
`DB_*` values — then an alert created through the API appears in the dashboard.

Safe manual verification (no unauthenticated test endpoint is added):

1. As FM, create one Active High test alert via the existing authenticated
   `POST /api/detection-alerts` (`{ zone_name, camera_location, severity: "High",
   status: "Active", alert_type, object_class }`).
2. Reload the dashboard (or wait for the 15 s poll).
3. Confirm the Urgent Alerts count, the recent-alerts list, the seven-day trend, and the
   top-zones chart all change to reflect the new alert.
4. Remove the test data with the existing FM-only `DELETE /api/detection-alerts/:id`
   (soft-deletes the alert and its linked incident).

## Tests and 3 August 2026 integration snapshot

These commands ran on the current `feature/facial-smart-logistics` branch after the chatbot merge. No camera, private face image, database migration, test account, or cloud write was required.

| Area | Command | Exact result |
|---|---|---|
| Client lint | `cd client && npm run lint` | **Passed:** 0 errors. |
| Client tests | `cd client && npx vitest run` | **Passed:** 69 test files, 655 tests. |
| Client build | `cd client && npm run build` | **Passed:** 759 modules transformed; Vite retained the >500 kB chunk warning (main chunk approximately 801.50 kB). |
| Server tests | `cd server && npm test -- --runInBand` | **Passed:** 46 Jest suites, 686 tests in 8 bounded batches; force-exit/open-handle notices remain. |
| Safe AI tests | Four QR/track/zone files in the repository `.venv` | **Passed:** 4 files, 35 tests; 9 dependency deprecation warnings. |
| Pi camera tests | `cd raspberry-pi4 && python -m pytest test_pi_camera_stream.py` | **Passed:** 1 file, 19 tests. |
| Pi syntax | `python -m py_compile pi_camera_steam.py` | **Passed:** exit 0. |

Not run automatically: `ai-service/test/test_webcam.py`, `test_manpower.py`, and `test_insightface.py` require a physical camera and/or private images; `test_yolo.py` requires `test.jpg` and real model inference. See [deployment.md](deployment.md) for commands, warnings, public smoke checks, and the manual deployed-verification matrix.

## Deployment

Repository configuration targets Google Cloud in `asia-southeast1`: public Cloud Run client and Node server, private/authenticated Cloud Run AI service, Cloud SQL PostgreSQL, Secret Manager, and an Artifact Registry/Cloud Build workflow.

On 3 August 2026, the public client root, login refresh, Driver Pass refresh path, one hashed JavaScript asset, public Knowledge Base GET, and unknown-booking not-found response passed read-only smoke checks at <https://flowguard-client-staging-590663319889.asia-southeast1.run.app>. No authenticated or mutating cloud check was performed. The direct server URL, live IAM/Cloud SQL state, revision/build IDs, and role-specific staging workflows remain operator/manual checks; they are not inferred. See [deployment.md](deployment.md) and the [25-minute final-review run sheet](docs/final-review-run-sheet.md).

## Security, privacy, and performance boundaries

- JWT verification re-reads the database account, role, active state, and token version on protected requests.
- Production/staging CORS fails closed without an explicit client origin.
- Route-aware rate limits use in-memory `MemoryStore`; limits are per Node instance/cold start, not globally distributed across Cloud Run.
- FastAPI is configured as a private Cloud Run service; Node obtains a Google ID token and also supplies `AI_SERVICE_KEY`.
- Facial, QR, and plate frames are transient and are not permanently stored by the current PoC. PostgreSQL stores facial embeddings and audit metadata. AI models are baked into the container image. No persistent user-upload object store is required for current scope.
- Gate access remains an FM-authoritative software decision with a simulated barrier.
- AI chat logs belong in the separate individual AI submission package. Student AI reflections are student-authored evidence and must not be rewritten by this documentation audit.

## Future roadmap

Physical pest/model validation, temporal pick-up/set-down/push-in recognition, suspicious-item/threat classification, schedule-based after-hours motion rules, animal/rat re-identification, pest hotspot analytics, and continuous cross-camera person re-identification are post-PoC work. See [design/client-feedback-traceability.md](design/client-feedback-traceability.md).
