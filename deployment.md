# FlowGuard deployment and assessment guide

This assessor-facing guide describes the current Google Cloud staging deployment and the remaining manual preparation. The application is already deployed; incomplete role-specific checks do not mean deployment is incomplete. Passwords and other credentials remain placeholders in Git.

## Deployed application

| Item | Current value/status |
|---|---|
| Application | FlowGuard |
| Environment | Google Cloud staging |
| Public client | <https://flowguard-client-staging-590663319889.asia-southeast1.run.app> |
| Login | <https://flowguard-client-staging-590663319889.asia-southeast1.run.app/login> |
| Client service | `flowguard-client-staging` — **Deployed** |
| Server service | `flowguard-server-staging` — **Deployed** |
| AI service | `flowguard-ai-staging` — **Deployed**, designed as private |
| Database | Cloud SQL PostgreSQL |
| Build/images | Cloud Build -> Artifact Registry -> Cloud Run |
| Runtime secrets | Secret Manager bindings/runtime environment |
| Public smoke status | **Passed 3 Aug 2026** for client, route refreshes, one static asset, public Knowledge Base GET, and unknown Driver Pass booking handling |
| Automated status | **Passed**; exact results and non-fatal advisories are below |
| Role-specific staging status | **Manual role verification required**; no credentials or records were created by this documentation task |

The public client serves the React SPA through Nginx and proxies relative `/api/*` and `/user/*` requests to Node. Node invokes private FastAPI for facial, QR-cloud-fallback, and YOLO work. Node calls Gemini and WhatsApp only when their runtime configuration is present. The browser, not Cloud Run, reaches a private Raspberry Pi camera address.

The repository verifies the service names but does not contain a verified direct server URL, current revision IDs, live IAM export, Cloud SQL instance/database identifier, or build IDs. Copy those values from Google Cloud through an authorised operator; do not infer them from the client URL.

## Test accounts

| Role | Display name | Email | Password | Preparation status | Main demonstration |
|---|---|---|---|---|---|
| `FM` | Existing System Root Admin | `admin@harrison.com` | `<ENTER EXISTING FLOWGUARD DEMO PASSWORD>` | Existing; verify privately | Dashboard, users, gate, detection, incidents, security, support, knowledge, analytics |
| `Tenant` | FlowGuard Demo Tenant | `tenant.demo@harrison.com` | `<CREATE AND VERIFY DEMO PASSWORD>` | Create/verify manually if absent | Own Staff, attendance, bookings, Settings |
| `Staff` | FlowGuard Demo Staff | `staff.demo@harrison.com` | `<CREATE AND VERIFY DEMO PASSWORD>` | Create/verify manually under demo Tenant if absent | Own attendance, permitted logistics, Settings |

Account rules:

- `FM`, `Tenant`, and `Staff` are the exact stored roles. Drivers do not receive accounts.
- The FM seed email is repository-defined, but the seed password comes only from `FLOWGUARD_SEED_FM_PASSWORD`. Do not run the seed or reset an account as part of documentation verification.
- Use fake assessment data. Never place an actual password, personal email password, Google Cloud credential, API key, database secret, face image, personal phone number, or private Tenant record in this file.
- Give passwords to the assessor only through the approved private submission channel; keep placeholders in Git.
- Verify each account in a separate browser profile/Incognito session and complete required Face ID enrolment before the lesson.

## Role journey and access boundary

| User | Intended pages/workflows | Negative check |
|---|---|---|
| `FM` | Facility dashboard, users/tenants, attendance, logistics/gate verification, camera/zone/detection, incidents/analytics, security review, support tickets, Knowledge Base | Confirm the authorised pages load and their database data survives refresh. |
| `Tenant` | Own dashboard, own Staff, own attendance/logistics, Settings, own enrolment | Reject FM-only users, gate verification, monitoring, incident, support-management, and Knowledge Base administration routes. |
| `Staff` | Own dashboard/attendance, permitted linked-unit logistics, Settings, own enrolment | Reject user/staff/tenant administration, gate verification, FM monitoring, incidents, support management, and knowledge administration. |
| Driver | `/driver-pass/:ref` public safe booking view | Unknown/empty references fail safely; no login or private booking fields are exposed. |

## Driver Pass and prepared booking

No Driver account is required. The booking reference is also the QR token.

URL format:

