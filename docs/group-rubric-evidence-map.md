# Group rubric evidence map

This is a group evidence index, not a grade claim or lecturer evaluation. “Implemented” means supported by current code/models; test and deployment status are stated separately. It does not replace any student's individual documentation, AI-use records, reflection, or contribution evidence.

## Official ownership

| Module | Existing README allocation | Integrated scope |
|---|---|---|
| 1 | Felicia | Facial Recognition & Access Management; Smart Logistics enhancement |
| 2 | Charlisa | Object Detection & Space Management |
| 3 | Lucas | AI Helpdesk & Facility Support |
| 4 | Gladwin | Incident Tracking & Resolution |
| Shared | Team | Accounts, JWT/RBAC, common UI/API, deployment, database integration |

Ownership references above reproduce the existing group README allocation. They do not invent contribution percentages or individual evidence.

## Current automated and public evidence

| Check | Result on 3 Aug 2026 |
|---|---|
| Client lint | **Passed:** 0 errors |
| Client Vitest | **Passed:** 69 files, 655 tests |
| Client production build | **Passed:** 759 modules; >500 kB chunk warning remains (approximately 801.50 kB main chunk) |
| Server Jest | **Passed:** 46 suites, 686 tests in 8 bounded batches; open-handle/force-exit notices remain |
| Safe AI pytest | **Passed:** 4 files, 35 tests; 9 deprecation warnings |
| Pi pytest / syntax | **Passed:** 1 file, 19 tests; `py_compile` exit 0 |
| Public staging | **Passed:** root, login and Driver Pass SPA refresh, hashed JS asset, public Knowledge Base GET (2 entries), safe unknown-booking 404 |

Hardware/private-image AI scripts, authenticated role journeys, real/simulated WhatsApp identification, direct server health, live IAM, and database-console evidence were not executed by this documentation task.

## Rubric traceability

