# AI Log — Design Documentation Audit & Test Coverage Additions
**Date:** 2026-08-09
**Branch:** feature/object-detection-v2
**Tool:** Claude Code (Opus 5)

---

## Task 1 — Are my API documentation, database schema, and use cases correct?

**Prompt:** "can help me check if my api documentation, database schema, and use cases r correct"

**Response summary:** Read all three documents in `design/Tan Yu En, Charlisa/` (`api-documentation.md`, `database-schema.md`, `use-cases.md`), then verified every claim against the actual source rather than accepting the documents' own account of themselves. Read the four models, all four feature routes, the auth/rate-limit middleware, `detectionSnapshotStorage.js`, `detectionAlertRetention.js`, `detectionAlertBridge.js`, `config/detectionTypes.js`, `securepiStream.js`, `App.jsx`, `Sidebar.jsx`, and the Pi scripts.

**Root finding — the documents were internally consistent but stale.** All three carried the header "re-audited on 2026-07-28, branch `feature/facial-smart-logistics`", while the working branch is `feature/object-detection-v2` with substantial work landed since (WhatsApp notifications, edge idempotency, snapshot upload + GCS storage, the sensor bridge, `detection_type`, camera↔zone exclusivity, rate limiting). Everything describing the *original* feature still held; everything added after 28 July was missing or contradicted.

Findings reported, grouped:

- **Four undocumented endpoints** — `GET /api/zones/:id`, `GET /api/detection-alerts/:id`, `GET /api/detection-alerts/:id/snapshot/:filename`, and FM-only `DELETE /api/detection-alerts/:id`. Both the API doc (§3.6) and the DB doc (§7) explicitly stated *"no DELETE route"*, which was false.
- **Contract errors** — `PUT` accepts `status`/`severity`/`person_name` and rejects unknown keys with 400, not `status` alone; default severity is type-aware via `defaultSeverityForType()`, not a flat `High`; `source` is whitelisted to three values and silently downgraded otherwise; `POST` is idempotent on `event_id`/`cycle_id` (200, not 201); the edge route accepts multipart JPEG, ignores client `source`, never reads `snapshot_url` from the body, and defaults `occurred_at` to server receipt time; list ordering is `COALESCE(occurred_at, createdAt)`; 429 was absent from every error table.
- **Seven missing DB columns** — `sensor_metadata`, `edge_event_id` (unique — the idempotency key), `whatsapp_status`/`_sent_at`/`_error`, `detection_type`, `resolvedAt`.
- **Dead file paths** — the docs cited `edge/securepi/securepi_edge.py`, `edge/securepi/upstream/securePi.py`, and `edge/securepi/repositories/.../securePi.py`. None exist; `git ls-files edge` returns nothing and only a stale `.env` and `__pycache__` remain. The Pi service had also moved from `raspberry-pi/` to `raspberry-pi4/` (port 8081, not 8001) and gained `/sensor_status` backed by a new `sensor_bridge.py`.
- **Missing page** — `SecurityCamera.jsx` at `/security-camera` (FM-only, its own sidebar entry, POSTs alerts) was absent from the use-case document entirely.
- **A role error** — the use-case diagram and summary showed Staff configuring monitoring zones, but every zone and camera write is `requireRole('FM')`, so Staff receives 403 and can only read.

Also confirmed what was still accurate and worth keeping: the `verifyToken` DB re-check and `tokenVersion` revocation semantics with exact messages, `verifyServiceOrRole`, the edge-token 401/503 behaviour and its non-reusability on `/api/detection-alerts`, the `/api/yolo/*` proxy contract, the ENUM-vs-string column analysis, app-only `camera_code` uniqueness, and the inconsistent-error-envelope note.

**Outcome:** Reported with per-document breakdown; no files changed at this stage. Offered to apply the corrections.

---

## Task 2 — Apply the corrections

**Prompt:** "ya sure"