`https://flowguard-client-staging-590663319889.asia-southeast1.run.app/driver-pass/<BOOKING_REFERENCE>`

Generated references use the `FG-XXXXXX` pattern. Use an actual prepared `Confirmed` booking rather than inventing a successful reference.

| Prepared item | Value |
|---|---|
| Booking reference | `<ENTER CONFIRMED BOOKING REFERENCE>` |
| Verified Driver Pass URL | `<ENTER VERIFIED DRIVER PASS URL>` |
| Demonstration plate | `<ENTER NON-PERSONAL VEHICLE PLATE>` |
| Slot | `<YYYY-MM-DD, START-END SGT>` |
| Status | `<CONFIRM Confirmed>` |
| Bay | `<Bay A OR Bay B>` |

The public DTO must not expose driver phone, Tenant ID, or notes. Gate Verification is FM-only; QR and proof-of-concept plate results are candidates, and the server owns the audited grant/deny decision.

## Health and public smoke checks

Server health routes are mounted at `/health/live` and `/health/ready` on the direct Node service. The client Nginx does not proxy `/health`, so appending those paths to the client URL is not a valid test.

| Check | Expected | Result on 3 Aug 2026 |
|---|---|---|
| Client `/` | HTTP 200 HTML | **Passed** — 200, React HTML returned |
| Client `/login` refresh | HTTP 200 SPA fallback | **Passed** — 200 |
| Client `/driver-pass/FG-DOCS-SMOKE` refresh | HTTP 200 SPA fallback | **Passed** — 200; this proves route handling, not a valid booking |
| Hashed JS asset | HTTP 200 JavaScript | **Passed** — `/assets/index-Dk3nhDIU.js`, 776,454 bytes at check time |
| Public `GET /api/support/knowledge` through Nginx | HTTP 200 JSON | **Passed** — 200, JSON array with 2 entries; no write performed |
| Unknown `GET /api/bookings/FG-DOCS-SMOKE` | Safe not-found response | **Passed** — 404 JSON |
| Direct server `/health/live` | 200 `{"status":"live"}` | **Manual operator check required** — verified direct URL unavailable in repository |
| Direct server `/health/ready` | 200 `{"status":"ready","database":true}` | **Manual operator check required** — verifies database readiness/schema path |

Readiness returns 503 with database false when startup/database checks fail. That is a safe failure, not a successful readiness result. The smoke checks above did not authenticate, create records, upload images, trigger alerts, run migrations, or change cloud configuration.

## Current automated test results

Executed on the current branch after the chatbot merge on 3 Aug 2026:

| Area | Command | Exact result |
|---|---|---|
| Client lint | `cd client && npm run lint` | **Passed:** 0 errors. |
| Client tests | `cd client && npx vitest run` | **Passed:** 69 test files, 655 tests. Test environment also printed non-fatal jsdom canvas/navigation notices. |
| Client production build | `cd client && npm run build` | **Passed:** 759 modules transformed. Vite warned that the approximately 801.50 kB main chunk exceeds 500 kB; build completed. |
| Server tests | `cd server && npm test -- --runInBand` | **Passed:** 46 Jest suites, 686 tests in 8 bounded batches. Runner force-exit notices indicate open handles should be investigated separately. |
| AI safe tests | `cd ai-service && .venv/Scripts/python -m pytest -q test/test_qr_endpoint.py test/test_track_endpoint.py tests/test_zone_resolution.py tests/test_zone_threshold_env.py` | **Passed:** 4 files, 35 tests; 9 deprecation warnings. Hardware/private-image scripts were not run. |
| Pi tests | `cd raspberry-pi4 && python -m pytest test_pi_camera_stream.py` | **Passed:** 1 file, 19 tests. |
| Pi syntax | `cd raspberry-pi4 && python -m py_compile pi_camera_steam.py` | **Passed:** exit 0. |

Excluded AI scripts are `test_webcam.py`, `test_manpower.py`, and `test_insightface.py` (camera/private images) plus `test_yolo.py` (real `test.jpg` inference). Their absence is not recorded as a pass.

## Deployed Feature Verification Matrix

