# AI Log — Facial Camera Tracking, Liveness, and Pi Frames
**Date:** 2026-07-12
**Branch:** feature/smart-logistics-whatsapp
**Tool:** Claude Code (claude-fable-5)
**Project:** FlowGuard
**Source session:** `d228096a-2874-4b66-abc0-5742a9bee2cf`

**Archive note:** User-authored prompts are reproduced verbatim except that credential-like values are replaced with `[REDACTED]`. Internal auto-review, subagent, command, and tool-notification records are omitted.

---

## Task 1 — Work inside FlowGuard on branch: feature/smart-logistics-whatsapp Fix only facial-camer…

**Prompt date/time:** 2026-07-12 18:45:25 SGT

**Prompt (verbatim):**

> Work inside FlowGuard on branch:
>
> feature/smart-logistics-whatsapp
>
> Fix only facial-camera tracking, head-turn liveness responsiveness and Pi frame
> delivery for:
>
> - Gate Scanner
> - V-Patrol
>
> Do not modify:
>
> - CRUD
> - User Management
> - Smart Logistics
> - confusion-matrix/evaluation code
> - Attendance business rules
> - SecurityLog business rules
> - access permissions/RBAC
> - teammates’ modules
> - object detection
> - database models
>
> Do not stage, commit or push.
>
> Start with:
>
> git status --short
> git branch --show-current
>
> Inspect the actual current code first.
>
> Likely files:
>
> raspberry-pi/Tan Xiu Li, Felicia/pi_camera_steam.py
> ai-service/main.py
> server/routes/facialRecognition.js
> client/src/pages/GateScanner.jsx
> client/src/pages/VPatrol.jsx
> client/src/constants/faceBox.js
> client/src/constants/scanControl.js
> related Felicia tests
>
> ==================================================
> CURRENT CONFIRMED PROBLEMS
> ==================================================
>
> 1. The displayed face box is not real-time tracking.
>
> It is updated only from the full /recognize response. Full InsightFace latency
> can be approximately 6–8 seconds on CPU, so the box stays in an old location
> while the person moves.
>
> 2. Liveness currently uses an absolute single-frame eye/nose ratio:
>
> calculate_head_turn(kps)
>
> Gate Scanner passes only when:
>
> ratio < 0.35 || ratio > 0.65
>
> V-Patrol uses another absolute range.
>
> This can remain stuck even when the user visibly turns their head.
>
> 3. The current Pi Flask server calls capture_array() and JPEG encoding
> independently for:
>
> - continuous /video_feed
> - every /snapshot request
>
> This creates duplicate camera/encoding work while recognition is active.
>
> 4. Pi camera selection does not make InsightFace faster by itself. Recognition
> still runs on the laptop CPU.
>
> Do not solve this by sending every video frame through full InsightFace.
>
> ==================================================
> 1. ADD A SINGLE PI FRAME PRODUCER AND MEMORY CACHE
> ==================================================
>
> Refactor:
>
> raspberry-pi/Tan Xiu Li, Felicia/pi_camera_steam.py
>
> Create one background capture thread.
>
> The thread should:
>
> - capture from Picamera2 at a controlled target of approximately 15 FPS
> - encode one JPEG per captured frame
> - store only the latest JPEG in memory
> - store latest frame sequence number and timestamp
> - use a lock/condition safely
> - never save camera frames to disk
>
> /video_feed must:
>
> - stream the latest cached JPEG
> - wait for a new sequence instead of calling capture_array itself
> - avoid unlimited busy-looping
>
> /snapshot must:
>
> - immediately return the latest cached JPEG
> - not call capture_array
> - not perform a second JPEG encoding
> - return 503 if no frame is available yet
>
> Keep CORS and no-cache headers.
>
> Enhance /health with safe operational telemetry:
>
> {
>   "status": "ok",
>   "camera": "Pi Camera Module 3",
>   "targetFps": 15,
>   "frameAgeMs": ...,
>   "sequence": ...
> }
>
> Do not expose images in telemetry.
>
> Preserve graceful shutdown.
>
> ==================================================
> 2. ADD A LIGHTWEIGHT TRACKING ENDPOINT
> ==================================================
>
> The full recognition endpoint currently performs:
>
> - face detection
> - embedding inference
> - comparison against all enrolled faces
>
> Create a separate service-key-protected FastAPI endpoint:
>
> POST /user/track
>
> It must perform face detection/keypoint processing only.
>
> Preferred approach:
>
> - reuse InsightFace’s already-loaded detection model directly
> - do not run the recognition/embedding model
> - max_num = 2 so multiple faces can be detected
> - use a smaller detector input where safe, approximately 256px
> - return the largest/primary face
>
> Return safe transient telemetry only:
>
> {
>   "faceDetected": true,
>   "faceCount": 1,
>   "box": [x, y, width, height],
>   "headTurnRatio": 0.47,
>   "inferenceMs": 120
> }
>
> Rules:
>
> - no embedding
> - no matched user
> - no name
> - no DB query
> - no Attendance
> - no SecurityLog
> - no image persistence
>
> If no face:
>
> {
>   "faceDetected": false,
>   "faceCount": 0,
>   "box": null,
>   "headTurnRatio": null
> }
>
> Add an authenticated Node proxy:
>
> POST /api/facial-recognition/track
>
> It must be side-effect-free and forward only the safe tracking result.
>
> Use a shorter timeout than full recognition.
>
> ==================================================
> 3. SEPARATE TRACKING FROM RECOGNITION
> ==================================================
>
> In Gate Scanner and V-Patrol, create two independent controlled loops.
>
> A. Tracking loop
>
> Purpose:
>
> - move the on-screen face box
> - detect presence
> - measure head-turn movement
>
> Timing:
>
> - approximately every 200–300 ms
> - only one tracking request in flight
> - use a small tracking frame, approximately max width 256
> - JPEG quality approximately 0.45–0.55
> - ignore stale responses after source switch or unmount
>
> It must call only:
>
> /api/facial-recognition/track
>
> B. Full recognition loop
>
> Purpose:
>
> - identify the person
>
> Timing:
>
> - keep the existing no-overlap behavior
> - approximately once every 1 second when identification is needed
> - use the existing recognition frame sizing/quality
> - do not call continuously after a candidate identity is secured
>
> It must call:
>
> /api/facial-recognition/recognize
>
> Do not combine the two in-flight locks.
>
> Use:
>
> trackingInFlightRef
> recognitionInFlightRef
>
> ==================================================
> 4. MAKE THE BOX ACTUALLY FOLLOW THE FACE
> ==================================================
>
> Use tracking-endpoint boxes for the visual overlay.
>
> Do not use sparse full-recognition boxes as the primary visual tracker.
>
> Preserve the existing captured-frame-to-preview coordinate conversion.
>
> Apply modest smoothing:
>
> smoothed = previous * 0.55 + current * 0.45
>
> to:
>
> - x
> - y
> - width
> - height
>
> Do not over-smooth and cause visible lag.
>
> Add a short CSS transition around 80–120 ms.
>
> Behavior:
>
> - update at tracking cadence
> - retain box through one brief missed detection
> - clear after approximately 700–900 ms without a face
> - reset immediately after camera-source change
> - do not render a stale box from the old source
> - handle preview/container resizing correctly
>
> If multiple faces are present:
>
> - show “Multiple faces detected — one person at a time”
> - do not continue access authorization
>
> ==================================================
> 5. REPLACE ABSOLUTE LIVENESS WITH BASELINE MOVEMENT
> ==================================================
>
> Current single-frame absolute thresholds are too rigid.
>
> When an authorised candidate is first recognised:
>
> 1. Collect a stable baseline from up to three recent valid tracking ratios.
> 2. Use their median as baselineHeadTurnRatio.
> 3. Enter the head-turn challenge.
>
> During the challenge:
>
> - calculate delta = currentRatio - baselineRatio
> - require abs(delta) >= a tested movement threshold, initially around 0.07–0.10
> - require the movement to remain valid for two consecutive tracking samples
> - ignore tiny jitter
> - display “Turn head slightly and hold”
> - show progress only from real tracking observations, not random progress
>
> Do not use only:
>
> ratio < 0.35 || ratio > 0.65
>
> Use nullish handling:
>
> ratio ?? null
>
> Do not use `ratio || 0.5`.
>
> Add a liveness timeout, approximately 15 seconds:
>
> - on timeout, deny/reset safely
> - keep Gate turnstile locked
> - do not create false Attendance
>
> ==================================================
> 6. FINAL SAME-IDENTITY CONFIRMATION
> ==================================================
>
> The lightweight tracker must never grant access by itself.
>
> Secure flow:
>
> 1. Full recognition identifies candidate user.
> 2. Lightweight tracking confirms requested head movement.
> 3. Run one final full /recognize request.
> 4. Require final matched user ID to equal the original candidate user ID.
> 5. Only then:
>    - Gate Scanner calls Attendance
>    - V-Patrol records access-event
>
> If identity differs, disappears, becomes unknown or becomes suspended:
>
> - fail closed
> - clear candidate
> - reset challenge
> - do not grant access
>
> This preserves same-identity liveness binding.
>
> ==================================================
> 7. CORRECT SECURITY WORDING
> ==================================================
>
> Current UI uses copy such as:
>
> ANTI-SPOOF ACTIVE
>
> Head-turn challenge-response alone is not a complete anti-spoofing model.
>
> Replace with honest wording:
>
> MOTION LIVENESS ACTIVE
> HEAD-TURN VERIFICATION
> TURN HEAD SLIGHTLY AND HOLD
>
> Do not claim presentation-attack detection unless a dedicated anti-spoof model
> actually exists.
>
> ==================================================
> 8. PERFORMANCE TELEMETRY
> ==================================================
>
> In development mode only, log separate timings:
>
> Tracking:
> - capture
> - request
> - detector inference
>
> Recognition:
> - capture
> - Node→AI
> - embedding inference
> - total
>
> Also log head-turn telemetry in development only:
>
> baseline ratio
> current ratio
> delta
> consecutive valid samples
>
> Never log:
>
> - image data
> - base64
> - embeddings
> - face vectors
>
> Do not show debug telemetry in production UI.
>
> ==================================================
> 9. TESTS
> ==================================================
>
> Add focused tests proving:
>
> Pi server:
> 1. /video_feed and /snapshot use the shared latest-frame cache.
> 2. /snapshot does not trigger another camera capture.
> 3. capture loop has a controlled target FPS.
> 4. no frames are persisted.
>
> Tracking API:
> 5. tracking endpoint returns box and ratio without identity data.
> 6. it does not query User/Attendance/SecurityLog.
> 7. no-face and multiple-face results are handled.
> 8. service-key protection remains.
>
> Frontend:
> 9. tracking and recognition use separate in-flight guards.
> 10. tracking updates the box independently of recognition.
> 11. stale tracking responses are ignored.
> 12. box coordinates are smoothed.
> 13. missed tracking clears the box after timeout.
> 14. multiple faces stop authorization.
> 15. liveness uses change from baseline rather than fixed absolute ratio.
> 16. two consecutive movement samples are required.
> 17. liveness timeout fails closed.
> 18. final recognition must match original candidate.
> 19. Gate Attendance happens only after final same-ID confirmation.
> 20. V-Patrol access-event happens only after final same-ID confirmation.
> 21. operational camera source switching remains functional.
> 22. no evaluation/confusion-matrix code is changed.
>
> Run focused tests first.
>
> Then:
>
> cd client
> npm test -- --run
> npm run build
>
> Run only relevant server/AI/Pi tests added or modified.
>
> Do not modify teammate files.
>
> ==================================================
> FINAL RESPONSE
> ==================================================
>
> Return:
>
> 1. Exact reason the video remained stuck in liveness
> 2. Current versus new tracking architecture
> 3. Pi frame-cache implementation
> 4. Tracking-endpoint implementation
> 5. Box update frequency and smoothing
> 6. Baseline head-turn logic
> 7. Final same-identity confirmation
> 8. Performance measurements before/after, if measurable
> 9. Client tests
> 10. Client production build
> 11. Server/AI/Pi focused tests
> 12. Remaining limitations
> 13. Confirmation no teammate/CRUD/evaluation files changed
> 14. Confirmation nothing staged/committed/pushed

