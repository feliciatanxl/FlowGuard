# Felicia API documentation

Base URLs: Node routes are relative to the Node service (or the Cloud Run client/Nginx same origin). The browser does not call private FastAPI directly. Examples omit unneeded response fields for readability but use current field names.

## Common contract

- User authentication: `Authorization: Bearer <JWT>`. Missing token -> 401; invalid/expired token -> 403; wrong current role -> 403.
- Trusted service exceptions are stated per endpoint. AI/SecurePi secrets never belong in browser code.
- Route-aware rate limiting can return 429 `{"message":"Too many requests. Please try again later."}`.
- Unexpected database/proxy failures return a sanitised 500/502/503 depending on the route. Not every endpoint deliberately emits every status.
- Image fields are base64 data URLs held in memory only. Facial, QR, and plate images are not persisted.

## Account, enrolment, and privacy endpoints

| Method and path | Purpose; auth/roles | Parameters and example request | Success example and side effects | Expected errors; AI/privacy/audit |
|---|---|---|---|---|
| `POST /user/manual-create` | Create account. JWT; FM -> Tenant, Tenant -> own Staff. | Body `name` or first/last name, `email`, `password`, optional matching `role`. `{"name":"Unit A","email":"unit@example.com","password":"TempPass1","role":"Tenant"}` | 201 `{"message":"Tenant account created.","user":{"id":7,"name":"Unit A","email":"unit@example.com","role":"Tenant","isActive":true}}`; hashes password; links Staff manager. | 400 validation/duplicate, 401, 403 role/tampering, 429, 500. No AI call; password/hash never returned. |
| `POST /user/enroll-face` | Enrol/re-enrol. JWT; self, FM any, Tenant own Staff. | Body `images.front/left/right` data URLs, optional `targetUserId`. `{"images":{"front":"data:image/jpeg;base64,...","left":"...","right":"..."},"targetUserId":7}` | 200 `{"message":"Biometric enrollment successful"}` or cache-refresh-pending message; updates `faceVector`, `isEnrolled`; assigns label. | 400 missing/no/multiple face, 401, 403, 404 target, 429, 502 invalid upstream, 503 AI offline, 500. Calls FastAPI `/api/encode-faces` and `/refresh`; no image persistence. |
| `PUT /user/suspend/:id` | Toggle active state. JWT; FM any, Tenant own Staff. | Path integer `id`; empty body. `PUT /user/suspend/7 {}` | 200 `{"message":"User status updated to Suspended"}`; suspension increments `tokenVersion`. | 401, 403 ownership, 404, 429, 500. No AI call; active sessions are revoked on suspension. |
| `DELETE /user/:id` | Transactional PDPA off-boarding. JWT; FM or Tenant own Staff; not self. | Path integer `id`; no body. | 200 `{"message":"Removed successfully. Biometric data wiped and access logs anonymised."}` | 400 self-delete, 401, 403, 404, 409 Tenant has linked Staff, 429, 500. Wipes embedding, deletes Attendance, anonymises SecurityLog, clears Booking tenantId, retires label, deletes User; non-fatal `/refresh`. |

## Facial recognition and evaluation endpoints

FM JWT or the configured `x-edge-token` is accepted for scanner endpoints marked “FM/edge”. All frames are transient.

| Method and path | Purpose; auth/roles | Parameters and example request | Success example and database side effects | Errors and AI interaction |
|---|---|---|---|---|
| `GET /api/facial-recognition/evaluation-participants` | List stable evaluation labels. JWT; FM. | No parameters. | 200 `{"participants":[{"userId":7,"evaluationLabel":"P01","name":"A","role":"Staff","isActive":true,"isEnrolled":true,"matrixEligible":true}]}`; read only; vector excluded. | 401, 403, 429, 500. No AI call. |
| `POST /api/facial-recognition/evaluation-participants/sync` | Explicit label backfill. JWT; FM. | Empty body `{}`. | 200 `{"synced":3,"participants":[...]}`; creates missing stable mappings. | 401, 403, 429, 500. No AI call; no image data. |
| `POST /api/facial-recognition/evaluate` | Side-effect-free FM evaluation. JWT; FM. | Body `image`. `{"image":"data:image/jpeg;base64,..."}` | 200 `{"outcome":"MATCHED","confidence":0.91,"predictedEvaluationLabel":"P01","policyDecision":"GRANTED","liveness":{"status":"movement-detected"},"timings":{"inferenceMs":80}}`; production tables unchanged. | 400 invalid frame, 401, 403, 413 too large, 429, 502 upstream error, 503 offline, 500. Calls FastAPI `/user/recognize`. |
| `POST /api/facial-recognition/track` | Detector/keypoint telemetry only. FM/edge. | Body `image`. | 200 `{"faceDetected":true,"faceCount":1,"box":[10,20,100,120],"headTurnRatio":0.42,"inferenceMs":35}`; no DB write. | 400, 401/403, 413, 429, 502, 503, 500. Calls FastAPI `/user/track`; never returns identity. |
| `POST /api/facial-recognition/recognize` | Resolve identity candidate and current account state. FM/edge. | Body `image`, optional `cameraLocation`. | 200 authorised `{"user":{"id":7,"name":"A","role":"Staff","status":"AUTHORIZED","confidence":0.91},"box":[...],"liveness_ratio":0.42,"timings":{...}}`; unknown/suspended use 200 with status. | 400, 401/403, 413, 429, 502, 503 registry/offline, 500. Calls FastAPI `/user/recognize`, then PostgreSQL. Unknown/stale/suspended may create deduplicated SecurityLog. |
| `POST /api/facial-recognition/access-event` | Record V-Patrol **Patrol only** safe access (audit only, no Attendance). FM/edge. | `{"userId":7,"cameraLocation":"Biometric Gantry"}` | 200 `{"status":"SUCCESS","logged":true,"worker":"A","role":"Staff"}`; deduplicated SecurityLog only. | 400 userId, 401/403, 404 unknown/not enrolled, 429, 500. No AI call in this endpoint. |
| `POST /api/facial-recognition/denied-event` | Record final scanner denial. FM/edge. | Only `reason`, `candidateUserId`, `cameraLocation`, `confidence`. Example `{"reason":"MULTIPLE_FACES","candidateUserId":null,"cameraLocation":"Main Gate","confidence":null}` | 201 `{"logged":true,"log":{"type":"Multiple Faces Detected","severity":"critical","reviewStatus":"Pending Review"}}`; or 200 deduplicated. | 400 unexpected field/reason/confidence, 401/403, 429, 500. Server owns description/severity; no image/embedding. |

