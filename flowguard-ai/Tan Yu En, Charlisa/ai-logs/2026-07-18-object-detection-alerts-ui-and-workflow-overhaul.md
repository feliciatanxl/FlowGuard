# AI Log — Object Detection Alerts UI Polish + Full Workflow Overhaul
**Date:** 2026-07-18
**Branch:** feature/object-detection-space
**Tool:** Claude Code (Sonnet 5)

---

## Task 1 — Centralize and make the alert list scrollable

**Prompt:** On the Object Detection page's "Latest Detection Alerts" card, center the "No active alerts" empty state and add a scrollable feature so all alerts show on scroll (with a screenshot of the card as-is).

**Response summary:** In `client/src/css/ObjectDetection.css`, gave `.od-live-alert-list` a `max-height: 320px` + `overflow-y: auto`, and centered the empty-state `<p>` within a fixed `min-height: 120px` box via flex. In `client/src/pages/ObjectDetection.jsx`, removed the `.slice(0, 4)` cap on the rendered alert list so every open alert is reachable by scrolling instead of only the first four.

**Outcome:** Accepted — no pushback; the user moved straight to the next request.

---

## Task 2 — Add a "Clear All" button to the Object Detection alert card

**Prompt:** "could u also add a clear all function ?"

**Response summary:** Added `handleClearAllAlerts` in `ObjectDetection.jsx`, which PUTs `status: 'Cleared'` in parallel for every currently open alert via the existing `/api/detection-alerts/:id` endpoint, then merges the responses into state. Wired a new "Clear All" button into the card heading (disabled when busy or when there are no active alerts), plus matching CSS (`od-clear-all-btn`, `justify-content: space-between` on the heading).

**Outcome:** Accepted, no corrections.

---

## Task 3 — Center the empty state across the whole card (discarded)

**Prompt:** A follow-up screenshot showing the layout still looked "a bit odd", asking to center the text to the whole card so it fits perfectly.

**Response summary:** Made `.od-alert-summary-card` a flex column (`flex: 1`) and let `.od-live-alert-list` grow (`flex: 1`, `min-height: 160px`) to fill the space between the heading and the "Detection Setup"/"Camera Inventory" buttons, so the empty message would center in the full card body rather than a small fixed box.

**Outcome:** Rejected — the user interrupted mid-turn with "OH NO NO NO DISCARD THAT". I reverted `ObjectDetection.css` back to the Task 1 state (fixed `min-height: 120px` box, no flex-column card) and asked what specifically was wrong before proceeding.

---

## Task 4 — Fix the actual gap the user meant (Detection Setup vs. last alert item)

**Prompt:** After two screenshots for clarification (the second cropped to show the last alert item, e.g. "Person Detected", sitting flush against the "Detection Setup" button), the user wanted breathing room between the alert list and that button specifically.

**Response summary:** Identified the real complaint via the cropped screenshot — `.od-ops-actions` (containing the Detection Setup/Camera Inventory links) had no top margin, so it sat directly against the last `.od-live-alert-item`. Added `margin-top: 14px` to `.od-ops-actions` in `ObjectDetection.css`.

**Outcome:** Accepted, no further comments.

---

## Task 5 — Same treatment (Clear All + UI polish) on the Cameras page

**Prompt:** "could u do the same for the cameras page add a clear all and see if u can make the UI better ? ( as in fonts and all )"

**Response summary:** In `client/src/pages/Cameras.jsx`, added `clearAllAlerts` (bulk PUT to `Cleared` for all `Active` alerts) and wired a "Clear All" button next to the "ACTIVE"/"CLEAR" count badge in the "Smart Detection Events" card; removed the `.slice(0, 6)` cap since the list already scrolls. In `client/src/css/Cameras.css`, added `.camera-alert-heading-actions`/`.camera-clear-all-btn` styling, tightened heading font-weight/letter-spacing, and added hover states on alert cards and the "Mark cleared" button for a less static feel.

**Outcome:** Accepted, no corrections.

---

## Task 6 — Full Object Detection workflow overhaul (12-item spec)

