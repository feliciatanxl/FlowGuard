# AI Log — Pi/Webcam/Upload Camera-Source Unification
**Date:** 2026-07-28
**Branch:** feature/facial-smart-logistics
**Tool:** Claude Code (claude-opus-4-8)
**Project:** FlowGuard
**Source session:** `aa5ecba9-ca40-498c-b6fa-30f2045ae503`

**Archive note:** User-authored prompts are reproduced verbatim except that credential-like values are replaced with `[REDACTED]`. Internal auto-review, subagent, command, and tool-notification records are omitted.

---

## Task 1 — You are working on the FlowGuard React, Node.js, FastAPI and PostgreSQL project. GOAL R…

**Prompt date/time:** 2026-07-28 09:39:54 SGT

**Prompt (verbatim):**

> You are working on the FlowGuard React, Node.js, FastAPI and PostgreSQL project.
>
> GOAL
>
> Refactor FlowGuard’s Facial Recognition and Smart Logistics camera workflows so
> both modules consistently support:
>
> 1. Raspberry Pi Camera Module 3 as the preferred physical hardware source
> 2. Laptop/browser webcam as the automatic fallback
> 3. Manual camera-source selection
> 4. Automatic processing
> 5. Manual processing and recovery
> 6. Local development
> 7. Deployed Google Cloud environments
> 8. Clear timing and diagnostic information
> 9. Safe cleanup of cameras, timers and pending requests
>
> Do not modify unrelated modules.
>
> Do not remove existing working features.
>
> Do not change existing API contracts unless the change is necessary and clearly
> documented.
>
> IMPORTANT ARCHITECTURE FACTS
>
> The deployed React client still runs inside the user’s browser.
>
> Therefore:
>
> - Browser webcam frames are captured by the laptop.
> - Browser QR decoding normally runs on the laptop.
> - Deploying the React client to Google Cloud does not automatically move QR
>   processing to Cloud Run.
> - A Cloud Run QR decoder is only possible when the browser or Raspberry Pi
>   uploads a captured image.
> - Do not continuously stream webcam video frames to Cloud Run.
> - Cloud decoding should be a controlled snapshot fallback.
> - The existing Node.js gate-verification endpoint remains authoritative.
> - The QR decoder may only return a candidate booking reference.
> - The QR decoder must never approve access itself.
> - Facial recognition inference should remain in the FastAPI AI service.
> - PostgreSQL and existing server-side rules remain the source of truth.
>
> HARDWARE
>
> Felicia’s intended hardware is:
>
> - Raspberry Pi
> - Raspberry Pi Camera Module 3
>
> The Camera Module 3 is used for:
>
> - facial-recognition image capture
> - Smart Logistics QR capture
> - Smart Logistics vehicle-plate image capture
>
> The laptop webcam remains the fallback for:
>
> - local development
> - deployed browser testing
> - presentations when the Raspberry Pi is unavailable
>
> Standardise user-facing wording and comments as:
>
> “Raspberry Pi Camera Module 3”
>
> Do not refer to it as Camera Module 2.
>
> FIRST INSPECT THE CURRENT IMPLEMENTATION
>
> Inspect at least the following files and any directly related helpers, routes,
> styles and tests.
>
> Client:
>
> - client/src/constants/piCamera.js
> - client/src/utils/gateCamera.js
> - client/src/utils/plateOcr.js
> - client/src/pages/GateVerification.jsx
> - client/src/pages/DriverPass.jsx
> - client/src/pages/GateScanner.jsx
> - client/src/pages/FaceEnrollment.jsx
> - client/src/pages/VPatrol.jsx
> - any existing camera hooks or reusable camera components
> - related client tests
> - related CSS files
>
> AI service:
>
> - ai-service/main.py
> - ai-service/zone_rules.py
> - ai-service/yolo_service.py
> - ai-service/requirements.txt
> - ai-service/requirements-torch.txt
> - existing service-key authentication
> - existing image validation utilities
> - existing tests
>
> Server:
>
> - existing logistics booking routes
> - existing gate-verification routes
> - GateAccessLog implementation
> - existing AI-service proxy patterns
> - authentication and RBAC middleware
> - related server tests
>
> CURRENT KNOWN BEHAVIOUR
>
> - Facial pages already attempt to support Pi and browser camera sources.
> - GateVerification currently uses the browser webcam for QR scanning.
> - gateCamera.js currently uses @zxing/browser.
> - ZXing may currently be dynamically imported only after Start Scanner is
>   pressed.
> - Current camera constraints may only request facingMode.
> - DriverPass currently renders a relatively small QR code.
> - Plate OCR currently uses tesseract.js in the browser.
> - Manual gate verification and audited overrides already exist.
> - Cloud deployment may not have access to a private Raspberry Pi LAN address.
> - Server-side booking and gate-state validation must remain authoritative.
>
> ============================================================
> PHASE 1 — SHARED CAMERA-SOURCE ARCHITECTURE
> ============================================================
>
> Create or refactor a reusable camera-source abstraction supporting:
>
> - pi
> - webcam
> - upload
> - manual
>
> The abstraction should expose clear operations such as:
>
> - detect available sources
> - start source
> - stop source
> - capture frame
> - switch source
> - report source status
> - report source error
>
> Required behaviour:
>
> 1. Prefer Raspberry Pi Camera Module 3 only when its URL is configured.
> 2. Do not wait for a Pi timeout when no Pi URL is configured.
> 3. If the Pi is configured but unreachable, fail quickly and fall back to the
>    laptop webcam.
> 4. Avoid repeatedly probing an unavailable Pi.
> 5. Apply a short retry cooldown before probing the Pi again.
> 6. Allow the user to manually select Pi or laptop webcam.
> 7. Clearly show the active source in the UI.
> 8. Stop previous MediaStream tracks before switching sources.
> 9. Cancel timers, animation frames and network requests when the page unmounts.
> 10. Prevent two modules from accidentally opening duplicate browser streams.
> 11. Keep raspberrypi.local support for local development.
> 12. Support an explicit environment-variable Pi URL.
> 13. Do not assume a deployed browser can access a private Raspberry Pi address.
> 14. Preserve existing Pi endpoints such as /video_feed and /snapshot when they
>     are already used.
> 15. Do not write captured facial, QR or plate images to permanent browser or
>     Cloud Run storage.
>
> Suggested source states:
>
> - checking
> - available
> - unavailable
> - starting
> - active
> - stopped
> - error
> - fallback-active
>
> ============================================================
> PHASE 2 — FAST LAPTOP QR SCANNING
> ============================================================
>
> Refactor the browser QR scanner for minimum practical latency.
>
> Use the following decoding order:
>
> 1. Native browser BarcodeDetector for qr_code when supported
> 2. @zxing/browser BrowserQRCodeReader as the compatibility fallback
> 3. Cloud OpenCV snapshot decoding after the local timeout
> 4. Manual booking-reference entry as the final fallback
>
> Do not use BrowserMultiFormatReader because FlowGuard only needs QR codes.
>
> CAMERA CONSTRAINTS
>
> Request these preferences:
>
> - width ideal 1280
> - height ideal 720
> - frameRate ideal 30
> - frameRate max 30
> - facingMode ideal environment
> - audio false
>
> Treat the constraints as preferences.
>
> If the webcam cannot supply 1280×720, continue with the closest supported
> resolution rather than failing unnecessarily.
>
> After startup, log the actual MediaStreamTrack settings.
>
> SCANNER LOADING
>
> - Preload @zxing/browser when GateVerification loads.
> - Do not wait until Start Scanner is clicked to download the scanner module.
> - Do not recreate BrowserQRCodeReader on every render.
> - Keep the reader in a stable ref or reusable service.
> - Reuse the previously selected camera device when it still exists.
> - Avoid repeatedly requesting camera permission.
>
> SCANNING LOOP
>
> - Start one scanner loop only.
> - Ignore ordinary “not found in this frame” errors.
> - Continue scanning when an invalid QR is detected.
> - Stop immediately after one valid FlowGuard reference is detected.
> - Prevent duplicate processing of the same QR.
> - Prevent duplicate backend verification requests.
> - Prevent scanner restart caused by React re-renders.
> - Use an AbortController for cloud fallback requests.
> - Stop all local and cloud scanning after success.
> - Stop all scanning when the user presses Stop.
> - Release all camera tracks on unmount.
>
> VALID QR FORMAT
>
> Normalise whitespace and accept only the project’s valid reference format.
>
> Use the existing format when already defined.
>
> Otherwise use a carefully documented format such as:
>
> ^FG-[A-Z0-9]{4,12}$
>
> Do not send random QR text to the booking-verification API.
>
> SCANNER STATES
>
> Display separate states:
>
> - Loading scanner…
> - Starting camera…
> - Camera ready
> - Looking for QR…
> - QR detected
> - Verifying booking…
> - Booking verified
> - Booking denied
> - Local scan taking longer than expected
> - Trying cloud-assisted scan…
> - Manual entry available
> - Camera permission denied
> - Camera unavailable
>
> TIMING METRICS
>
> Record:
>
> - page-to-scanner-ready time
> - camera startup time
> - time until first usable video frame
> - local QR decode time
> - cloud QR decode time
> - backend booking-verification time
> - total time to final decision
> - decoder source used
>
> Decoder source values:
>
> - barcode-detector-browser
> - zxing-browser
> - opencv-cloud
> - pi-camera-cloud
> - manual-entry
>
> Log timing information in development.
>
> Show a small diagnostic panel only when a development/debug flag is enabled.
>
> ============================================================
> PHASE 3 — DRIVER PASS QR QUALITY
> ============================================================
>
> Update DriverPass.jsx.
>
> Requirements:
>
> 1. Encode only the short booking reference.
> 2. Do not encode a long Cloud Run URL.
> 3. Increase the generated QR size from approximately 180 px to approximately
>    360 px.
> 4. Use a pure white background.
> 5. Use a pure black QR code.
> 6. Include a proper QR quiet-zone margin.
> 7. Do not stretch a small QR image using CSS.
> 8. Generate it at its actual required resolution.
> 9. Make it responsive on small phone screens.
> 10. Keep edges sharp.
> 11. Do not apply blur, transparency or decorative overlays.
> 12. Display the readable booking reference below the QR.
> 13. Add a Copy Reference action for manual fallback.
> 14. Keep the pass status and validity clearly visible.
> 15. Avoid unnecessary re-rendering of the QR component.
>
> The QR should remain approximately square and large enough for a low-resolution
> laptop webcam.
>
> ============================================================
> PHASE 4 — CLOUD QR SNAPSHOT FALLBACK
> ============================================================
>
> Add an authenticated FastAPI endpoint:
>
> POST /api/qr/decode
>
> Use the project’s existing service-key or authenticated AI-route pattern.
>
> INPUT
>
> Accept one JPEG or PNG image using multipart upload or the project’s existing
> authenticated image-payload convention.
>
> SECURITY AND VALIDATION
>
> - Require existing authentication.
> - Apply a strict request-size limit.
> - Reject unsupported content types.
> - Decode bytes safely.
> - Reject malformed images.
> - Do not trust the supplied filename.
> - Do not store the image permanently.
> - Do not save it to the repository.
> - Do not save it to Cloud Run local storage.
> - Do not include raw image data in logs.
> - Avoid exposing stack traces to the client.
> - Rate-limit through the existing project pattern when available.
>
> DECODING
>
> Use OpenCV QRCodeDetector.
>
> Recommended processing sequence:
>
> 1. Decode the original image.
> 2. If not found, convert to grayscale.
> 3. If not found, optionally resize while preserving aspect ratio.
> 4. If not found, optionally apply safe contrast enhancement or thresholding.
> 5. Do not perform excessive expensive transformations.
> 6. Stop when a valid result is found.
>
> Normalise the result.
>
> Accept only a valid FlowGuard booking-reference format.
>
> Example successful response:
>
> {
>   "success": true,
>   "bookingRef": "FG-ABC123",
>   "decodeMs": 123,
>   "decoder": "opencv-cloud"
> }
>
> Example no-result response:
>
> {
>   "success": false,
>   "bookingRef": null,
>   "decodeMs": 145,
>   "decoder": "opencv-cloud",
>   "message": "No valid FlowGuard QR code detected"
> }
>
> The endpoint must never:
>
> - verify the booking
> - approve entry
> - approve exit
> - update booking status
> - write GateAccessLog
> - open a physical barrier
>
> It only returns a candidate booking reference.
>
> The existing Node gate-verification endpoint remains authoritative.
>
> ============================================================
> PHASE 5 — CLOUD FALLBACK BEHAVIOUR
> ============================================================
>
> For laptop webcam scanning:
>
> 1. Start native BarcodeDetector or ZXing immediately.
> 2. Continue local scanning.
> 3. If no valid result is found after approximately 2.5 seconds, activate cloud
>    snapshot fallback.
> 4. Capture a clear JPEG frame from the existing video element.
> 5. Use a reasonable JPEG quality such as 0.85.
> 6. Do not upload the full-resolution frame when unnecessarily huge.
> 7. Preserve enough resolution for QR decoding.
> 8. Send no more than approximately one cloud snapshot per second.
> 9. Allow only one cloud request at a time.
> 10. Continue local scanning while waiting for the cloud result.
> 11. Whichever valid decoder returns first wins.
> 12. Stop all scanners and requests immediately after a valid result.
> 13. Cancel pending requests when scanning stops.
> 14. Do not upload 30 video frames per second.
> 15. Do not create a live webcam-streaming service through Cloud Run.
>
> If the cloud service is cold or unavailable:
>
> - continue local scanning
> - show a non-blocking fallback message
> - keep manual booking-reference entry available
> - do not freeze the UI
>
> ============================================================
> PHASE 6 — SMART LOGISTICS CAMERA SOURCES
> ============================================================
>
> Update GateVerification so it supports the following modes.
>
> AUTOMATIC MODE — PI CAMERA MODULE 3
>
> - Use the configured Pi Camera Module 3 snapshot endpoint.
> - Capture a fresh still image.
> - Send the snapshot to /api/qr/decode.
> - Receive a candidate booking reference.
> - Send the booking reference to the existing authoritative server endpoint.
> - Continue with plate capture/OCR when required.
> - Record the source as pi-camera-cloud.
> - Fall back to browser webcam when the Pi is unavailable.
>
> AUTOMATIC MODE — LAPTOP WEBCAM
>
> - Use native BarcodeDetector when available.
> - Otherwise use BrowserQRCodeReader.
> - After the timeout, enable cloud snapshot fallback.
> - Continue to the existing plate-verification process.
> - Stop the webcam when no longer required.
>
> MANUAL MODE
>
> Keep and improve:
>
> - typed booking reference
> - typed plate number
> - manual image capture
> - manual retry
> - audited FM override
> - mandatory override reason
> - clear indication that the result was manually entered or overridden
>
> Do not remove simulation mode when it is used for assignment demonstration.
>
> Clearly label simulation output as simulated.
>
> AUTOMATIC PLATE PROCESSING
>
> Preserve the existing automatic Tesseract.js plate OCR when it works.
>
> Requirements:
>
> - do not run plate OCR while QR scanning is still active unless intentionally
>   designed
> - stop QR scanning before heavy plate OCR starts
> - show OCR progress
> - allow the detected plate to be reviewed
> - allow correction before submission
> - record whether the plate came from automatic OCR or manual entry
>
> The backend remains responsible for comparing and validating the plate.
>
> ============================================================
> PHASE 7 — FACIAL-RECOGNITION CONSISTENCY
> ============================================================
>
> Do not rewrite the working InsightFace recognition algorithm.
>
> Heavy facial recognition must remain in the FastAPI AI service.
>
> The browser or Raspberry Pi only captures the frame.
>
> FACE ENROLLMENT
>
> Support:
>
> - Raspberry Pi Camera Module 3
> - laptop webcam fallback
> - manual source selection
> - photo upload
> - automatic three-angle enrollment
> - manual capture/retry for each angle
> - multiple-face rejection
> - insufficient-quality rejection
> - progress states
> - camera cleanup
>
> GATE SCANNER
>
> Support:
>
> - Raspberry Pi Camera Module 3 as preferred source
> - laptop webcam fallback
> - manual source selection
> - automatic recognition loop
> - manual single-capture action
> - manual retry
> - clear recognition state
> - liveness/head-turn flow
> - multiple-face rejection
> - no client-side access grant without authoritative responses
>
> V-PATROL
>
> Support:
>
> - Pi preferred when configured and reachable
> - laptop webcam fallback
> - automatic periodic recognition
> - manual single check
> - stop and restart controls
> - no overlapping AI requests
> - cleanup on unmount
> - source label in generated patrol logs
>
> FACIAL FLOW
>
> Automatic:
>
> Camera source
> → capture frame
> → safely resize/compress
> → FastAPI InsightFace service
> → server-authoritative user/access decision
> → attendance/security logging
>
> Manual:
>
> User chooses source or upload
> → captures or selects image
> → submits for AI recognition/enrollment
> → reviews result
> → retries when required
>
> Do not store facial images permanently unless the project’s existing approved
> enrollment process explicitly requires it.
>
> ============================================================
> PHASE 8 — UI AND ERROR HANDLING
> ============================================================
>
> Use consistent source labels:
>
> - Raspberry Pi Camera Module 3
> - Laptop Webcam
> - Photo Upload
> - Manual Entry
> - Simulation
>
> Show why a fallback occurred:
>
> - Raspberry Pi is not configured
> - Raspberry Pi is unreachable
> - Browser camera permission was denied
> - Browser QR detection timed out
> - Cloud decoder was unavailable
> - No valid QR was detected
> - Manual entry is required
>
> Do not display raw technical exceptions to normal users.
>
> Keep detailed error information in development console logs.
>
> Avoid continuous alert popups.
>
> Use inline status messages.
>
> Ensure controls remain usable on mobile and desktop.
>
> ============================================================
> PHASE 9 — PERFORMANCE ACCEPTANCE TARGETS
> ============================================================
>
> Treat these as project performance targets, not guaranteed hardware claims.
>
> Under good lighting with a clear 360 px QR:
>
> - scanner UI ready within approximately 3 seconds
> - QR detected within approximately 2 seconds after camera focus
> - local-to-cloud fallback begins after approximately 2.5 seconds
> - no duplicate booking-verification request
> - backend verification measured separately
> - total QR-to-decision target within approximately 5 seconds when Cloud Run
>   services are warm
> - UI remains responsive during scanning
> - manual entry always available
>
> Create a repeatable test procedure with at least 20 scan attempts.
>
> Record:
>
> - successful scans
> - failures
> - median decode time
> - maximum decode time
> - percentage completed within 2 seconds
> - percentage completed within 5 seconds
> - decoder source used
> - browser and device tested
> - lighting condition
> - QR display size
> - backend verification time
>
> Do not claim a percentage until the actual tests are completed.
>
> ============================================================
> PHASE 10 — TESTS
> ============================================================
>
> Add or update tests covering:
>
> CAMERA SOURCES
>
> - Pi configured and reachable
> - Pi configured but unreachable
> - Pi not configured in production
> - unavailable Pi causes webcam fallback
> - manual source switching
> - camera cleanup on unmount
> - previous stream stops before switching
> - no unnecessary Pi delay in deployed environments
> - source labels are correct
>
> QR SCANNING
>
> - BarcodeDetector supported
> - BarcodeDetector unavailable causes ZXing fallback
> - valid QR accepted
> - invalid QR ignored
> - duplicate QR processed only once
> - duplicate verification request prevented
> - larger Driver Pass QR rendered
> - cloud fallback starts after timeout
> - cloud fallback request throttling
> - local decoder wins and cancels cloud request
> - cloud decoder wins and stops local scanner
> - Stop button cancels everything
> - unmount cancels everything
> - manual booking reference still works
>
> CLOUD QR ENDPOINT
>
> - authentication required
> - valid JPEG accepted
> - valid PNG accepted
> - invalid file rejected
> - oversized file rejected
> - malformed image rejected
> - no QR returns safe no-result response
> - invalid QR content rejected
> - valid FlowGuard reference returned
> - image is never persisted
> - endpoint cannot approve gate access
> - endpoint cannot update booking status
> - endpoint cannot write GateAccessLog
>
> SMART LOGISTICS
>
> - automatic Pi workflow
> - automatic webcam workflow
> - manual booking workflow
> - manual plate workflow
> - OCR result correction
> - audited override requires reason
> - gate verification remains server authoritative
>
> FACIAL RECOGNITION
>
> - Pi unavailable causes webcam fallback
> - photo-upload enrollment remains available
> - three-angle enrollment remains working
> - automatic recognition loop prevents overlapping requests
> - manual single capture works
> - camera cleanup works
> - existing facial tests remain passing
>
> Run the relevant commands that exist in this repository:
>
> - client unit tests for changed files
> - server unit/integration tests
> - AI tests
> - npm build
> - lint
> - pip check
> - Docker build where available
>
> Do not claim all tests pass unless they were actually executed.
>
> Clearly distinguish:
>
> - passing tests
> - failing tests introduced by this change
> - pre-existing failing tests
> - tests that could not be executed
>
> ============================================================
> PHASE 11 — DEPLOYMENT SAFETY
> ============================================================
>
> Confirm required environment variables.
>
> Possible variables may include:
>
> Client:
>
> - VITE_PI_CAMERA_URL
> - VITE_ENABLE_PI_CAMERA
> - VITE_ENABLE_CLOUD_QR_FALLBACK
> - VITE_QR_CLOUD_FALLBACK_DELAY_MS
> - VITE_CAMERA_DEBUG
>
> Server or AI service:
>
> - AI_SERVICE_KEY
> - NODE_SERVER_URL
> - QR_MAX_IMAGE_BYTES
> - QR_ALLOWED_CONTENT_TYPES
>
> Use the project’s current naming conventions.
>
> Do not introduce duplicate environment variables unnecessarily.
>
> Do not commit:
>
> - .env files
> - credentials
> - API keys
> - uploaded facial images
> - captured QR images
> - captured plate images
> - local virtual environments
> - model caches generated outside the intended Docker build
>
> ============================================================
> FINAL REPORT
> ============================================================
>
> At the end, provide:
>
> 1. Files inspected
> 2. Files changed
> 3. Architecture before and after
> 4. Laptop webcam automatic flow
> 5. Pi Camera Module 3 automatic flow
> 6. Facial-recognition automatic and manual flows
> 7. Smart Logistics automatic and manual flows
> 8. QR local and cloud fallback sequence
> 9. Performance measurements added
> 10. Tests run and exact results
> 11. Pre-existing test failures
> 12. Remaining limitations
> 13. Required environment variables
> 14. Cloud deployment steps
> 15. Recommended commit message
>
> Recommended commit message:
>
> feat(camera): add resilient Pi and webcam AI workflows

