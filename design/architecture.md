# FlowGuard system architecture

## System overview

FlowGuard is a browser-based facility operations platform. A React/Vite single-page application calls a Node.js/Express API, which applies authentication, RBAC, validation, and authoritative workflow rules before persisting PostgreSQL records or invoking private/external services. A private FastAPI service performs facial, QR, and YOLO processing. Two separate local-edge paths are supported: a Raspberry Pi Camera Module 3 that the browser reads over a trusted local network, and SecurePi/IMX500 software that pushes authenticated event metadata to the backend.

PostgreSQL is authoritative for application state. Camera frames are not stored in Cloud SQL. User facial templates, operational records, transcript messages, event metadata, and lifecycle state are persistent; browser capture buffers are transient, FlowGuard alert snapshots use temporary instance-local storage, and SecurePi-local evidence follows the lifecycle of the selected external SecurePi runtime.

## Runtime components

| Component | Runtime and responsibility | Exposure |
|---|---|---|
| Web client | React + Vite build served by Nginx in `flowguard-client-staging` on Cloud Run. Nginx provides SPA route fallback and same-origin `/api/*` and `/user/*` proxying. | Public. |
| Application API | Node.js + Express in `flowguard-server-staging` on Cloud Run. Owns JWT/RBAC, CRUD, workflow decisions, audit, external-service calls, and readiness. | Public API with per-route controls. |
| Database | PostgreSQL on Cloud SQL through Sequelize; FastAPI also reads the enrolled templates and zone configuration it needs. | No public application access; credentials are runtime configuration. |
| AI service | FastAPI in private `flowguard-ai-staging` on Cloud Run. Hosts InsightFace encode/track/recognise, OpenCV QR candidate decoding, and YOLO frame analysis. | Private Cloud Run IAM plus `X-AI-Service-Key`. |
| Gemini | Google Gemini REST API used by the support workflow for natural-language replies grounded in current Knowledge Base entries. | External; enabled only when `GEMINI_API_KEY` is configured. |
| WhatsApp | Meta WhatsApp Cloud API for booking/driver and separately configured security-alert notifications. | External; persisted results can be simulated, sent, failed, skipped, or not requested. |
| Cloud platform | Secret Manager, Artifact Registry, Cloud Build, Cloud Run, and Cloud SQL. | Google Cloud control/runtime plane. |
| Gate camera | Raspberry Pi 4 Camera Module 3 service in `raspberry-pi4/`, exposing `/health`, `/video_feed`, and `/snapshot` on a trusted hotspot/LAN. | Local network only; browser connects directly. |
| Laptop camera | Browser `getUserMedia` source used directly or as the safe Pi fallback. | Local browser device. |
| SecurePi | Separate subsystem using Raspberry Pi 5 and Sony IMX500 for edge inference, local evidence, and outbound alert events. Its runtime source is maintained in the canonical external repository [charlisaa/updated_securePi_FlowGuard](https://github.com/charlisaa/updated_securePi_FlowGuard) — the Pi 5/IMX500 build physically used with this FlowGuard integration — and is not copied into FlowGuard. | Local edge process; outbound authenticated HTTPS to Node. |

## Request boundaries

1. **Browser -> deployed client.** Public, login, Driver Pass, and protected SPA routes are served by Nginx. React Router refreshes fall back to `index.html`.
2. **Client -> Node backend.** Relative `/api/*` and `/user/*` requests pass through the client Nginx proxy. JWT and role checks protect non-public operations.
3. **Node backend -> Cloud SQL.** Node re-reads current user state and stores users, attendance, bookings, gate decisions, cameras/zones, alerts/incidents, security logs, transcripts, tickets, knowledge entries, and evaluation participants.
4. **Node backend -> private FastAPI AI service.** Facial, QR-cloud-fallback, and YOLO requests carry the app service key; on Cloud Run, Node also obtains a Google identity token for the AI service audience.
5. **Node backend -> Gemini API.** The helpdesk sends only the current question and Knowledge Base grounding prompt. Gemini generates text; deterministic code decides escalation, category, priority, ticket creation, and database writes.
6. **Node backend -> WhatsApp Cloud API.** Notifications run after the relevant database transaction. Delivery failure cannot undo a committed booking, gate result, alert, or incident, and the implemented workflow retains status/error metadata where supported.
7. **Deployed browser -> local Pi camera.** The browser reads the Pi's private HTTP URL over the shared trusted hotspot/LAN. Cloud Run does **not** connect to or proxy the Pi private IP. Browser local-network permission and mixed-content/private-network policy can affect this path.
8. **SecurePi -> authenticated edge-alert API.** SecurePi sends event metadata and, only in FlowGuard's supported multipart contract, an optional snapshot to `POST /api/edge/detection-alerts` with its dedicated bearer token. A stable event ID makes retries idempotent.

FastAPI also reads PostgreSQL facial templates and zone thresholds directly. This does not make inference responses authoritative: Node still owns user access, gate, attendance, alert, and incident decisions.

## Functional architecture

### Client areas

- Access and user management: login, enrolment, Gate Scanner, V-Patrol, attendance, users, staff, tenants, security review, and evaluation.
- Smart Logistics: booking list/forms, public Driver Pass, QR/reference handling, proof-of-concept plate capture, and FM gate verification.
- Monitoring and response: cameras, camera inventory, detection settings, Object Detection, alerts, incidents, and incident analytics.
- Support and knowledge: floating chatbot, persistent session restore, support dashboard, ticket lifecycle, and Knowledge Base CRUD.
- Shared operations: role-adaptive dashboard, settings, system health/error states, contact, and public information pages.

### Server areas

- Authentication, account status, token versioning, password reset, enrolment, JWT verification, and RBAC.
- User, attendance, booking, gate, camera, zone, alert, incident, security, support, dashboard, and knowledge APIs.
- Gate verification, security/gate audit, attendance/dashboard aggregation, Gemini, WhatsApp, AI-service authentication, and snapshot lifecycle services.
- Health/readiness handling, transcript cleanup, CORS/rate limiting, consistent error responses, and schema/startup checks.

### AI and edge areas

- FastAPI: three-image facial encoding, tracking without identity, recognition candidate generation, QR candidate extraction, people/object analysis, and zone-based alert emission.
- Camera Module 3: one in-memory latest-JPEG cache shared by MJPEG and snapshot responses; no disk frame archive.
- SecurePi: edge inference and alert decisions on Pi 5/IMX500, with local evidence/outbox only where the selected external runtime implements it.

## Repository structure

```text
client/
  src/
    components/     shared UI, charts, chatbot, route/error helpers
    pages/          public, role-scoped, monitoring, logistics, and support views
    utils/          camera, QR/plate, alert-source, and analytics helpers
    constants/      roles, camera, recognition, liveness, and API constants
    css/            page and component styling
  nginx.conf        same-origin API proxy and SPA fallback
  Dockerfile        Vite build and Nginx Cloud Run image
server/
  routes/           HTTP endpoints and route-level policy
  models/           Sequelize schema and associations
  services/         domain workflows and external integrations
  middlewares/      JWT/RBAC, CORS, limits, and error handling
  config/           server and detection configuration
  utils/            validation, bridge, storage, and formatting helpers
  migrations/       additive PostgreSQL schema changes
  tests/            Jest route/service/integration evidence
ai-service/         private FastAPI facial, QR, and object-analysis service
raspberry-pi4/      Raspberry Pi 4 Camera Module 3 local MJPEG/snapshot service and tests
design/             group design sources and rendered PNG diagrams
docs/               group evidence/run sheet plus separately owned documentation
deployment/         Cloud Run configuration guidance and placeholders
flowguard-ai/       existing individual AI-use records; not runtime application code
```

There is no `edge/securepi/` runtime folder in the current repository. SecurePi remains part of the system architecture through the FlowGuard edge API, browser integration, and [edge-AI reference](../docs/securepi-flowguard-edge-ai.md); its hardware/model source stays in the canonical external repository [charlisaa/updated_securePi_FlowGuard](https://github.com/charlisaa/updated_securePi_FlowGuard).

## Data architecture

- Core identity and access: `User`, `Attendance`, `SecurityLog`, and `EvaluationParticipant`; `Staff` and `Invite` are separate legacy/onboarding records.
- Logistics: `Booking` and `GateAccessLog`.
- Monitoring: `Camera`, `MonitoringZone`, `DetectionAlert`, and `IncidentLog`.
- Support: `ChatTranscript`, `SupportTicket`, and `KnowledgeBase`.
- Current ingest paths create a `DetectionAlert` and linked `IncidentLog` atomically. Edge retries are deduplicated by `DetectionAlert.edge_event_id` when supplied.
- Incident `resolvedAt` enables MTTR calculations; support category, status, archive, and unique transcript linkage support the current helpdesk lifecycle.

See [er-diagram.md](er-diagram.md) for current implemented fields and relationship boundaries.

## Security architecture

- JWT verification re-reads the user from PostgreSQL and checks current role, active state, and token version.
- Client `ProtectedRoute` improves navigation, while server middleware remains the authoritative RBAC boundary.
- Production/staging CORS allowlists fail closed when required origins are not configured; authentication, chat, reads/writes, AI, and uploads have route-aware limits.
- Secrets remain in runtime configuration/Secret Manager and are not placed in client `VITE_` values, Docker images, or documentation.
- The AI service is private: Cloud Run IAM and the shared service key protect inbound inference requests.
- Cloud SQL is not exposed as a public application endpoint.
- Edge ingest uses a separate bearer token, ignores caller-supplied source identity, and fails closed when `EDGE_INGEST_TOKEN` is absent.
- Stable edge event IDs and a unique database constraint make supported retries idempotent.
- Server startup/readiness fails closed when the database or required schema is unavailable; normal deployment keeps `DB_SYNC_ALTER=false`.
- SecurityLog and GateAccessLog retain audit metadata; detection alerts retain source, link, and WhatsApp state.
- Facial, QR, and plate frames are transient. Optional alert snapshots are authenticated and stored on ephemeral instance-local disk with cleanup controls; they are not a durable cloud evidence archive.

## Reliability and fallback

| Failure or condition | Implemented behaviour |
|---|---|
| Pi not configured or unavailable | Supported camera pages use or allow the **Laptop Webcam** fallback; no Pi request is made when Pi integration is disabled/unconfigured. |
| Private AI unavailable | Node returns a controlled error; access/gate callers do not treat an inference failure as permission. Existing UI provides retry/manual or prepared-data paths depending on the workflow. |
| Gemini unconfigured, timed out, or failed | Support uses deterministic Knowledge Base matching or a fixed clarification/escalation-status response. Escalation decisions remain deterministic. |
| Duplicate SecurePi event | Existing alert is returned; a second alert/incident and notification are not created for the same stable event ID. |
| Database/schema unavailable | Startup/readiness remains not ready rather than serving a false healthy state. |
| WhatsApp unavailable | The committed application record remains; simulation/failure/skip state and error metadata are recorded by the applicable workflow. |
| Backend temporarily unavailable to SecurePi | The combined external SecurePi design retains local evidence and an outbox for retry; the simpler stream variant does not. Documentation must identify which runtime is used. |
| Browser cannot use automatic QR/plate result | Manual booking-reference entry and FM-corrected plate input remain available; the backend makes the final gate decision and audits it. |

## Known boundaries

- Memory-backed rate limiting is per Node instance/cold start, not a distributed global quota.
- FastAPI/YOLO and SecurePi support only the classes and rules actually configured and validated; pest/rodent hardware accuracy is not established.
- Current FlowGuard and some SecurePi variants do not share a fully interoperable standalone snapshot-upload route; metadata alerts and local evidence must not be presented as durable cloud snapshot storage.
- Incident analytics are calculated in the client from the FM incident list. Existing incidents without `resolvedAt` are excluded from MTTR.
- The gate barrier is simulated, and browser plate OCR is proof-of-concept assistance rather than production LPR.