**Response summary:** Rewrote all three documents against `feature/object-detection-v2`, re-dated to 2026-08-09. Change density was high enough that full rewrites were cleaner than dozens of surgical edits, but every still-correct section was preserved verbatim rather than re-derived.

- **`api-documentation.md`** — added the four missing endpoints; new §3.0 documenting rate-limit policies once so 429 need not repeat in every error table; rewrote both ingest routes (type-aware severity table, `source` whitelist, idempotency, multipart upload with its five 400 messages, duplicate-refresh path); added §3.9–§3.12 for incident bridging, WhatsApp, retention, and snapshot storage; corrected every Pi path/port and added a deployment note explaining the detection runtime is not in this repo.
- **`database-schema.md`** — added the seven columns to both the data dictionary and the ERD; rewrote §8 to lead with the `edge_event_id` unique index and why it is load-bearing for retry safety; rewrote §9 because FlowGuard now persists images itself (private GCS or `0600` local disk), which materially changes the sensitive-data position; corrected the migration count from one to six.
- **`use-cases.md`** — expanded 14 → 20 use cases (camera assignment, sensor-triggered inspection, edge evidence ingest, snapshot viewing, false-alarm deletion, WhatsApp); documented `/security-camera`; corrected the SecurePi poll interval to 5 s and the health check to a validating probe rather than a bare liveness ping; corrected Staff to view-only on zones in the actor table, diagram, and specification.

**One self-correction during the work.** Having written UC17 and the traceability table as though `DELETE /api/detection-alerts/:id` were exposed on the Object Detection page, a verification pass (`grep -rn "axios.delete"` across `client/src`) showed **no frontend calls it at all**. Corrected in four places across both documents and recorded as an explicit limitation rather than left as an inferred UI flow.

**Outcome:** Completed. Three files rewritten under `design/Tan Yu En, Charlisa/`; nothing committed.

---

## Task 3 — Add client and server test cases

**Prompt:** "can help me to add on the client test cases and the server test cases"

**Response summary:** The request was ambiguous between the real test files and the `test-cases.md` summary tables, since both exist in each folder — so both were surfaced as a choice alongside a prioritised gap list. User selected **real tests plus both summary updates**, and **all four** gap areas.

**A correction to my own gap analysis was required before writing.** The initial prioritisation was built from shallow greps and overstated the gaps. Reading `detection-alerts.test.js`, `detection-setup.test.js`, and `cameras.test.js` in full showed that two of the four selected areas were already well covered:

- **Zone/camera rules** — `GET /api/zones/:id`, `detection_type` validation and fallback, and the one-camera-per-zone 409 from *both* directions, plus atomic release and rollback, were all already tested. Nothing worth adding.
- **Snapshot evidence** — encoded path-traversal filenames, UUID mismatch, expired storage, and the success path were already covered. Only four authorisation paths were genuinely missing.

Also wrongly reported in Task 3's opening analysis that PUT unsupported-field rejection was untested; it exists at `detection-alerts.test.js:493`. This was corrected to the user rather than quietly worked around, and no redundant tests were written for the already-covered areas.

Two new suites were then written for what was actually missing:

