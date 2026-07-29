# Smart Logistics QR Scan — Performance Test Procedure

Repeatable procedure for measuring the loading-bay QR scan pipeline
(GateVerification → local decode → cloud fallback → authoritative
verification). These are **project performance targets, not guaranteed
hardware claims**. Do not report a percentage until the runs below are actually
completed and the table is filled in.

## Performance targets (Phase 9)

Under good lighting with a clear ~360 px Driver Pass QR:

| Target | Value |
|---|---|
| Scanner UI ready | ≈ within 3 s of opening the page |
| QR detected (local) | ≈ within 2 s of camera focus |
| Local→cloud fallback begins | ≈ 2.5 s after start (`VITE_QR_CLOUD_FALLBACK_DELAY_MS`) |
| Duplicate booking-verification requests | 0 (exactly one verify per scan) |
| Total QR→decision (Cloud Run warm) | ≈ within 5 s |
| UI responsive during scanning | Yes (never frozen) |
| Manual entry | Always available |

Backend booking verification (`POST /api/bookings/gate-verification`) is
measured **separately** from decode.

## Where the numbers come from

The scanner records timing via `onMetrics` / `logQrTimings` in
`client/src/utils/gateCamera.js`:

- `cameraStartupMs` — getUserMedia → stream ready
- `firstFrameMs` — start → first usable video frame
- `localDecodeMs` — start → local (BarcodeDetector/ZXing) decode
- `cloudDecodeMs` — cloud snapshot request round-trip
- `decoder` — which path won: `barcode-detector-browser`, `zxing-browser`,
  `opencv-cloud`, `pi-camera-cloud`, or `manual-entry`

Enable the on-screen diagnostic panel with `VITE_CAMERA_DEBUG=true`; timings
also print to the dev console (`[qr timing] …`). Backend verify time comes from
the network panel timing of the `gate-verification` request.

## Procedure (≥ 20 attempts)

1. Deploy/serve the client over HTTPS or `localhost` (camera needs a secure
   context). Ensure the Node backend and FastAPI AI service are running and
   **warm** (send one throwaway `/api/qr/decode` first to avoid cold-start skew).
2. Generate a Driver Pass and display it at ~360 px (the default size). Record
   the display device and physical size.
3. Open **Logistics → Gate Verification**, Automatic tab, source = Laptop Webcam.
4. For each of ≥ 20 attempts:
   a. Note page-open time; start the scanner.
   b. Present the QR at a natural gate distance under the stated lighting.
   c. Record each metric from the diagnostic panel / console, the decoder that
      won, and the backend verify time.
   d. Mark success (valid ref decoded) or failure (timed out to manual entry).
   e. Reset (New Scan) between attempts.
5. Repeat a second block using source = Raspberry Pi Camera Module 3 (if a Pi is
   available) to capture the `pi-camera-cloud` path.
6. Optionally repeat one block in poor lighting to characterise degradation.

## Results (fill in after running — DO NOT pre-populate)

Environment: browser ____ · device ____ · lighting ____ · QR display size ____ px ·
Cloud Run warm? ____

| # | UI ready (ms) | Cam start (ms) | First frame (ms) | Local decode (ms) | Cloud decode (ms) | Backend verify (ms) | Total (ms) | Decoder | Result |
|---|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | | |
| … | | | | | | | | | |
| 20 | | | | | | | | | |

### Summary (compute from the table)

| Metric | Value |
|---|---|
| Successful scans | __ / __ |
| Failures (fell through to manual) | __ |
| Median decode time | __ ms |
| Max decode time | __ ms |
| % completed within 2 s | __ % |
| % completed within 5 s | __ % |
| Decoder mix | barcode-detector __ / zxing __ / opencv-cloud __ / pi-camera-cloud __ |

> Percentages above are placeholders until the 20-attempt runs are executed and
> recorded. This document intentionally ships without claimed results.
