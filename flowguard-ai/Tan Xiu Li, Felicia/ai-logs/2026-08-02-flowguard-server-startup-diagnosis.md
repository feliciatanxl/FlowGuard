# AI Log — Server Startup Fix + FlowGuard Multi-Part Hardening
**Date:** 2026-08-02
**Branch:** feature/facial-smart-logistics
**Tool:** Claude Code (Opus 4.8)
**Project:** FlowGuard

---

## Task 1 — Diagnose the blocking server startup crash

**Prompt:** User pasted the terminal transcript where `node index.js` aborted with
`SyntaxError: Identifier 'INCIDENT_TYPE_BY_DETECTION_TYPE' has already been declared`, and asked
to fix only that issue — "DONT TOUCH ALL THE CODES just fix for this issue".

**Response summary:** Read `server/utils/detectionAlertBridge.js` and its import source
`server/config/detectionTypes.js`. Diagnosed a merge artifact: `INCIDENT_TYPE_BY_DETECTION_TYPE`
was declared twice — once via `require('../config/detectionTypes')` on line 18, and again as an
inline object on lines 22–31 — which Node refuses to run. Noted the inline version was the complete
one (it included the SecurePi edge types `pest_detection`, `restricted_motion`,
`forgotten_belonging`, `item_movement` that `resolveIncidentType` relies on), while the config
version only had the 3 base types. Applied a one-line fix: changed the destructure to pull in only
`DEFAULT_DETECTION_TYPE`, keeping the inline mapping. Verified with
`node -e "require('./utils/detectionAlertBridge.js')"` which printed
"OK: module loads, no duplicate declaration".

**Outcome:** Accepted — the module loaded cleanly; user moved on to a larger task that revisited
this same fix more properly.

---

## Task 2 — Full-repo inspection before the 6-part hardening

**Prompt:** A large multi-part brief to work directly on the repo: fix the syntax error properly
(config as single source of truth), enforce 1–2h Smart Logistics bookings, make the FM dashboard
live and consistent, add a Pi Camera Module 3 gate scan with webcam fallback, polish the manual
gate UI, and run a full regression — with an explicit list of protections not to weaken (JWT/RBAC,
tenant booking isolation, Singapore timezone conversion, loading-bay overlap detection, WhatsApp
notifications, gate audit logging, existing alert/incident linking, webcam/manual fallbacks).

**Response summary:** Marked a new chapter and read the core files across all six sections in
parallel before changing anything: `detectionAlerts.js`, `edgeDetectionAlerts.js`,
`bookingDateTime.js`, `booking.js`, `dashboard.js`, `dashboardAnalytics.js`, `Dashboard.jsx`,
`Booking.js`, `zones.js`, the chart components, the client camera utilities (`cameraSource.js`,
`piCamera.js`, `gateCamera.js`, `plateOcr.js`), `GateVerification.jsx`, `TenantLogistics.jsx`,
`pi_camera_steam.py`, and the existing test suites. Created six tracked tasks (one per section).
Identified the key constraint that shaped Section 1: `detection-types-config.test.js` asserts
`DETECTION_TYPES` equals exactly the 3 zone-selectable categories, so the fix had to keep those 3
while expanding the incident mapping to all 7.

**Outcome:** Informational — used as the basis for the implementation in Tasks 3–8.

---

## Task 3 — Section 1: config as the single source of truth for detection types

**Prompt:** Implicit — Section 1 of the brief, executed as the first implementation step.

**Response summary:** Rewrote `server/config/detectionTypes.js` to hold the full 7-entry
`INCIDENT_TYPE_BY_DETECTION_TYPE` mapping (unattended_object→UNATTENDED_OBJECT,
crowd_density→OVERCROWDING, unauthorized_access→UNAUTHORIZED_ACCESS, pest_detection→PEST_DETECTION,
restricted_motion→RESTRICTED_MOTION, forgotten_belonging→FORGOTTEN_BELONGING,
item_movement→ITEM_MOVEMENT), while keeping `DETECTION_TYPES` as the 3 zone-selectable types so
`zones.js` validation was unaffected. Edited `detectionAlertBridge.js` to import the mapping once,
preserving the text-based fallback. Ran `node --check` across the affected backend files and the
focused Jest suites (3 suites / 47 tests passed), then added a test asserting all 7 mappings resolve
through the bridge (12 tests passed).

**Outcome:** Accepted.

---

## Task 4 — Section 2: enforce 1–2 hour Smart Logistics bookings

**Prompt:** Implicit — Section 2 of the brief.