- **`server/tests/Tan Yu En, Charlisa/detection-alert-ingest-rules.test.js` (48 tests)** — event idempotency (the real gap: `DetectionAlert.findOne` was not even present in the existing mock, so the route's lookup was silently skipped by the `typeof === 'function'` guard); a 15-row type-aware severity matrix asserted on both alert and incident; `sensor_metadata` folding including non-overwrite of caller-supplied keys; the `'UNKNOWN'` person convention; confidence clamping and timestamp parsing; list ordering, cap, and status filter; and four snapshot authorisation paths — null `snapshot_url`, an on-device path, **another alert's snapshot requested through this alert's id**, and unauthenticated access.
- **`client/tests/Tan Yu En, Charlisa/securepiSensorStatus.test.js` (43 tests)** — `normalizeSensorStatus` had **zero** coverage anywhere in the client. Covers PIR/motion aliasing in both directions, boolean-only flag rejection, non-negative finite distance/countdown handling, trigger trimming and the 120-character cap, and the three `inspection_id`/`inspection_cycle_id`/`cycle_id` spellings that feed the alert idempotency key.

**Incidental finding.** Writing the sensor tests exposed a dead code path: `normalizeHealth` does `normalizeSensorStatus(body.sensor) || normalizeSensorStatus(body)`, and the second call returns an object for *any* object body — so `health.sensor` is always truthy and the `/sensor_status` fallback inside `testSecurePiConnection` never fires. The derived `sensorStatusUrl` is unused by that helper. Pinned the current call sequence in a test rather than changing behaviour, so wiring it up later happens under review.

Both `test-cases.md` summaries were then rewritten with new rows and honest current totals.

**Verification:** Charlisa's folders are fully green — server 9 suites / 238 tests, client 10 files / 142 tests. Repository-wide, server 51/52 suites and 805/805 tests, client 81/83 files and 866/869 tests. Both repo-wide gaps were verified pre-existing and unrelated: `tests/gcs-detection-snapshots.test.js` cannot resolve `@google-cloud/storage` (declared in `package.json`, absent from local `node_modules` — an environment gap, not a failing assertion), and three failures in `tests/Lucas Renjie Wong/SupportDashboard.test.jsx` reproduce when that file is run in isolation.

**Outcome:** Completed — 91 new tests, all passing, plus both summary documents updated. Offered to run `npm install` in `server/` to close the GCS suite; not yet actioned.

---

## Task 4 — Save this session log

**Prompt:** "Summarize the entire session as a markdown log, per-task prompt/response-summary/outcome, saved as `<yyyy-mm-dd>-<task>.md` in `ai-logs/<name>/`."

**Response summary:** `ai-logs/` does not exist at the repo root; located the established convention at `flowguard-ai/<Full Name>/ai-logs/` and resolved `<name>` to `Tan Yu En, Charlisa` from the session's git user `251787T`, matching this identity's thirteen prior logs. Read `2026-08-06-securepi-stream-and-snapshot-retrieval.md` to match the house format (header block, per-task Prompt / Response summary / Outcome, closing open-items section).

**Outcome:** Completed — written to `flowguard-ai/Tan Yu En, Charlisa/ai-logs/2026-08-09-design-docs-audit-and-test-coverage.md`. Nothing committed, per this folder's convention.

---

## Open items carried out of this session

1. **`DELETE /api/detection-alerts/:id` has no user interface.** It is implemented, role-gated, and now tested, and it is the only FM-exclusive operation in the feature — but nothing in `client/src` calls it, so an FM cannot remove a false alarm without hitting the API directly. Recorded as a limitation in both the API and use-case documents; unresolved whether this is an unbuilt UI or a deliberate deferral.
2. **`@google-cloud/storage` is not installed locally**, so `tests/gcs-detection-snapshots.test.js` cannot run. `npm install` in `server/` should close it.
3. **Three pre-existing client failures** in `tests/Lucas Renjie Wong/SupportDashboard.test.jsx` — another student's file, flagged but not touched.
4. **The `/sensor_status` fallback in `testSecurePiConnection` is unreachable** (see Task 3). Current behaviour is pinned by test; deciding whether the fallback should ever fire is a design question, not a test one.
5. **The SecurePi detection runtime is still absent from this repository.** Only its server-side contract is verifiable here, so on-device detection, tracking, owner-return, and alert-cooldown logic remain undocumented and untestable from this codebase — carried forward from the 2026-08-06 log, where the same gap blocked the snapshot-upload patch.
6. **Design documents and code will drift again.** All three now carry a branch and date in their headers; the value of that convention depends on re-running the audit at each merge, since this session's entire Task 1 finding was a 12-day drift.