**Response summary:** The archived final response for this task stated:

> All phases complete, all tests run and green (except documented baselines), and memory updated for future sessions. Here's the final report.
>
> ---
>
> # FlowGuard Camera & QR Refactor — Final Report
>
> ## 1. Files inspected
> **Client:** `constants/piCamera.js`, `constants/scanControl.js`, `constants/api.js`, `utils/gateCamera.js`, `utils/plateOcr.js`, `utils/plate.js`, `pages/GateVerification.jsx`, `pages/DriverPass.jsx`, `pages/GateScanner.jsx`, `pages/FaceEnrollment.jsx`, `pages/VPatrol.jsx`, `css/DriverPass.css`, `css/GateVerification.css`, plus 12 related test files (all fs-read/render contracts).
> **AI service:** `main.py` (structure, `require_service_key`, `base64_to_cv2`, `/refresh`, YOLO boundary), `requirements.txt`, `requirements-torch.txt`, `.env.example`, `test/test_track_endpoint.py`.
> **Server:** `routes/booking.js`, `services/gateVerification.js`, `models/GateAccessLog.js`, `routes/facialRecognition.js`, `services/aiServiceAuth.js`, `middlewares/auth.js`, `middlewares/rateLimit.js`, `index.js`, `.env.example`, test conventions.
>
> ## 2. Files changed
> **Modified (15):** `ai-service/main.py`, `ai-service/.env.example`, `client/.env.example`, `client/src/utils/gateCamera.js`, `client/src/pages/{DriverPass,GateVerification,FaceEnrollment,GateScanner,VPatrol}.jsx`, `client/src/css/{DriverPass,GateVerification}.css`, `server/index.js`, and 3 test files (label assertions).
> **New (9):** `client/src/utils/cameraSource.js`, `server/routes/qr.js`, `docs/Tan Xiu Li, Felicia/qr-scan-performance-test-procedure.md`, `ai-service/test/test_qr_endpoint.py`, `server/tests/Tan Xiu Li, Felicia/qr-decode.test.js`, and 4 client test files (`CameraSource`, `GateCameraScanner`, `GateVerificationSources`, `DriverPassQr`).
> `scanControl.js`, `piCamera.js`, YOLO code, and all teammate modules are **untouched**.
>
> ## 3. Architecture — before → after
> - **Before:** each page inlined its own `getUserMedia`; QR scanner dynamically imported ZXing only *after* Start; constraints requested `facingMode` only; DriverPass QR ~180 px; no cloud decode path.
> - **After:** a shared `cameraSource.js` provides the source vocabulary, standardized constraints, labels, fallback reasons, and `startWebcamStream`/`stopStream`. `gateCamera.js` is a cohesive scanner service (BarcodeDetector→ZXing, preload, states, timing, dedup, cloud orchestration). New **browser → Node `/api/qr/decode` → FastAPI `/api/qr/decode`** snapshot fallback that returns only a *candidate* ref — the Node gate-verification route stays authoritative.
>
> ## 4. Laptop webcam automatic flow
> Preload ZXing on mount → `startQrScan` opens the webcam at 1280×720/30fps/environment (preferences; falls back to closest mode) → **native BarcodeDetector** decodes, else **ZXing** → after `VITE_QR_CLOUD_FALLBACK_DELAY_MS` (2.5 s) with no hit, the **cloud snapshot fallback** captures a 0.85-quality JPEG (≤1/s, one in flight, AbortController) and posts to Node `/api/qr/decode`. First valid `FG-…` ref wins and stops everything; manual entry always available.
>
> ## 5. Pi Camera Module 3 automatic flow
> GateVerification source = Pi → capture a fresh `/snapshot` bitmap → JPEG → Node `/api/qr/decode` → FastAPI OpenCV decode (decoder `pi-camera-cloud`) → candidate ref → existing authoritative `POST /api/bookings/gate-verification`. If the Pi is unreachable it fast-fails (cooldown, no timeout wait) and reverts to the webcam. Facial pages keep Pi-primary `/snapshot` capture with automatic webcam fallback.
>
> ## 6. Facial-recognition flows (unchanged algorithm)
> InsightFace stays in FastAPI; the browser/Pi only captures frames (Node proxy in between — never FastAPI directly). **Automatic:** Pi-preferred, webcam fallback, tracking→lock→liveness→final same-ID confirm. **Manual:** FaceEnrollment (Pi/webcam/**upload**, three-angle, per-angle retry); GateScanner gains **Scan Now** + **Reset**; VPatrol gains **Stop/Resume Monitoring** + **Run Single Check** and a **source label in patrol logs**. No client-side access grant.
>
> ## 7. Smart Logistics flows
> **Automatic:** Pi snapshot→cloud, or webcam BarcodeDetector/ZXing→cloud. **Manual:** typed ref + plate, manual image capture/retake, simulated LPR (clearly labelled), audited FM override (mandatory reason) — all preserved. QR scanning stops before plate OCR (no dual streams).
>
> ## 8. QR local + cloud fallback sequence
> `BarcodeDetector` → `ZXing` → (2.5 s) `opencv-cloud` snapshot → manual entry. Throttled ≤1 upload/s, single in-flight request, abortable, local scanning continues, whichever valid decoder returns first wins, everything stops on success/stop/unmount. No continuous frame streaming to Cloud Run.
>
> ## 9. Performance measurements added
> `onMetrics`/`logQrTimings` capture camera-startup, first-frame, local-decode, cloud-decode, and decoder source; backend verify is measured separately. A debug panel shows them when `VITE_CAMERA_DEBUG=true`. A repeatable **≥20-attempt procedure** with a blank results table is in `docs/Tan Xiu Li, Felicia/qr-scan-performance-test-procedure.md` — **no percentages are claimed** (targets only, to be filled after real runs).
>
> ## 10. Tests run — exact results
> | Suite | Command | Result |
> |---|---|---|
> | Client (Vitest, Felicia) | `npx vitest run "Tan Xiu Li"` | **481 passed / 4 failed** (485) |
> | Server (Jest, Felicia) | `npx jest "Tan Xiu Li, Felicia" --runInBand --forceExit` | **293 passed / 0 failed** (24 suites) |
> | AI QR (pytest) | `.venv/Scripts/python -m pytest test/test_qr_endpoint.py` | **11 passed** (incl. real end-to-end QR) |
> | AI track (pytest, cwd=ai-service) | `... test/test_track_endpoint.py` | **6 passed** |
> | Client build | `npm run build` | ✅ 690 modules |
> | Lint (my files) | `eslint …` | new files clean; **net −1 error vs HEAD** (no new issues) |
> | pip check | `.venv/Scripts/python -m pip check` | ✅ No broken requirements |
>
> New tests: 34 client + 8 server + 11 AI. All my new tests pass.
>
> ## 11. Pre-existing test failures (NOT introduced by me — verified against HEAD)
> - `ScanControl.test.jsx` (×2) and `ScannerPerformance.test.jsx` (×1): assert `CAPTURE_MAX_WIDTH` 320–360 and JPEG quality 0.55–0.70, but `scanControl.js` ships **512 / 0.74** — I never touched that file (`git diff HEAD` = unchanged).
> - `UserManagement.test.jsx`: `(You)` self-tag layout — untouched source.
>
> These are the documented baseline failures.
>
> ## 12. Remaining limitations
> - Cloud/Pi QR decode adds a network round-trip; still bounded by Cloud Run cold starts (handled non-blockingly).
> - OCR plate reading remains PoC Tesseract.js; barrier opening is simulated.
> - `CAMERA_STATUS_MESSAGES` constant strings ("Pi Gate Camera connected") kept as-is (pinned by `PiCamera.test`); the user-facing **buttons** are standardized to "Raspberry Pi Camera Module 3".
> - The AI `.venv` was only partially provisioned; I installed test deps to run pytest. No browser end-to-end run (those pages need a live Node+DB+FastAPI stack, which hangs per project notes) — coverage is via render/unit tests instead.
>
> ## 13. Required environment variables (added to `.env.example` only — no secrets)
> - **client:** `VITE_ENABLE_PI_CAMERA`, `VITE_ENABLE_CLOUD_QR_FALLBACK`, `VITE_QR_CLOUD_FALLBACK_DELAY_MS`, `VITE_CAMERA_DEBUG` (plus existing `VITE_PI_CAMERA_*`, `VITE_API_BASE_URL`).
> - **ai-service:** `QR_MAX_IMAGE_BYTES`, `QR_ALLOWED_CONTENT_TYPES` (plus existing `AI_SERVICE_KEY`).
> - **server:** none new — the QR proxy reuses `FACE_AI_URL` + `AI_SERVICE_KEY`.
>
> ## 14. Cloud deployment steps
> 1. FastAPI: `pip install -r ai-service/requirements.txt` (already pins `opencv-python-headless==4.13.0.92`); deploy `/api/qr/decode` with `AI_SERVICE_KEY` set; optionally set `QR_MAX_IMAGE_BYTES`/`QR_ALLOWED_CONTENT_TYPES`.
> 2. Node: set `FACE_AI_URL` → deployed FastAPI, `AI_SERVICE_KEY` matching; `/api/qr` mounts automatically.
> 3. Client build: **leave `VITE_PI_CAMERA_*` unset** (deployed browsers can't reach a private LAN Pi → auto webcam); set `VITE_API_BASE_URL`; keep `VITE_ENABLE_CLOUD_QR_FALLBACK=true`.
> 4. Never commit `.env`, keys, captured images, the venv, or model caches (all gitignored / verified absent from the change set).
>
> ## 15. Recommended commit message
> ```
> feat(camera): add resilient Pi and webcam AI workflows
> ```
>
> Nothing has been committed — the working tree holds the changes for your review. Want me to commit them on this branch (`feature/facial-smart-logistics`), or adjust any part first?

**Outcome:** A final response was recorded in the source session.
