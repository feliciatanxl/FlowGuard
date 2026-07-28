---
name: camera-qr-architecture
description: "Shared camera-source abstraction + resilient QR scanning (local BarcodeDetector/ZXing + cloud OpenCV fallback) across Felicia's modules"
metadata: 
  node_type: memory
  type: project
  originSessionId: aa5ecba9-ca40-498c-b6fa-30f2045ae503
  modified: 2026-07-28T07:30:53.105Z
---

Resilient Pi/webcam camera + QR workflows (added 2026-07-28, branch feature/facial-smart-logistics). Relates to [[flowguard-felicia-scope]], [[gate-verification-feature]], [[booking-time-contract]].

**Architecture:**
- `client/src/utils/cameraSource.js` — shared abstraction: `CAMERA_SOURCE` (pi/webcam/upload/manual), `SOURCE_STATE`, `SOURCE_LABELS` (Pi = "Raspberry Pi Camera Module 3"), `FALLBACK_REASON`/`fallbackMessage`, `QR_WEBCAM_CONSTRAINTS` (1280x720/30fps/environment, preferences), `FACE_WEBCAM_CONSTRAINTS`, `startWebcamStream`/`stopStream`/`logTrackSettings`, `isPiConfigured()` (gated by `VITE_ENABLE_PI_CAMERA` + URL). Re-exports the piCamera helpers. `constants/piCamera.js` stays the low-level Pi layer (UNCHANGED — PiCamera.test pins its `CAMERA_STATUS_MESSAGES` strings + URLs).
- `client/src/utils/gateCamera.js` — refactored scanner: BarcodeDetector-first → `@zxing/browser` `BrowserQRCodeReader` fallback (NOT MultiFormat), `preloadQrScanner()` (warms zxing on GateVerification mount, code-split async chunk), `SCANNER_STATE`/`DECODER_SOURCE`, timing metrics, dedup, cloud-fallback orchestration. **Kept exact export signatures** (`startQrScan({videoElement,onResult,onError,...})→stop`, `startCamera`, `isValidBookingRef`, etc.) — GateVerification.test mocks at this boundary. Helper fns must NOT be `use`-prefixed (react-hooks/rules-of-hooks).
- Cloud QR: browser → **Node** `POST /api/qr/decode` (`server/routes/qr.js`, FM-only, mounted in server/index.js) → **FastAPI** `POST /api/qr/decode` (`ai-service/main.py`, after `/refresh`, `require_service_key`, `cv2.QRCodeDetector`). Returns CANDIDATE bookingRef ONLY — never verifies/grants/writes GateAccessLog. Frontend never calls FastAPI directly. GateVerification default source=webcam (no auto-start); Pi source captures a snapshot → cloud decode.

**How to apply:**
- **Client tests use VITEST**, not jest: `cd client && npx vitest run <fileSubstring>`. (Server uses jest: `npx jest "Tan Xiu Li, Felicia" --runInBand --forceExit`.) Client tests live in `client/tests/Tan Xiu Li, Felicia/`, import source via `../../src/...`, mock camera/QR/OCR at the `utils/gateCamera`/`utils/plateOcr` boundary, stub `navigator.mediaDevices.getUserMedia` + `fetch`, axios default-object via `vi.hoisted`. No global setup file.
- AI tests: venv at `ai-service/.venv` ships torch/torchvision/numpy/pillow only — `pip install fastapi pydantic python-dotenv opencv-python-headless httpx pytest requests python-multipart` to run them. `main.py` does `import zone_rules`, so run pytest with **cwd=ai-service** (`cd ai-service && .venv/Scripts/python -m pytest test/...`) or add ai-service to sys.path (my `test_qr_endpoint.py` does the latter; the older `test_track_endpoint.py` does NOT and only collects from cwd=ai-service). cv2 4.13 has QRCodeDetector AND QRCodeEncoder.
- Baseline client failures (still, do NOT chase): ScanControl.test + ScannerPerformance.test (scanControl.js ships 512/0.74 vs asserted 320–360/0.55–0.70), UserManagement.test ('(You)' self-tag), and **CameraFeed.test.jsx** "retains analyze-frame behaviour for local mp4 sources" (test expects `{cam_id}` payload + Bearer token; component posts `{image, source}` with `Bearer null` — teammate's component/test drift, unrelated to security work). Full client vitest = 5 failed / 540 passed as of 2026-07-28. Env vars added to `.env.example` only: `VITE_ENABLE_PI_CAMERA`, `VITE_ENABLE_CLOUD_QR_FALLBACK`, `VITE_QR_CLOUD_FALLBACK_DELAY_MS`, `VITE_CAMERA_DEBUG`, `QR_MAX_IMAGE_BYTES`, `QR_ALLOWED_CONTENT_TYPES`. Node QR proxy reuses `FACE_AI_URL` + `AI_SERVICE_KEY`.