## Attendance and security-audit endpoints

| Method and path | Purpose; auth/roles | Parameters/example | Success and side effects | Errors/privacy |
|---|---|---|---|---|
| `GET /api/attendance/logs` | Role-scoped attendance summary. JWT; FM all, Tenant own Staff, Staff self. | Query filters implemented by route, including date/custom range. Example `?filter=today`. | 200 role-specific summary/records; read only. | 400 invalid custom dates, 401/403, 429, 500. |
| `POST /api/attendance/scan` | Authoritative Gate Scanner attendance write (auto-toggle). FM JWT or `x-service-key`. | `{"userId":7,"cameraLocation":"Main Gate"}` | 200 `{"status":"SUCCESS","action":"CLOCK_IN_SUCCESSFUL","worker":"A","role":"Staff","timestamp":"...","openTurnstile":true}`; creates IN/OUT or updates today's OUT and safe SecurityLog. | 400 userId, 401/403, 404 user, 429, 500. `openTurnstile` is a software signal, not physical actuation. |
| `POST /api/attendance/action` | Explicit V-Patrol **Check In / Check Out** attendance write. FM JWT or `x-service-key`. | `{"userId":7,"action":"IN","cycleId":"<uuid>","cameraLocation":"Biometric Gantry"}` (`action` is `IN` or `OUT`) | 200 records an `Attendance` IN/OUT after the client's successful recognition, liveness, and final same-person cycle; returns an idempotent no-write when the same-day state or `cycleId` already applies. | 400 invalid `action`/`userId`/`cycleId`, 401/403, 404 user, 429, 500. Dedup is a bounded per-process guard on `cycleId` plus same-day Asia/Singapore business-state checks; there is **no** `Attendance.cycleId` column, so it is not durable across restarts. |
| `POST /api/security/logs` | Legacy authenticated client log create. Any valid JWT. | `{"time":"10:00 PM","type":"Access Granted","desc":"...","severity":"safe","icon":"UNLOCK","personnelName":"A"}` | 201 `{"message":"Log secured in database","log":{...}}`; server generates UUID/review state. | 401/403 invalid JWT, 429, 500. Prefer server-owned facial audit endpoints for recognition decisions. |
| `GET /api/security/logs/personnel/:name` | Read logs by exact name. Any valid JWT. | URL-encoded `name`. | 200 array. | 401/403, 429, 500. Contains personnel data. |
| `GET /api/security/logs/user/:id` | User timeline. JWT; FM or Tenant owning target Staff. | Path user `id`. | 200 `{"personnelName":"A","logs":[...]}`. | 401/403, 404 target, 429, 500. |
| `GET /api/security/logs` | Review timeline. Any valid JWT. | Optional `status`, `limit` capped 200. `?status=Pending%20Review&limit=50` | 200 array; read only. | 400 invalid status, 401/403, 429, 500. |
| `PATCH /api/security/logs/:id/review` | FM review status/notes. JWT; FM. | `{"reviewStatus":"Resolved","reviewNotes":"Verified with supervisor"}` | 200 `{"message":"Review updated.","log":{...}}`; sets reviewer/time. | 400 status, 401/403, 404, 429, 500. |

Review statuses: `Pending Review`, `False Positive`, `Escalated`, `Resolved`.

## Smart Logistics endpoints