| Area | Implemented | Automated evidence | Deployed verification | Remaining manual check |
|---|---|---|---|---|
| Authentication/RBAC | Yes | Client route/RBAC tests; server account, RBAC, CORS, rate-limit tests | Public login route loads | Log in as prepared FM/Tenant/Staff; check allowed pages, denials, logout, expiry, and refresh. |
| Facial recognition | Yes | Enrolment, tracking, liveness, recognition, attendance, audit, privacy tests; safe AI track tests | Not authenticated in this task | Enrol front/left/right with consented demo identity; verify known, unknown, multiple-face, failed-liveness, and Pi/webcam fallback paths. |
| Smart Logistics | Yes | Booking time/conflict/edit/pass, QR, plate, gate, WhatsApp tests | Unknown booking 404 and Driver Pass route refresh passed | With prepared FM/Tenant and `Confirmed` booking, verify create/edit/status, public pass/QR, plate match/mismatch, audited entry/exit, and persistence. |
| Raspberry Pi Camera | Yes, local PoC | 19 Pi tests + syntax pass; camera-source client tests | Public client route only | On lesson hotspot, verify browser permission and Pi `/health`, `/video_feed`, `/snapshot`, then disconnect Pi and confirm Laptop Webcam fallback. |
| Object detection | Yes | Client source-mode tests; server camera/zone/alert/edge/YOLO tests; safe AI zone tests | Not authenticated in this task | Load configured deployed camera/zone and prepared alert; verify source, threshold, status, snapshot behaviour, and SecurePi hardware only if available. |
| Incidents/security review | Yes | Alert bridge/sync/auth, resolved timestamp, security review tests | Not authenticated in this task | Verify prepared alert links to incident; update status/notes/resolution, reopen, review a security log, and confirm sync after refresh. |
| Attendance/dashboard | Yes | Attendance and dashboard/analytics client/server tests | Not authenticated in this task | FM all-data, Tenant own-unit, Staff self views; verify counts/statistics with prepared current data. |
| AI chatbot | Yes | Support and Gemini service tests | Public Knowledge Base read only; chat POST intentionally not called | Send messages, refresh/restore transcript, observe Gemini response **or clearly identified deterministic fallback**, and verify fixed escalation rules. |
| Knowledge Base | Yes | Support route/service tests | Public read passed with 2 entries | As FM, create/edit/search/delete a temporary approved demo entry, or use an existing prepared record if writes are not authorised. Confirm Tenant/Staff cannot administer. |
| Incident analytics | Yes | Gladwin client analytics/page tests and server resolved-at test | Not authenticated in this task | As FM, load deployed incident data; verify MTTR excludes missing timestamps and confidence/funnel values match prepared records. |
| Support tickets | Yes | Support route/service tests, transcript uniqueness migration | Not authenticated in this task | Verify chat escalation or prepared ticket, transcript view, category/status/notes, archive/restore, and permitted deletion policy. |

Lucas's helpdesk/Knowledge Base and Gladwin's incident/analytics areas are implemented and automated-tested. They are **not** labelled manually verified on staging because no role credentials or prepared records were used by this task.

## Gemini, WhatsApp, and private AI configuration

- `server/.env.example` defines `GEMINI_API_KEY`, model, timeout, and retry settings. The checked-in Cloud Run environment template predates the chatbot merge, so an authorised operator must confirm that the staging server has the Gemini secret/runtime variables before claiming live Gemini output.
- If Gemini is absent or fails, the support service uses deterministic Knowledge Base or fixed fallback text; escalation remains deterministic in both cases.
- WhatsApp real sending requires its enable flag, credentials, phone-number ID, and recipients. Simulation or failure must be described by its stored status, not as real delivery.
- The AI service must remain private with the Node service identity as invoker and the matching `AI_SERVICE_KEY` in Secret Manager/runtime configuration.

## Pi and SecurePi setup boundary

### Raspberry Pi Camera Module 3

1. Connect the laptop and Pi to the same trusted hotspot/LAN.
2. Start `raspberry-pi4/pi_camera_steam.py` on the Pi (default documented port 8081).
3. Verify the local `/health`, `/video_feed`, and `/snapshot` endpoints from the demo browser/network.
4. In **Settings -> Raspberry Pi Camera**, save only the device base URL and use **Test Connection**.
5. Grant browser local-network/camera permission if prompted.
6. Confirm the relevant page can select the Pi and then the Laptop Webcam fallback.

