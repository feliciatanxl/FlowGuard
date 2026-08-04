# Felicia use cases

Scope: Facial Recognition & Access Management, with Smart Logistics and loading-bay verification as the enhanced capability. User authentication is shared infrastructure. The use cases below describe only current behavior.

## Actors and roles

| Actor | Current authority |
|---|---|
| Facilities Manager (`FM`) | Operates facial scanners, evaluation, security review, all-user management, bookings, and gate verification. |
| Tenant | Manages own Staff, enrols own Staff where allowed, views own Staff attendance/logs, and manages own bookings. |
| Staff | Self-enrols, views own attendance, and can create/view unit bookings. |
| Driver/public | Reads a safe Driver Pass by booking reference; has no FlowGuard account requirement. |
| Trusted edge/AI service | Uses configured service credentials for specific scanner/attendance/alert calls; it is not a user role. |

## UC-F1: Create an account and enrol or re-enrol Face ID

- **Actor/role:** FM creates Tenant; Tenant creates own Staff; any authenticated user enrols self; FM enrols any user; Tenant can enrol own Staff.
- **Preconditions:** Creator has a valid JWT and permitted relationship. Target account exists and is active. FastAPI is configured for encoding.
- **Main success flow:**
  1. Authorised creator submits name/email/temporary password to `POST /user/manual-create`.
  2. User opens Face Enrollment and captures front, left, and right views.
  3. Browser sends three transient data-URL images to `POST /user/enroll-face`.
  4. Node forwards images to private FastAPI `/api/encode-faces`.
  5. FastAPI rejects zero or multiple faces, averages valid embeddings, and returns a vector.
  6. Node stores `User.faceVector` as PostgreSQL `FLOAT[]`, sets `isEnrolled`, assigns/retains a stable evaluation label, and requests `/refresh`.
- **Alternate/manual modes:** Raspberry Pi Camera Module 3 is preferred when configured; Pi unavailable switches to laptop webcam. The user may select webcam manually. Camera absent/denied or capture unsuitable -> upload one image for each of the three angles. Invite/code self-registration remains a separate shared-auth path.
- **Edge/error flows:** Missing angle/invalid file -> 400/client error. Unauthorised target -> 403. Unknown target -> 404. AI no face/multiple faces -> 400. AI unavailable -> 503; images remain unstored and enrolment is not changed. Successful database write with failed cache refresh still returns success with refresh pending.
- **Postconditions:** Target has a current embedding and `isEnrolled=true`; no capture image is persisted. Re-enrolment replaces the previous vector.
- **Security/privacy:** Password hash is never returned. No public flow can create FM. Images remain request memory only. Embedding access stays server/AI-side.

## UC-F2: Gate Scanner attendance decision

- **Actor/role:** FM operating `/gate-scanner`; optionally a trusted edge service on the allowed Node endpoints.
- **Preconditions:** FM session is valid; user is enrolled and active for a grant; one camera source is available; Node and private AI service are reachable.
- **Main success flow:**
  1. Page selects Raspberry Pi Camera Module 3 when reachable, otherwise laptop webcam.
  2. Recognition capture uses the shared 512 px/JPEG 0.74 accuracy default. A deployment may raise it only within 512-640 px and 0.74-0.85 through `VITE_FACE_CAPTURE_MAX_WIDTH` and `VITE_FACE_CAPTURE_JPEG_QUALITY`; invalid or lower-detail values fall back to the defaults.
  3. `/api/facial-recognition/track` supplies face count/box/head-turn telemetry using its separate lower-detail tracking constants.
  4. `/api/facial-recognition/recognize` returns an identity candidate; Node re-reads PostgreSQL for authoritative name, role, enrolment, and active state.
  5. Browser collects a baseline and verifies motion/head turn.
  6. A final recognition must match the same user.
  7. `POST /api/attendance/scan` creates IN, then OUT, or updates the day's latest OUT timestamp and writes a deduplicated safe `SecurityLog`.
  8. UI returns `openTurnstile=true` as a software signal; no physical gate is actuated.
- **Alternate/manual modes:** FM can switch Pi/webcam and trigger Scan Now or Retry. Pi snapshot failures persisting past the fallback window switch to webcam.
- **Edge/error flows:** No face -> keep waiting. Unknown/stale identity -> denied and intrusion log. Suspended/un-enrolled -> denied. More than one face -> denied-event after the configured persistent condition; this is not labelled tailgating. Head-turn timeout -> denied-event. Final identity mismatch/disappearance -> fail closed. Camera denied/no camera -> scanner cannot proceed until permission/source is restored (unlike enrolment, there is no uploaded-face grant). Node/Cloud Run or AI unavailable -> service notice and no attendance/grant.
- **Postconditions:** Successful scan writes Attendance and safe audit metadata; failed outcomes do not write Attendance.
- **Security/privacy:** Tracking is identity-free and side-effect-free. Frames are transient. Head-turn liveness is a PoC control, not certified anti-spoofing.

## UC-F3: V-Patrol monitor and review access events

- **Actor/role:** FM.
- **Preconditions:** Valid FM JWT and available camera/AI path.
- **Main success flow:** Uses the same tracking -> recognition -> head-turn -> final same-ID policy as Gate Scanner. The operator selects one of three modes before scanning: **Patrol only** (default) calls `POST /api/facial-recognition/access-event` to write a deduplicated safe `SecurityLog` and no Attendance; **Check In** and **Check Out** additionally call `POST /api/attendance/action` to write an explicit `Attendance` IN/OUT, only after the successful final same-person confirmation.
- **Alternate flows:** Pi -> webcam fallback and manual Scan Now/Retry are available.
- **Edge/error flows:** Unknown, suspended, multiple-face, liveness-timeout, and final mismatch fail closed. `/denied-event` accepts only the defined reason fields/codes and the server owns audit descriptions/severity. Service outage creates no false grant.
- **Postconditions:** Patrol only changes the security timeline with Attendance unchanged. Check In / Check Out write one explicit `Attendance` IN/OUT after a confirmed cycle; denied or failed scans write no Attendance. Duplicate-cycle protection is a bounded per-process guard (there is no `Attendance.cycleId` column, so it is not durable across restarts).
- **Security/privacy:** FM review updates status/notes separately. V-Patrol is a checkpoint monitor, not continuous cross-camera person re-identification.

