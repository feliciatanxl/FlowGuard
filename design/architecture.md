# FlowGuard system architecture

FlowGuard is a React/Vite client, Node/Express API, private Python/FastAPI AI service, and PostgreSQL application. The cloud design uses Cloud Run for all three services and Cloud SQL for PostgreSQL.

## Runtime boundaries

| Runtime | Repository path | Responsibility |
|---|---|---|
| React/Nginx client | `client/` | Public and authenticated pages, local camera capture, native/ZXing QR decode, transient canvases, API calls to Node. |
| Node/Express server | `server/` | JWT/RBAC, validation, authoritative user/booking/gate decisions, PostgreSQL writes, AI proxying, WhatsApp integration, audit and cron tasks. |
| FastAPI AI service | `ai-service/` | InsightFace encoding/tracking/recognition, OpenCV QR candidate decode, YOLO frame analysis, zone-based alert emission. Private in Cloud Run. |
| PostgreSQL/Cloud SQL | Sequelize and `psycopg2` clients | Authoritative users, embeddings, attendance, bookings, gate decisions, cameras/zones, alerts/incidents, transcripts/tickets/knowledge. |
| Raspberry Pi camera | `raspberry-pi/` | Camera Module 3 snapshot/MJPEG source for enrolment, facial scanners, and gate QR/plate capture. |
| SecurePi edge | `edge/securepi/` | Optional IMX500/local object detection, unattended timers, people alerts, outbound authenticated alert ingestion. |

The browser normally calls Node. Node adds the private AI-service credential and, on Cloud Run, a Google identity token. PostgreSQL is authoritative; AI responses are candidates/telemetry, not permission decisions.

## Route and ownership inventory

| Frontend route/page | Owner/module | Node API | AI path | Primary data/CRUD | RBAC/automatic enhancement | Current limitation |
|---|---|---|---|---|---|---|
| `/enrollment` FaceEnrollment | Felicia / Facial Access | `POST /user/enroll-face` | `/api/encode-faces`, `/refresh` | User face update; EvaluationParticipant create | Any user self; FM any user; Tenant own Staff. Pi -> webcam; upload fallback. | Three-angle PoC; no certified spoof defence; frame not persisted. |
| `/gate-scanner` GateScanner | Felicia / Facial Access | facial `/track`, `/recognize`, `/denied-event`; attendance `/scan` | `/user/track`, `/user/recognize` | Attendance create; SecurityLog create | FM; liveness/final same-ID/unknown/suspended/multiple-face handling | Software checkpoint only; head-turn liveness. |
| `/vpatrol` VPatrol | Felicia / Facial Access | facial `/track`, `/recognize`, `/access-event`, `/denied-event`; security reads | `/user/track`, `/user/recognize` | SecurityLog create/read | FM; deduplicated safe/denied audit | No attendance change; not continuous cross-camera re-ID. |
| `/facial-evaluation` | Felicia / Facial Access | evaluation participants, `/evaluate` | `/user/recognize` | Participant read/sync; browser-local evaluation results | FM; production tables remain unchanged by evaluation | Small internal PoC evaluation, not certification. |
| `/users`, `/staff`, `/tenant-management`, `/user-logs/:id` | Shared auth + Felicia access management | `/user/*`, `/api/security/*` | `/refresh` after off-board | User CRUD, SecurityLog reads/review | DB-authoritative RBAC; PDPA transaction | User hard delete is intentional; some references are anonymised/soft. |
| `/attendance` | Felicia / Facial Access | `/api/attendance/logs` | None | Attendance read | FM all; Tenant own Staff; Staff self | Scan writes occur through Gate Scanner/service caller. |
| `/logistics` | Felicia / Smart Logistics | `/api/bookings/*` | None | Booking create/read/update/status/cancel | Scoped listings, SG time, conflict check, WhatsApp | Cancellation is status-based; no physical bay sensor. |
| `/driver-pass/:ref` | Felicia / Smart Logistics | public `GET /api/bookings/:ref` | None | Safe Booking read | Polls no-store DTO; large QR/reference | Possession of ref permits this limited public read. |
| `/logistics/gate-verification` | Felicia / Smart Logistics | `/api/qr/decode`, `/api/bookings/gate-verification` | `/api/qr/decode` | Booking transition; GateAccessLog create | FM; local/cloud/manual QR; PoC OCR; audited override; idempotency | OCR is not production LPR; barrier is simulated. |
| `/camera-inventory`, `/detection-settings`, `/cameras` | Charlisa / Object & Space | `/api/cameras`, `/api/zones` | None or Node YOLO proxy | Camera/Zone CRUD | FM writes; FM/Staff read | Camera and zone routers apply JWT verification before role gates. |
| `/object-detection` | Charlisa / Object & Space | `/api/yolo/*`, `/api/detection-alerts`, `/api/edge/detection-alerts` | `/api/yolo/*` | DetectionAlert CRUD; linked IncidentLog create | FM UI; FM/Staff/service/edge API paths; people/unattended rules | Model-supported generic classes only; schedules/pests/actions unsupported. |
| `/support-dashboard`, floating chat | Lucas / Helpdesk | `/api/support/*` | None | Transcript/Ticket/Knowledge CRUD | Public chat (Gemini-generated, KB-grounded replies; deterministic escalation/categorisation); FM ticket/KB management | Gemini failure/timeout/quota falls back to the prior deterministic keyword match. |
| `/incidents` | Gladwin / Incidents | `/api/incident/*` | Optional configured scan endpoint | IncidentLog CRUD; linked alert sync | FM; auto-created from alerts plus manual create | Legacy scan-frame depends on separate `PYTHON_AI_URL`. |