**Prompt:** A long, detailed spec (12 numbered items) to make the whole Object Detection workflow "technically consistent and demonstrable": reverse IncidentLog→DetectionAlert sync on PATCH/DELETE; fix a case-sensitive `Home` import breaking Linux builds; send `camera_id`/`zone_id` from the analyse-frame endpoint so a selected camera loads its own Detection Setup rule instead of a global fallback; respect a zone's `detection_enabled` flag; add an explicit `detection_type` field to `MonitoringZone` instead of inferring it client-side; map alert type into the correct `IncidentLog` type via one shared helper; release cameras on zone deletion; enforce one-camera-per-zone; resolve an Incident Dashboard role-policy mismatch (FM vs. FM+Staff); preserve a long list of existing behaviors; add Jest/Vitest/Python tests; and run full verification (server/client tests, client build, Python compile check, `git diff --check`, `git status`) without committing or pushing.

**Response summary:** Read every referenced model/route/page first (`DetectionAlert`, `IncidentLog`, `MonitoringZone`, `Camera`, `detectionAlerts.js`, `edgeDetectionAlerts.js`, `incident.js`, `zones.js`, `cameras.js`, `App.jsx`, `ObjectDetection.jsx`, `DetectionSettings.jsx`, `IncidentDashboard.jsx`, `CameraInventory.jsx`, `Sidebar.jsx`, `ai-service/main.py`, all relevant existing tests) before touching anything. Then: fixed the `./pages/home` → `./pages/Home` import; added reverse-sync PATCH/DELETE logic to `incident.js` (mirrors severity/person_name/status onto the linked `DetectionAlert`, transaction-wrapped, safe on unlinked/old incidents); confirmed and applied an FM-only policy across all `/api/incident` admin routes (the frontend route was already FM-only with no Staff nav entry) while leaving the unrelated facial-recognition `/scan-frame` ingest route untouched; added `camera_id`/`zone_id` to the analyse-frame payload via an extracted, exported `buildAnalyzeFramePayload` helper plus a `monitoredCameraRef` to avoid stale closures; refactored `ai-service/main.py`'s zone-threshold lookup into a new DB-free `zone_rules.py` module (`resolve_zone_config`) so it's unit-testable without booting YOLO/InsightFace, wired it into `/api/yolo/analyze-frame`, and gated alert-firing on `detection_enabled`; added `MonitoringZone.detection_type` (validated, with a safe `unattended_object` fallback for old rows) and updated `DetectionSettings.jsx`/`detectionSettingsPayload.js` to read/write it explicitly instead of guessing from severity/density; added a shared `server/utils/detectionAlertBridge.js` mapping helper (unattended/crowd/unauthorized → `IncidentLog` type) used by both alert-ingest routes; made zone deletion release its cameras in a transaction; added a one-camera-per-zone exclusivity check (409) to `cameras.js`. Added new Jest suites (`incident-detection-sync.test.js`, `detection-alert-bridge.test.js`) and extended existing ones, a new Python `zone_rules.py` unit-test file runnable via `unittest`, and client tests for the new payload shapes. Ran the full verification chain: 294/294 server, 213/214 client (one env-dependent pre-existing failure unrelated to this work, confirmed via `git diff --stat` showing zero diff on that test file), client build succeeded, 7/7 Python tests, `py_compile` clean. Reported files changed, schema changes, role-policy rationale, and the one known pre-existing failure; did not commit or push.

**Outcome:** Accepted as a full implementation pass — the user's next message opened with "Approved. Proceed with the plan, but apply these additional requirements," treating this as the base to refine rather than something to redo.

---

## Task 7 — Refine the overhaul against 12 additional mid-turn requirements

**Prompt:** Mid-turn message layering stricter requirements onto Task 6's work: single-transaction guarantees and no-recursive-update on the reverse sync; frontend/backend/test consistency for the FM-only policy (401 vs 403 vs FM-allowed, service-key `/scan-frame` preserved); `camera_id`/`zone_id` sent from every analyse-frame flow (webcam + uploaded video) with no silent fallback to the global-smallest threshold for a valid id; `detection_enabled: false` must still return a valid (non-error) response; `detection_type` create/read/update/refresh consistency with no migration framework; one shared alert-type→incident-type helper covering all three categories; zone deletion releasing cameras atomically; strict one-camera-per-zone conflict handling; additional client/Python tests; and the same full verification chain, again with no commit/push.