## UC-F4: Evaluate, review, suspend, and off-board

- **Actor/role:** FM; Tenant may suspend/reactivate or remove only own Staff where the route permits.
- **Preconditions:** Valid JWT and target ownership/role.
- **Main success flow:**
  1. FM explicitly syncs stable evaluation labels and performs side-effect-free frame evaluation.
  2. FM reviews suspicious `SecurityLog` records with an allowed status and notes.
  3. Suspension sets `isActive=false` and increments `tokenVersion`, revoking issued sessions.
  4. Off-boarding transaction wipes the vector, deletes Attendance, anonymises SecurityLog identity, clears Booking ownership, retires EvaluationParticipant, and hard-deletes User.
  5. Node requests AI cache refresh after commit.
- **Alternate flows:** Reactivation sets `isActive=true`; self-deletion is blocked. A Tenant with linked Staff cannot be removed until those records are handled.
- **Edge/error flows:** Bad review status -> 400; wrong role/ownership -> 403; missing target -> 404; linked Staff -> 409; transaction/DB failure -> 500 and rollback. AI refresh failure after off-boarding is non-fatal and is retried on service restart.
- **Postconditions:** Evaluation never mutates production user/attendance/security records. Off-boarded identity no longer has an embedding/account; retained security events are anonymised.
- **Security/privacy:** Stable labels remain reserved for historical evaluation meaning. Evaluation results are browser-local and images/vectors are not stored by that workflow.

## UC-L1: Create, read, edit, and cancel a loading-bay booking

- **Actor/role:** FM, Tenant, or Staff can create/read within route scope; FM edits any; Tenant edits/cancels own; FM changes facility status.
- **Preconditions:** Authenticated user for internal CRUD. Required company, plate, phone, and bay values. A public Driver Pass needs only a valid booking reference.
- **Main success flow:**
  1. User submits booking details and optional slot.
  2. Node interprets offset-less input as Singapore wall-clock time, converts to UTC, validates end > start, and checks overlap for the same bay excluding cancelled bookings.
  3. Node generates `FG-...` reference, stores `Pending`, and sends/simulates the creation WhatsApp message with Driver Pass link.
  4. Scoped list/read returns appropriate bookings. The public pass returns only safe driver-facing fields and renders a large QR plus readable reference.
  5. Authorised edit re-runs time/conflict checks. FM may update status; Tenant/FM may cancel when owned/permitted.
- **Alternate/manual modes:** Booking may omit a schedule; gate verification then returns a schedule-unverified warning if otherwise eligible. WhatsApp disabled/misconfigured is non-fatal and mock-safe.
- **Edge/error flows:** Missing/invalid input -> 400. No/invalid session -> 401/403. Wrong ownership -> 403. Missing booking -> 404. Bay overlap or edit of Completed/Cancelled -> 409. Database failure -> 500. Cancelled/edited pass is refreshed with no-store caching.
- **Postconditions:** Booking and status/timestamps are stored. Cancellation sets `status=Cancelled`; it does not call Sequelize destroy.
- **Security/privacy:** Public Driver Pass excludes tenant ID, phone, notes, and internal timestamps. Booking reference is the possession-based public token.

## UC-L2: FM gate verification and entry/exit

- **Actor/role:** FM only.
- **Preconditions:** Valid FM JWT; action `entry` or `exit`; booking reference; plate input/candidate where required.
- **Automatic mode:**
  1. QR scanner uses native `BarcodeDetector`, then ZXing. Pi Camera Module 3 or laptop webcam can supply frames.
  2. If no QR is detected after the delay, browser uploads bounded snapshots to Node `/api/qr/decode`; Node calls private FastAPI OpenCV decoder.
  3. If still unavailable/not detected, FM enters the reference manually.
  4. Browser captures plate and runs PoC Tesseract OCR; FM may correct the candidate.
  5. Node `/api/bookings/gate-verification` locks/re-reads the authoritative booking, applies status/time/plate rules, writes `GateAccessLog`, and transitions state.
- **Manual mode:** FM types booking reference/observed plate. Manual override is available only for reviewable plate mismatch, unreadable OCR, or camera unavailable outcomes and requires a non-empty reason.
- **Edge/error flows:** Unknown ref -> audited `BOOKING_NOT_FOUND`. Pending/unconfirmed, cancelled, completed, early, late, missing plate, OCR unreadable, and plate mismatch produce explicit codes. Camera denied/Pi unavailable -> webcam or manual mode. Cloud QR/AI unavailable -> local scanning continues and manual entry remains. Missing override reason -> denied. Audit failure on a grant -> 500 and fail closed.
- **Idempotency:** Repeated entry when already Arrived and repeated exit when already Completed return granted/idempotent outcomes without another transition or WhatsApp/next-driver notification.
- **Postconditions:** Confirmed entry -> Arrived/`arrived_at`; Arrived exit -> Completed/`completed_at`; every final decision is audited; Completed can notify the next Pending/Confirmed booking for the same bay.
- **Security/privacy:** Node derives FM identity from the authenticated account. QR/plate images are transient. OCR is not production-grade LPR. UI barrier animation is simulated and does not control hardware.