## Facial and camera flow

- Laptop/browser webcam and Raspberry Pi Camera Module 3 both supply transient frames.
- Enrolment captures front/left/right; upload is available when camera access fails.
- Tracking returns face presence, count, box, and head-turn ratio without identity or persistence.
- Recognition returns a matched user ID candidate. Node reads current PostgreSQL user state before returning an outcome.
- Gate Scanner writes attendance after liveness and final same-ID confirmation. V-Patrol writes only security access logs.
- Multiple faces are rejected; this is not labelled tailgating detection.

## Smart Logistics flow

- Booking date/time inputs without an offset are treated as Singapore wall-clock time and persisted as UTC instants.
- Bay conflict validation rejects overlapping non-cancelled bookings with 409.
- The public Driver Pass displays a QR/reference but does not itself authorise entry.
- QR detection order is browser-native `BarcodeDetector`, ZXing, then cloud OpenCV through Node; manual entry remains available.
- Plate OCR runs in the browser with Tesseract and permits FM correction. Node compares normalised plates.
- `POST /api/bookings/gate-verification` re-reads/locks the booking, audits the decision, then transitions Confirmed -> Arrived or Arrived -> Completed. Repeat entry/exit is idempotent.
- WhatsApp is post-commit/non-fatal and defaults to simulated mode. The visual barrier is a simulation.

## Object/incident flow

- Zone configuration can define monitored classes, density and unattended thresholds, cooldown, severity, detection type, and enablement.
- FastAPI and SecurePi use people proximity and elapsed time for unattended-object alerts only for classes produced by the active model.
- Both standard and SecurePi alert-ingest routes create `DetectionAlert` and `IncidentLog` atomically and store `incident_log_id`.
- Updates and soft deletes synchronise in either direction.

## Helpdesk flow

The public chat stores a `ChatTranscript` and escalates on configured phrases or the fifth user message — escalation and ticket categorisation are deterministic, never decided by the AI reply engine. Escalation creates a linked `SupportTicket`. Non-escalating turns get a reply from Google Gemini (`server/services/geminiService.js`), grounded in the `KnowledgeBase` table passed as prompt context; if the Gemini call fails or is unconfigured, the route falls back to the prior deterministic keyword/token-overlap match. FM can read the transcript, update status/resolution notes, or delete the ticket/transcript.

## Cloud, security, privacy, and performance

- Cloud Run client and Node server are public; FastAPI is private and requires Cloud Run IAM plus the app service key.
- Cloud SQL PostgreSQL is authoritative. `faceVector` is `FLOAT[]`, not pgvector.
- CORS fails closed in production/staging without configured origins.
- `MemoryStore` rate limiting is per server instance and resets with cold starts.
- Frames are transient. Facial, QR, and plate images are not permanently stored by the current PoC. Embeddings and audit metadata are stored; models are baked into the AI image.
- SecurePi local snapshots are separate optional edge files and are not a general cloud upload store.