| Group area | Implemented feature | Evidence file/path | Relevant automated evidence | Deployment/manual status | Known limitation / next evidence |
|---|---|---|---|---|---|
| System design | Cloud/browser/local-edge boundaries; role flows; persistent vs transient data; external services | `design/problem-statement.md`, `design/architecture.md`, architecture/ER Mermaid + PNG | Mermaid render validation; route/model tests below | Public architecture path smoke-supported; cloud console state not captured | Capture sanitised current Cloud Run/IAM/Cloud SQL resource evidence. |
| Code and full-stack integration | React -> Nginx -> Express -> Sequelize/PostgreSQL; Node -> private FastAPI; Node -> Gemini/WhatsApp; SecurePi -> edge ingest | `client/src/App.jsx`, `client/nginx.conf`, `server/index.js`, routes/services, `ai-service/main.py` | 655 client, 686 server, 35 safe AI tests | Public Nginx/backend GETs passed; protected journeys manual | No deployed end-to-end transaction was created by this read-only task. |
| CRUD | Users/staff, bookings, cameras/zones/alerts, incidents, tickets, Knowledge Base | React management pages; `server/routes/user.js`, `booking.js`, `cameras.js`, `zones.js`, `detectionAlerts.js`, `incident.js`, `support.js` | Route/component CRUD, RBAC, sync, support tests | Public KB read passed; authenticated writes not exercised | Prepare approved demo data and role sessions; avoid live destructive delete unless explicitly authorised. |
| Enhanced features | Three-angle face/liveness; Driver Pass/QR/plate; Pi fallback; SecurePi idempotency; chatbot/KB; linked incidents; analytics | Feature pages/utilities, edge/support/incident services and migrations, `docs/securepi-flowguard-edge-ai.md` | Facial/logistics/edge/support/analytics/Pi tests | Implemented/automated-tested; major role/hardware checks remain | Pi/IMX500 physical validation, configured Gemini, and prepared deployed records required. |
| Security | DB-authoritative JWT/RBAC, protected routes, token versioning, CORS, rate limits, private AI, Secret Manager guidance, edge bearer token | `server/middlewares/`, `server/services/aiServiceAuth.js`, lifecycle code, `.env.example` placeholders, Cloud Run guide | Account/RBAC/CORS/rate-limit/health/edge tests | Login page public; negative role/IAM checks manual | Rate limiting is in-memory per instance; live IAM/secret bindings not exported. |
| Privacy and audit | Transient face/QR/plate frames, embeddings/metadata persistence, off-boarding, SecurityLog/GateAccessLog, transcript cleanup, snapshot lifecycle | User/security/gate/snapshot services, `server/cron/cleanupTranscripts.js`, models/docs | Enrolment privacy, security, gate audit, snapshot lifecycle tests | Code/test evidence; no personal media used | Temporary FlowGuard snapshots and external SecurePi evidence need an operational retention policy. |
| Usability | Role-adaptive routes/sidebar, public Driver Pass, camera/manual fallbacks, error states, responsive pages, restored chat | `client/src/pages/`, `components/`, `utils/cameraSource.js`, `constants/piCamera.js` | Route, responsive, camera, pass, error, chat/support tests | SPA refresh routes passed | No consolidated moderated usability/accessibility study; local-network permission varies by browser. |
| Performance | Smaller tracking inputs, bounded recognition settings, request locks/timeouts, one cached Pi JPEG, paginated support list, client build output | Recognition/camera constants, rate limits, `pi_camera_steam.py`, support routes | Scanner/performance, rate-limit, Pi cache, build checks | Build passes | Main client chunk is approximately 801.50 kB; no deployed cold/warm latency or sustained-load dataset. |
| Testing | Component, route, service, model/transaction, AI-safe, and Pi suites | `client/tests/`, `server/tests/`, `ai-service/test/`, `ai-service/tests/`, `raspberry-pi/test_pi_camera_stream.py` | Exact current results above and `deployment.md` | Automated suites executed locally | Client lint passes; Jest open handles and AI deprecations remain; hardware/private-image tests excluded. |
| Deployment | Three Cloud Run services, Cloud SQL, private AI, Secret Manager, Artifact Registry/Cloud Build, health endpoints | Dockerfiles, `client/nginx.conf`, `deployment/cloud-run/`, `deployment.md` | Build, health-lifecycle tests; public GET smoke | Services stated deployed; public smoke passed | Direct server health, current revisions, build IDs, IAM, Gemini secret, and Cloud SQL state require authorised operator evidence. |
| Database | 15 Sequelize models; ownership, attendance, logistics, monitoring, incident, and support schema; additive migrations | `server/models/`, `server/migrations/`, `design/er-diagram.md` | Server transaction/sync/support/resolved/idempotency tests | Proxied database-backed public KB GET passed | No migration was run; authorised operator must confirm all migrations/current columns on staging. |
| AI integration | Private InsightFace/QR/YOLO; Gemini-grounded chat with deterministic fallback; SecurePi edge inference contract | `ai-service/main.py`, Node AI proxies/auth, `geminiService.js`, `supportService.js`, edge route/docs | 35 safe AI tests; facial/QR/YOLO proxy, Gemini, support, edge tests | Public KB grounding data readable; AI inference/chat not invoked live | Camera/private-image/physical model tests excluded; Gemini staging configuration unverified. |
| Error handling and reliability | Fail-closed access/readiness/edge token, controlled AI errors, Gemini fallback, idempotent edge retries, persisted WhatsApp state, Pi/webcam/manual fallbacks | Error middleware/pages, lifecycle, support/edge/WhatsApp/camera utilities | Error, health, support/Gemini, edge/WhatsApp, camera tests | Unknown booking safely 404; public routes available | Manual exercise of deployed failures is required; do not label fallback output as successful external delivery. |
| Git and code organisation | Current integrated branch, module folders, bounded routes/services/models/tests, group docs separated from individual work | Repository tree, README allocation, merge commit `6bca5d3` | Conflict/scope/diff checks in this documentation update | Current branch preserved; no commit/push/merge | PR/review/contribution records are individual/team evidence and are not inferred here. |
| Final demonstration readiness | 25-minute role journey, data/account prerequisites, fallback paths, Lucas/Gladwin manual checklist | `docs/final-review-run-sheet.md`, `deployment.md` | Current automated/public checks above | Public entry points ready; role data/accounts require rehearsal | Direct health and every protected workflow must be checked before the lesson with approved credentials/data. |

## Client-request coverage

Implemented PoC coverage includes supported unattended objects, access checkpoints, Smart Logistics, linked alerts/incidents, support/knowledge workflows, and operational analytics. Pest event infrastructure and off-device SecurePi logic do not establish physical rodent detection. Temporal actions, explosives, scheduled after-hours reasoning, pest re-identification/hotspots, and continuous cross-camera person re-identification remain future work. See `design/client-feedback-traceability.md`.

## Evidence boundaries

- No A-grade claim, fabricated client quote, cloud screenshot, live success, individual test evidence, AI log, reflection, ownership percentage, or contribution record was created.
- Existing individual documentation folders and `flowguard-ai/` records remain student-owned and unchanged.
- Unexecuted manual/hardware checks must remain visible until real evidence supersedes them.