The browser-local setting contains only the normalised device URL. Never put a credential in `VITE_` configuration or expose the unauthenticated local camera service to the public internet.

### SecurePi / IMX500

SecurePi is separate from the Camera Module 3 service. It runs on Raspberry Pi 5 + Sony IMX500, performs edge inference, and sends outbound authenticated events to Node. Its runtime is the canonical external repository [charlisaa/updated_securePi_FlowGuard](https://github.com/charlisaa/updated_securePi_FlowGuard) (owned and maintained separately; not deployed from this repository). Follow [docs/securepi-flowguard-edge-ai.md](docs/securepi-flowguard-edge-ai.md). Do not restore a copied `edge/securepi/` folder. Do not claim physical pest/model or snapshot-upload interoperability until the documented hardware/parser/contract checks pass.

## Demo-data checklist

- [ ] Existing FM credential privately verified
- [ ] Demo Tenant and linked demo Staff available
- [ ] All three role sessions verified in separate profiles
- [ ] Required three-angle enrolment completed with approved demo images/live user
- [ ] Confirmed booking, Driver Pass, QR/reference, plate, slot, and bay prepared
- [ ] Attendance records and dashboard data prepared
- [ ] Camera and monitoring zone prepared
- [ ] Alert with known source and linked incident prepared
- [ ] Security review record prepared
- [ ] Chat session/support ticket and Knowledge Base entries prepared
- [ ] Incident set includes known resolution timestamps/confidence values for analytics
- [ ] Pi and Laptop Webcam permissions/fallback verified
- [ ] Prepared records remain available after refresh

## Deployment-verification checklist

- [x] Public client root, login refresh, Driver Pass refresh, static asset, public KB GET, and unknown-booking response checked on 3 Aug 2026
- [ ] Direct server liveness and readiness recorded from verified server URL
- [ ] Current client/server/AI revisions and traffic confirmed healthy in Cloud Run
- [ ] Node-to-private-AI IAM invocation confirmed without exposing credentials
- [ ] Cloud SQL connection/readiness and current migrations confirmed by an authorised operator
- [ ] Gemini runtime secret/configuration confirmed or deterministic fallback deliberately demonstrated
- [ ] Real/simulated WhatsApp mode identified before the demo
- [ ] FM/Tenant/Staff role journeys and negative checks completed
- [ ] Facial, logistics, object/incident, attendance/dashboard, chatbot/KB/support, and analytics workflows verified with prepared data
- [ ] No localhost/private Pi URL appears as a cloud dependency; Pi path is browser-local only

## Security and privacy rules

- Do not store passwords, JWT/API/edge tokens, Google Cloud/DB credentials, private keys, personal phone numbers, biometric images, or private Tenant data in documentation or Git.
- Keep facial, QR, and plate frames transient. Cloud SQL stores templates and operational metadata, not continuous video.
- Treat temporary FlowGuard snapshots and SecurePi-local evidence according to their actual retention; neither is automatically a durable archive.
- Keep `DB_SYNC_ALTER=false` for normal deployment and apply migrations only through an authorised deployment procedure—not this checklist.
- Do not expose the AI service or local Pi stream publicly. Never use a browser-visible `VITE_` value for a secret.

## Implementation references

| Topic | Repository evidence |
|---|---|
| Cloud services and build/runtime guidance | `deployment/cloud-run/README.md`, Dockerfiles, Nginx config |
| Roles, token/account checks, readiness | `client/src/App.jsx`, `client/src/constants/roles.js`, `server/middlewares/auth.js`, `server/routes/health.js`, `server/services/serverLifecycle.js` |
| Facial, attendance, user security | `server/routes/user.js`, `facialRecognition.js`, `attendance.js`, access services/tests |
| Logistics and Driver Pass | `server/routes/booking.js`, `qr.js`, gate/WhatsApp services, logistics pages/tests |
| Monitoring, edge, incidents | camera/zone/detection/edge/incident routes, models, migrations, tests |
| Chatbot, Gemini, support, Knowledge Base | `AIChatPopup.jsx`, support route/services/models/migrations/tests |
| Incident analytics | `IncidentAnalytics.jsx`, `client/src/utils/incidentAnalytics.js`, incident migration/tests |
| Pi and SecurePi | `raspberry-pi4/`, `client/src/constants/piCamera.js`, `docs/securepi-flowguard-edge-ai.md` |