**Response summary:** The archived final response for this task stated:

> All done — everything implemented, tested, and built. Full report below.
>
> ## 1. Exact reason the video remained stuck in liveness
>
> Two compounding causes:
> - **Stale box:** the face box was only updated from full `/recognize` responses (6–8 s InsightFace CPU latency), so the overlay froze at an old position while the person moved.
> - **Rigid liveness rule:** both pages tested one absolute single-frame ratio against fixed bands (`GateScanner.jsx`: `< 0.35 || > 0.65`; `VPatrol.jsx`: `< 0.45 || > 0.55`), and coerced missing ratios with `res.data.liveness_ratio || 0.5`. Anyone whose resting pose read mid-band could turn their head visibly yet never cross the band on the *single sparse frame* that happened to be sampled — and the 6–8 s cadence meant most of the turn was never even observed.
>
> ## 2. Current vs new tracking architecture
>
> Before: one 1 s loop → `/recognize` did detection + embedding + full match every tick, and drove the box, presence, liveness, and access.
> Now, two independent loops per page:
> - **Tracking loop** (`performTrackingScan`, every 250 ms, `trackingInFlightRef`): small 256 px / 0.5-quality frame → `POST /api/facial-recognition/track` → box, faceCount, headTurnRatio. No identity, no DB, no logs. Stale responses dropped via the session token.
> - **Recognition loop** (`performRecognitionScan`, every 1 s, `recognitionInFlightRef` scan-gate): runs **only** in `TARGET_LOCKING`; once a candidate is secured it stops until the final confirmation. The two in-flight locks are never shared.
>
> ## 3. Pi frame-cache implementation
>
> [pi_camera_steam.py](raspberry-pi/Tan Xiu Li, Felicia/pi_camera_steam.py) now has one `CaptureLoop` daemon thread (capture → **one** JPEG encode → `FrameCache.publish`, paced to 15 FPS) and a `FrameCache` (lock + condition, latest JPEG + sequence + timestamp only, never disk). `/video_feed` blocks on `wait_for_next` (bounded wait, no busy loop, no capture); `/snapshot` returns the cached JPEG instantly or **503** before the first frame; `/health` reports `{status, camera, targetFps, frameAgeMs, sequence}` — no image data. CORS/no-cache headers and graceful shutdown preserved. Picamera2 import moved into `main()` so the module is testable off-device.
>
> ## 4. Tracking-endpoint implementation
>
> - FastAPI [main.py](ai-service/main.py): `POST /user/track` (service-key protected) calls the **already-loaded detection model directly** (`face_app.models["detection"].detect(img, input_size=(256,256), max_num=2)`) — the embedding model never runs. Returns the largest face as `{faceDetected, faceCount, box:[x,y,w,h], headTurnRatio, inferenceMs}`, or explicit nulls when no face. No DB, no identity, no persistence.
> - Node [facialRecognition.js](server/routes/facialRecognition.js): `POST /api/facial-recognition/track` (same FM/edge auth), **5 s timeout** (vs 15 s recognition), whitelists exactly the five safe fields, zero side effects.
>
> ## 5. Box update frequency and smoothing
>
> The box updates at tracking cadence (~250 ms), smoothed in frame space with `smoothed = prev·0.55 + current·0.45` ([faceBox.js](client/src/constants/faceBox.js) `smoothBox`), then projected through the existing contain-fit conversion using the container's *current* size each tick (handles resizes). An inline 100 ms CSS transition makes movement glide. The box survives one missed detection, clears after 800 ms without a face, and is wiped immediately on camera-source switch (`clearTrackingState` + session bump). Multiple faces show "MULTIPLE FACES DETECTED — ONE PERSON AT A TIME" and abort the candidate/challenge.
>
> ## 6. Baseline head-turn logic
>
> [liveness.js](client/src/constants/liveness.js): when a candidate is recognised, baseline = **median of up to three recent valid tracking ratios** (collected live if none exist yet). During the challenge, `delta = ratio − baseline`; a pass needs `|delta| ≥ 0.08` on **two consecutive** samples; jitter or an invalid sample (`ratio ?? null`, never `|| 0.5`) resets the streak. 15 s timeout fails closed (candidate cleared, turnstile locked, no Attendance/access-event). Progress shown only from real observations.
>
> ## 7. Final same-identity confirmation
>
> Both pages: recognition secures candidate → tracking confirms head-turn → `runFinalConfirmation` issues **one** final `/recognize` and requires `finalUser.id === candidate.id` **and** status still `AUTHORIZED`. Only then does Gate call `/api/attendance/scan` or V-Patrol post `/api/facial-recognition/access-event` (the only call sites, verified by tests). Mismatch/unknown/suspended/disappeared → fail closed and reset.
>
> ## 8. Performance measurements
>
> Not directly measurable here (no Pi or live AI service in this environment). Structurally: box latency drops from one full-recognition cycle (~6–8 s inference + 1 s cadence) to one detector-only pass at 256 px (~tens–low-hundreds of ms) every 250 ms; Pi capture/encode work per active scan drops from 2× per request (stream + snapshot each capturing/encoding) to exactly 1× per frame at a capped 15 FPS. Dev-only telemetry (`logTrackingTimings`, `logLivenessTelemetry`, existing `logScanTimings`) logs capture/request/inference durations and baseline/delta/consecutive — never images or templates.
>
> ## 9–11. Tests and build
>
> - **Client:** `npm test -- --run` → **40 files, 371/371 passed** (includes new [TrackingLiveness.test.jsx](client/tests/Tan Xiu Li, Felicia/TrackingLiveness.test.jsx) covering separate guards, box smoothing/clearing, stale-response drops, multi-face abort, baseline liveness, timeout fail-closed, final same-ID gating, honest wording; [ScannerPerformance.test.jsx](client/tests/Tan Xiu Li, Felicia/ScannerPerformance.test.jsx) updated for the parameterized capture helper). One unrelated pre-existing test (FaceEnrollment) flaked once and passed on re-run.
> - **Client build:** `npm run build` succeeds (chunk-size warning is pre-existing).
> - **Server:** new [tracking.test.js](server/tests/Tan Xiu Li, Felicia/tracking.test.js) + existing facialRecognition/access-event suites → **40/40 passed**.
> - **AI + Pi:** [test_track_endpoint.py](ai-service/test/test_track_endpoint.py) + [test_pi_camera_stream.py](raspberry-pi/Tan Xiu Li, Felicia/test_pi_camera_stream.py) → **15/15 passed** via the ai-service venv. Note: I pip-installed `pytest`, `httpx`, `flask` into `ai-service/.venv` as test-only tooling (not added to requirements.txt).
>
> ## 12. Remaining limitations
>
> - Head-turn motion liveness is challenge-response only — no presentation-attack detection model (UI wording now says so honestly).
> - Tracking still round-trips browser → Node → FastAPI; on a very slow network the 250 ms cadence self-throttles via the in-flight guard rather than queueing.
> - The final confirmation is one full recognition (~6–8 s on CPU), so "AUTHORIZING" has a visible pause.
> - Recognition speed itself is unchanged (still laptop CPU InsightFace), by design.
> - Lint: the two pages gain two more `use-before-declare` hits of the pre-existing baseline pattern (useEffect above the new loop functions); no new unused-vars or purity errors vs baseline.
>
> ## 13–14. Scope and git state
>
> No teammate, CRUD, User Management, Smart Logistics, evaluation/confusion-matrix, Attendance/SecurityLog business-rule, RBAC, object-detection, or database-model files were modified — the AI-service change is purely the additive `/user/track` block. Nothing was staged, committed, or pushed (`git diff --cached` is empty).
>
> Two things I noticed and did **not** cause but want to flag: mid-session, `raspberry-pi/Tan Yu En, Charlisa/SecurePi-main.zip` showed as deleted from the working tree — I restored it with `git restore` — and an untracked old copy of `pi_camera_steam.py` appeared at `raspberry-pi/` root (dated Jul 9). I left that stray file untouched; you may want to check whether antivirus or a file manager moved things there.

**Outcome:** A final response was recorded in the source session.