| Method and path | Purpose; auth/roles | Parameters and example request | Success and database/integration side effects | Expected errors/privacy |
|---|---|---|---|---|
| `POST /api/bookings/create` | Create booking. JWT; FM/Tenant/Staff. | Required `transport_company`, `license_plate`, `driver_phone`, `loading_bay`; optional driver, slots, notes, tenant fields. `{"transport_company":"Acme","license_plate":"GBG 1234M","driver_phone":"+6591234567","loading_bay":"Bay A","slot_start":"2026-07-29T10:00","slot_end":"2026-07-29T11:00"}` | 201 `{"message":"Booking created.","booking":{"booking_ref":"FG-A1B2C3","status":"Pending"},"whatsapp":{"success":true,"simulated":true}}`; stores UTC instants, scoped tenant ID; non-fatal message. | 400 input/time/phone, 401/403, 409 overlap, 429, 500. No image/AI. |
| `GET /api/bookings/` | Scoped list. JWT; any current role. | No body. | 200 array; FM all, Tenant own, Staff manager unit; max 100. | 401/403 invalid token, 429, 500. |
| `GET /api/bookings/all` | Compatibility unscoped list. JWT; FM. | No body. | 200 array; max 100. | 401, 403, 429, 500. |
| `GET /api/bookings/:ref` | Public safe Driver Pass. No auth. | Booking reference path, e.g. `FG-A1B2C3`. | 200 safe fields only; `Cache-Control: no-store`. | 404, 429, 500. Excludes phone, notes, tenantId. |
| `PATCH /api/bookings/:id` | Edit whitelist. JWT; FM any, Tenant own. | Any of company, driver, phone, plate, bay, slots, notes. `{"license_plate":"GBG 9999Z","slot_end":"2026-07-29T11:30"}` | 200 `{"message":"Booking updated.","booking":{...}}`; revalidates time/conflict. | 400, 401, 403, 404, 409 closed/conflict, 429, 500. |
| `PATCH /api/bookings/:id/status` | Facility status update. JWT; FM. | `{"status":"Confirmed"}`; allowed Pending/Confirmed/Arrived/Completed/Cancelled. | 200 includes booking, WhatsApp result, optional `nextInLine`; updates status. | 400 status, 401, 403, 404, 429, 500. Messages are non-fatal. |
| `PATCH /api/bookings/:id/cancel` | Status-based cancellation. JWT; FM or owner Tenant. | Empty body `{}`. | 200 `{"message":"Booking cancelled.","booking":{"status":"Cancelled"},"whatsapp":{...}}`; does not set `deletedAt`. | 401, 403, 404, 429, 500. |
| `PATCH /api/bookings/:ref/gate-scan` | Legacy FM gate transition; compatibility path. JWT; FM. | `{"action":"entry","observedPlate":"GBG1234M"}` | 200 booking/action/plateMatched/message; writes timestamps and messages. Plate mismatch is warn-only on this legacy route. | 400 action, 401, 403, 404, 409 closed status, 429, 500. This route does not write GateAccessLog; use gate-verification for authoritative audited decisions. |
| `POST /api/qr/decode` | Cloud QR candidate decode. JWT; FM. | `{"image":"data:image/jpeg;base64,..."}` | 200 `{"success":true,"bookingRef":"FG-A1B2C3"}` or no-candidate response; no booking/audit mutation. | 400, 401, 403, 413, 429, upstream 4xx, 503, 500. Node calls private FastAPI `/api/qr/decode`; image transient. |
| `POST /api/bookings/gate-verification` | FM-authoritative audited decision. JWT; FM. | `{"action":"entry","bookingRef":"FG-A1B2C3","observedPlate":"GBG1234M","verificationMode":"automatic","plateSource":"ocr","plateConfidence":88.5,"manualOverride":false}` | 200 `{"access":"GRANTED","reasonCode":"VERIFIED","action":"entry","booking":{"status":"Arrived"},"plateMatched":true,"overrideUsed":false,"nextInLine":null}`; writes GateAccessLog before grant, transitions booking, then messages. | 400 bad action/ref; 401; 403; 429; 500 audit/DB fail-closed. Business denials such as not found/cancelled/early/late/mismatch normally return 200 with `access=DENIED` and a reason code, not 404/409. |

Gate reason codes include `VERIFIED`, `BOOKING_NOT_FOUND`, `BOOKING_NOT_CONFIRMED`, `BOOKING_CANCELLED`, `BOOKING_COMPLETED`, `ALREADY_ARRIVED`, `ALREADY_COMPLETED`, `NOT_ARRIVED`, `TOO_EARLY`, `TOO_LATE`, `PLATE_REQUIRED`, `PLATE_MISMATCH`, `OCR_UNREADABLE`, `CAMERA_UNAVAILABLE`, `OVERRIDE_REASON_REQUIRED`, `INVALID_ACTION`, and `AUDIT_FAILED`.

Manual override is accepted only in manual mode for `PLATE_MISMATCH`, `OCR_UNREADABLE`, or `CAMERA_UNAVAILABLE`, and requires `overrideReason`. Repeated Arrived entry and Completed exit are idempotent and do not re-notify.