**Response summary:** Added `validateBookingWindow(startAt, endAt)` plus `MIN/MAX_BOOKING_MINUTES`
to `server/utils/bookingDateTime.js`, detecting missing/invalid start or end, end-not-after-start,
and durations below 60 or above 120 minutes with the exact API error strings from the brief. Wired
it into both `POST /api/bookings/create` and the `PATCH` edit route before the overlap query,
preserving the Singapore wall-clock→UTC conversion. Verified the helper against 60/120/59/121-min
and missing-field cases. Updated the conflicting fixtures in `logistics.test.js` and
`booking-timezone.test.js` (which used sub-60-min or slot-less windows) and wrote a new
`booking-duration.test.js`; all 95 booking tests passed. On the frontend, added Singapore-safe
helpers (`validateBookingWindowLocal`, `bookingWindowMinutes`, `addSingaporeMinutesToLocalInput`,
`formatDurationMinutes`) to `constants/datetime.js`, updated `TenantLogistics.jsx` with required
slots, an auto-suggested end (+1h, never overwriting a user-set end), live duration display, inline
validation and a disabled submit, added the booking-window hint CSS to `Booking.css`, and wrote a
TZ-independent Vitest suite (7 tests passed).

**Outcome:** Accepted.

---

## Task 5 — Section 3: make the FM dashboard live and consistent

**Prompt:** Implicit — Section 3 of the brief.

**Response summary:** In `dashboardAnalytics.js`, restricted both the 7-day trend and the top-zones
aggregation to High/Critical alerts only. In `routes/dashboard.js`, added `no-store` headers, a
`generatedAt` timestamp (on FM, Tenant, and Staff responses), and an `analyticsAvailable` flag so a
failed analytics query is distinguishable from a genuine zero state. Rewrote `Dashboard.jsx`'s data
flow to poll the single `/summary` payload every 15s while visible (pausing when hidden, refreshing
on visible), avoiding overlapping/stale requests, keeping last-good data, adding a Refresh button
and "Last updated … SGT" label, and dropping the separate `/api/detection-alerts` fetch. Extended
`AlertTrendChart.jsx` and `TopAlertZonesChart.jsx` with an `unavailable` prop to distinguish outage
from empty, strengthened the `.sr-only` rule, and added refresh-bar / stale-banner CSS. Updated the
dashboard tests and wrote a new `Dashboard.test.jsx` polling test (5 tests passed); backend
dashboard suites passed 17/17.

**Outcome:** Accepted.

---

## Task 6 — Section 4 & 5: Pi Camera gate scan + manual gate UI polish

**Prompt:** Implicit — Sections 4 and 5 of the brief.

**Response summary:** Added shared source-selection and Pi-capture helpers to `cameraSource.js`
(Pi-first with webcam fallback for both QR and plate OCR) and wrote a unit test with a mutable Pi
mock (6 tests passed). Rewrote `GateVerification.jsx` to wire the Pi-first workflow together with the
manual-UI polish, and updated `GateVerification.css` (responsive breakpoint, dark manual card, field
grid, focus-visible indicators, source card, chips). Aligned `.env.example` to the canonical Pi
variables and added a README section covering the Pi-first gate camera, its deployment limitation,
and the same-DB manual verification procedure.

**Outcome:** Accepted.

---

## Task 7 — Section 6: full regression and fixture repair

**Prompt:** Implicit — Section 6 of the brief.

**Response summary:** Ran `node --check` across all backend JS (all passed) and the full backend
Jest suite (40 suites / 578 tests passed). The full client Vitest run surfaced 8 failures in 5 files
caused by the new required-slots/duration UI and the dropped alerts fetch. Diagnosed each and split
the fix between code and fixtures: routed Pi capture back through the mockable `fetchPiSnapshotBitmap`
boundary and disambiguated the new plate-source buttons with `aria-label`; restored the hard
first-load error message; gave the zones chart a distinct empty message; then updated four existing
test fixtures (`LogisticsTimezone`, `LogisticsToday`, `DashboardAnalytics`, `Dashboard`) to use valid
1–2h windows or the summary's `recentHighPriorityAlerts`. A clean full re-run passed 64 files / 581
tests (an earlier "20 failed" run was confirmed as concurrency flakiness). Client lint showed only
pre-existing errors in untouched test files; cleaned the two genuinely-introduced ones in
`GateVerification.jsx` (unused `React` import, redundant synchronous setState) leaving zero net-new
lint errors. Client `npm run build` passed; Raspberry Pi `pytest` passed 9/9 (Pi code unchanged).

**Outcome:** Accepted — all six sections complete and green. Recorded a project memory noting the
booking-duration rule and the `DETECTION_TYPES`-vs-mapping constraint.