**Response summary:** Verified the already-implemented work against each new constraint (most were already satisfied by Task 6's design) and reported the same file list with explicit answers to the newly-asked questions: how Camera A is proven to load Camera A's rule (via the `zone_rules.resolve_zone_config` unit tests), how a disabled zone is proven not to fire alerts (via the `detection_enabled` guard in `_annotate_detection_frame` plus its unit test), the final FM-only decision and its rationale, and remaining limitations (non-atomic two-request camera reassignment across the two-page flow; `detection_type` bridging only applies when `zone_name` resolves to a real row). Re-ran and confirmed the full verification chain again.

**Outcome:** Accepted — the user's next message opened with "The implementation is nearly complete," confirming the direction, and asked for further fixes rather than raising objections to what was delivered.

---

## Task 8 — Fix the flaky client test and make camera reassignment atomic

**Prompt:** Four concrete follow-ups: (1) properly fix the one failing client test (`ObjectDetectionSourceModes.test.jsx`, failing because the developer's local `client/.env` leaks `VITE_SECUREPI_STREAM_URL` into the test run) using `vi.stubEnv`/`vi.unstubAllEnvs` rather than changing production code, targeting 214/214 (or higher); (2) move camera assignment/reassignment ownership fully into the zone backend so it's a single atomic transaction instead of two sequential HTTP calls, with specific validation/conflict/rollback rules for zone create and update, plus a battery of required test scenarios; (3) inspect all untracked files (`git status --short --untracked-files=all`) and ensure `__pycache__`/`*.pyc` are gitignored without deleting legitimate Python test sources; (4) re-run the full verification chain and report exact files, atomicity behavior, test totals, build result, pycache confirmation, limitations, a commit message, and full `git status`, again without committing or pushing.

**Response summary:** For the flaky test — since `ObjectDetection.jsx` reads `VITE_SECUREPI_STREAM_URL`/`VITE_SECUREPI_HEALTH_URL` into a top-level `const` at module-eval time, `vi.stubEnv` alone can't reach it after a static import; rewrote `ObjectDetectionSourceModes.test.jsx` to use `vi.resetModules()` + a dynamic re-import of both `axios` and `ObjectDetection` together (avoiding an orphaned automock instance), with `beforeEach`/`afterEach` stubbing a deterministic empty env baseline and one new test explicitly stubbing a fallback URL for a camera with no `stream_url` of its own. For atomic assignment — extended `server/routes/zones.js`'s POST/PUT to accept an optional `camera_id` (tri-state: absent/`null`/value), validating existing-camera-elsewhere conflicts (409) inside the same `sequelize.transaction` as the zone write/create, and removed the old two-request dance (`assignCameraToZone`/`handleCameraMapping`) from `DetectionSettings.jsx` in favor of sending `camera_id` inside the same zone request (`detectionSettingsPayload.js` updated to include it). Added a full new test block in `detection-setup.test.js` covering atomic create-with-camera, replace-with-conflict, same-camera-is-valid, explicit-null-release, nonexistent-camera, omitted-camera (backward compatible), and simulated-mid-transaction-failure-preserves-old-assignment; fixed two pre-existing assertions that broke because `zone.update` now always runs inside a transaction. Confirmed `__pycache__`/`*.pyc` were already covered by the existing root `.gitignore` (line 343) via `git check-ignore -v` — no `.gitignore` edit needed. Ran the full chain: 304/304 server, 215/215 client (zero failures), Python 7/7, build clean, `git diff --check` clean (only CRLF notices).

**Outcome:** Accepted — no corrections; the user's next message was this log-saving request, with no objections to Task 8's report.

---

## Task 9 — Save this session log

**Prompt:** Summarize the entire session as a markdown log — for each major task, the ask, a response summary, and whether it was accepted/edited/rejected — saved as `<yyyy-mm-dd>-<task>.md` in `ai-logs/<name>/`.

**Response summary:** Found the repo convention (`flowguard-ai/<Full Name>/ai-logs/`) from existing same-identity log files already present under `Tan Yu En, Charlisa/ai-logs/`, matching this session's test-authorship folder (`server/tests/Tan Yu En, Charlisa/`, `client/tests/Tan Yu En, Charlisa/`). Created this new, distinctly-named file covering all nine tasks of this session, including the one explicitly discarded change (Task 3) and its accepted replacement (Task 4).

**Outcome:** In progress (this file).
