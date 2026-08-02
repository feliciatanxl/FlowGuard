// Browser camera + QR helpers for the Gate Verification page.
//
// Decoding order (fastest practical path first):
//   1. Native browser BarcodeDetector (qr_code) when supported
//   2. @zxing/browser BrowserQRCodeReader as the compatibility fallback
//   3. Cloud OpenCV snapshot decode after a local timeout (Phase 5, via the
//      onCloudDecode callback the page supplies — it POSTs a still to the Node
//      /api/qr/decode proxy; this module never calls FastAPI directly)
//   4. Manual booking-reference entry (handled by the page)
//
// We deliberately use BrowserQRCodeReader (NOT BrowserMultiFormatReader) —
// FlowGuard only needs QR. @zxing/browser is dynamically imported so it stays
// out of the initial bundle, and preloadQrScanner() warms it while the page
// loads so pressing "Start Scanner" doesn't wait on a download.
//
// All camera access is user-initiated and every start returns a stop() that
// releases the camera tracks and cancels timers / in-flight cloud requests. QR
// frames are never stored — decoding is live-only and captures are in-memory.

import {
  isSecureCameraContext,
  isCameraSupported,
  cameraErrorMessage,
  mapGetUserMediaError,
  startWebcamStream,
  stopStream,
  QR_WEBCAM_CONSTRAINTS,
  logTrackSettings,
} from './cameraSource';

// Re-export the shared context/support/error helpers so existing imports from
// '../utils/gateCamera' keep working unchanged (the pages and tests import
// these names from here).
export { isSecureCameraContext, isCameraSupported, cameraErrorMessage };

// FlowGuard booking references look like "FG-XXXXXX" (genRef → FG + 6 hex chars).
// Accept FG- followed by 4–12 alphanumerics; reject arbitrary QR text.
const BOOKING_REF_RE = /^FG-[A-Z0-9]{4,12}$/;

export function normalizeBookingRef(raw) {
  return String(raw ?? '').trim().toUpperCase();
}

export function isValidBookingRef(raw) {
  return BOOKING_REF_RE.test(normalizeBookingRef(raw));
}

// User-facing scanner states (the page maps these to inline status copy).
export const SCANNER_STATE = Object.freeze({
  LOADING: 'loading-scanner',          // Loading scanner…
  STARTING: 'starting-camera',         // Starting camera…
  CAMERA_READY: 'camera-ready',        // Camera ready
  LOOKING: 'looking',                  // Looking for QR…
  QR_DETECTED: 'qr-detected',          // QR detected
  VERIFYING: 'verifying',              // Verifying booking…
  VERIFIED: 'verified',                // Booking verified
  DENIED: 'denied',                    // Booking denied
  SLOW: 'local-slow',                  // Local scan taking longer than expected
  CLOUD: 'cloud-trying',               // Trying cloud-assisted scan…
  MANUAL: 'manual-available',          // Manual entry available
  PERMISSION_DENIED: 'permission-denied', // Camera permission denied
  UNAVAILABLE: 'camera-unavailable',   // Camera unavailable
});

// Which decoder produced a result (for timing metrics / diagnostics).
export const DECODER_SOURCE = Object.freeze({
  BARCODE_DETECTOR: 'barcode-detector-browser',
  ZXING: 'zxing-browser',
  OPENCV_CLOUD: 'opencv-cloud',
  PI_CAMERA_CLOUD: 'pi-camera-cloud',
  MANUAL: 'manual-entry',
});

// How long the local scanner runs before the cloud snapshot fallback activates.
export const DEFAULT_CLOUD_FALLBACK_DELAY_MS = 2500;
// Never upload more than ~1 cloud snapshot per second.
export const CLOUD_SNAPSHOT_MIN_INTERVAL_MS = 1000;
// Local BarcodeDetector cadence (one detect in flight at a time).
const BARCODE_SCAN_INTERVAL_MS = 120;

// True when the native BarcodeDetector API can decode QR codes in this browser.
export function isBarcodeDetectorSupported() {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window;
}

// Module-level cache so the zxing reader is created ONCE and reused across
// starts (never recreated on every render). Also caches the last camera
// deviceId so re-starts reuse the same camera without re-prompting.
let zxingModulePromise = null;
let barcodeDetectorSupported = null;
let lastDeviceId = null;

/**
 * Warm the QR scanner while the page loads: probe BarcodeDetector support and
 * begin downloading @zxing/browser so the first "Start Scanner" is instant.
 * Safe to call multiple times — the import promise is cached. Never throws.
 */
export function preloadQrScanner() {
  if (barcodeDetectorSupported === null) {
    barcodeDetectorSupported = isBarcodeDetectorSupported();
  }
  // Only bother downloading zxing if we might actually need the fallback.
  if (!zxingModulePromise) {
    zxingModulePromise = import('@zxing/browser').catch((e) => {
      zxingModulePromise = null; // allow a later retry
      throw e;
    });
  }
  // Swallow rejection here so an eager preload never surfaces an unhandled
  // rejection; startQrScan re-imports (cached) and handles errors there.
  return zxingModulePromise.then(() => true).catch(() => false);
}

function getZxingModule() {
  if (!zxingModulePromise) {
    zxingModulePromise = import('@zxing/browser');
  }
  return zxingModulePromise;
}

/**
 * Draw the current video frame to an offscreen canvas and return a compressed
 * JPEG data URL — the still uploaded to the cloud decoder. Bounded width keeps
 * the payload small while preserving enough detail for QR decoding. In-memory
 * only; the canvas is discarded when this returns.
 */
export function captureVideoFrameJpeg(videoElement, { maxWidth = 1024, quality = 0.85 } = {}) {
  if (!videoElement || !videoElement.videoWidth) return null;
  const scale = Math.min(1, maxWidth / videoElement.videoWidth);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(videoElement.videoWidth * scale);
  canvas.height = Math.round(videoElement.videoHeight * scale);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

// Dev-only QR timing telemetry: durations + decoder source ONLY — never image
// data. No-op in production builds.
export function logQrTimings(metrics) {
  if (!import.meta.env?.DEV) return;
  const parts = [
    metrics.cameraStartupMs != null ? `camera-start ${metrics.cameraStartupMs}ms` : null,
    metrics.firstFrameMs != null ? `first-frame ${metrics.firstFrameMs}ms` : null,
    metrics.localDecodeMs != null ? `local-decode ${metrics.localDecodeMs}ms` : null,
    metrics.cloudDecodeMs != null ? `cloud-decode ${metrics.cloudDecodeMs}ms` : null,
    metrics.decoder ? `via ${metrics.decoder}` : null,
  ].filter(Boolean);
  if (parts.length) console.debug(`[qr timing] ${parts.join(' | ')}`);
}

// Start a plain live-preview camera (used by the PoC plate-capture step).
// Throws a coded Error (code: insecure | unsupported | permission | no-camera |
// unknown). Returns { stop } to release the camera.
export async function startCamera(videoElement, { signal } = {}) {
  const { stop } = await startWebcamStream(videoElement, QR_WEBCAM_CONSTRAINTS, { signal });
  return { stop };
}

/**
 * Start live QR decoding on a <video>.
 *
 * @param {object}   opts
 * @param {HTMLVideoElement} opts.videoElement
 * @param {(text:string, meta?:object)=>void} opts.onResult  raw decoded text (page validates)
 * @param {(err:{code,message})=>void} [opts.onError]        start failure
 * @param {(state:string)=>void} [opts.onState]              SCANNER_STATE updates
 * @param {(metrics:object)=>void} [opts.onMetrics]          timing metrics
 * @param {boolean} [opts.enableCloud=false]                 activate cloud snapshot fallback
 * @param {number}  [opts.cloudFallbackDelayMs]              delay before cloud kicks in
 * @param {(dataUrl:string)=>Promise<string|null>} [opts.onCloudDecode]
 *        page-supplied: uploads the still to the Node /api/qr/decode proxy and
 *        resolves to a candidate booking ref (or null). This module never calls
 *        the AI service directly.
 * @returns {() => void} stop — releases the camera and cancels all timers/requests.
 */
export async function startQrScan({
  videoElement,
  onResult,
  onError,
  onState,
  onMetrics,
  enableCloud = false,
  cloudFallbackDelayMs = DEFAULT_CLOUD_FALLBACK_DELAY_MS,
  onCloudDecode,
  signal,
} = {}) {
  const state = (s) => {
    if (signal?.aborted) return;
    try { onState?.(s); } catch { /* ignore */ }
  };

  if (!isSecureCameraContext()) {
    onError?.({ code: 'insecure', message: cameraErrorMessage('insecure') });
    state(SCANNER_STATE.UNAVAILABLE);
    return () => {};
  }
  if (!isCameraSupported()) {
    onError?.({ code: 'unsupported', message: cameraErrorMessage('unsupported') });
    state(SCANNER_STATE.UNAVAILABLE);
    return () => {};
  }

  let stopped = false;
  let scanTimer = null;
  let cloudTimer = null;
  let cloudStartTimer = null;
  let cloudInFlight = false;
  let lastCloudAt = 0;
  let cloudController = null;
  let zxingControls = null;
  let ownStream = null;           // stream we created (BarcodeDetector path)
  let lastDelivered = null;       // dedup identical consecutive decodes
  let firstFrameLogged = false;
  const startedAt = Date.now();
  const metrics = { decoder: null };

  // Deliver a raw decode to the page (which validates + decides). Dedups
  // identical consecutive texts so an invalid QR sitting in frame doesn't spam
  // onResult every frame. A valid ref stops all scanning immediately.
  const deliver = (text, decoder) => {
    if (stopped || !text) return;
    if (text === lastDelivered && !isValidBookingRef(text)) return; // repeat invalid → ignore
    lastDelivered = text;
    if (isValidBookingRef(text)) {
      metrics.decoder = decoder;
      metrics.localDecodeMs = decoder === DECODER_SOURCE.OPENCV_CLOUD
        || decoder === DECODER_SOURCE.PI_CAMERA_CLOUD ? undefined : Date.now() - startedAt;
      state(SCANNER_STATE.QR_DETECTED);
      logQrTimings(metrics);
      onMetrics?.({ ...metrics });
      cleanup(); // first valid wins — stop local + cloud before handing back
    }
    onResult?.(text, { decoder });
  };

  // ---- Cloud snapshot fallback (Phase 5) --------------------------------
  const runCloudSnapshot = async () => {
    if (stopped || cloudInFlight || !onCloudDecode) return;
    const now = Date.now();
    if (now - lastCloudAt < CLOUD_SNAPSHOT_MIN_INTERVAL_MS) return; // ≤1/sec
    const dataUrl = captureVideoFrameJpeg(videoElement, { maxWidth: 1024, quality: 0.85 });
    if (!dataUrl) return;
    cloudInFlight = true;
    lastCloudAt = now;
    cloudController = new AbortController();
    const t0 = Date.now();
    try {
      state(SCANNER_STATE.CLOUD);
      const candidate = await onCloudDecode(dataUrl, cloudController.signal);
      if (stopped) return;
      if (candidate && isValidBookingRef(candidate)) {
        metrics.cloudDecodeMs = Date.now() - t0;
        deliver(normalizeBookingRef(candidate), DECODER_SOURCE.OPENCV_CLOUD);
      }
    } catch {
      // Cold/aborted/unavailable cloud is non-fatal — local scanning continues.
    } finally {
      cloudInFlight = false;
    }
  };

  const startCloudFallback = () => {
    if (!enableCloud || !onCloudDecode || cloudTimer || stopped) return;
    state(SCANNER_STATE.SLOW);
    // Poll on an interval; runCloudSnapshot self-throttles to ≤1/sec and keeps
    // only one request in flight.
    cloudTimer = setInterval(runCloudSnapshot, 400);
  };

  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
    if (cloudTimer) { clearInterval(cloudTimer); cloudTimer = null; }
    if (cloudStartTimer) { clearTimeout(cloudStartTimer); cloudStartTimer = null; }
    if (cloudController) { try { cloudController.abort(); } catch { /* ignore */ } }
    try { zxingControls?.stop(); } catch { /* ignore */ }
    // Release whichever stream is attached (ours or zxing's).
    stopStream(videoElement, ownStream);
    signal?.removeEventListener?.('abort', cleanup);
  };

  if (signal?.aborted) {
    cleanup();
    return cleanup;
  }
  signal?.addEventListener?.('abort', cleanup, { once: true });

  // ---- Local decoding ---------------------------------------------------
  const runBarcodeDetectorScan = async () => {
    state(SCANNER_STATE.STARTING);
    const camT0 = Date.now();
    const { stream } = await startWebcamStream(videoElement, QR_WEBCAM_CONSTRAINTS, { signal });
    ownStream = stream;
    lastDeviceId = stream.getVideoTracks?.()[0]?.getSettings?.().deviceId || lastDeviceId;
    metrics.cameraStartupMs = Date.now() - camT0;
    state(SCANNER_STATE.CAMERA_READY);

    const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    const tick = async () => {
      if (stopped) return;
      if (videoElement.videoWidth > 0 && !firstFrameLogged) {
        firstFrameLogged = true;
        metrics.firstFrameMs = Date.now() - startedAt;
        state(SCANNER_STATE.LOOKING);
      }
      try {
        const codes = await detector.detect(videoElement);
        if (!stopped && codes && codes.length) {
          deliver(String(codes[0].rawValue ?? ''), DECODER_SOURCE.BARCODE_DETECTOR);
        }
      } catch { /* detect() throws until the frame is ready — ignore */ }
      if (!stopped) scanTimer = setTimeout(tick, BARCODE_SCAN_INTERVAL_MS);
    };
    scanTimer = setTimeout(tick, BARCODE_SCAN_INTERVAL_MS);
    if (enableCloud) cloudStartTimer = setTimeout(startCloudFallback, cloudFallbackDelayMs);
  };

  const runZxingScan = async () => {
    state(SCANNER_STATE.STARTING);
    const camT0 = Date.now();
    const { BrowserQRCodeReader } = await getZxingModule();
    const reader = new BrowserQRCodeReader();
    zxingControls = await reader.decodeFromConstraints(QR_WEBCAM_CONSTRAINTS, videoElement, (result) => {
      if (stopped || !result) return;
      if (!firstFrameLogged) {
        firstFrameLogged = true;
        metrics.firstFrameMs = Date.now() - startedAt;
        state(SCANNER_STATE.LOOKING);
      }
      const text = typeof result.getText === 'function' ? result.getText() : String(result.text ?? result);
      deliver(text, DECODER_SOURCE.ZXING);
    });
    // If a valid QR decoded on the very first (synchronous) callback, cleanup()
    // already ran before controls existed — stop the reader we just got back.
    if (stopped || signal?.aborted) {
      try { zxingControls?.stop(); } catch { /* ignore */ }
      stopStream(videoElement);
      return;
    }
    metrics.cameraStartupMs = Date.now() - camT0;
    logTrackSettings(videoElement.srcObject, 'webcam-zxing');
    state(SCANNER_STATE.CAMERA_READY);
    if (enableCloud) cloudStartTimer = setTimeout(startCloudFallback, cloudFallbackDelayMs);
  };

  try {
    if (isBarcodeDetectorSupported()) {
      await runBarcodeDetectorScan();
    } else {
      await runZxingScan();
    }
  } catch (e) {
    if (signal?.aborted || e?.code === 'aborted') {
      cleanup();
      return cleanup;
    }
    const mapped = e?.code ? e : mapGetUserMediaError(e);
    onError?.({ code: mapped.code, message: mapped.message });
    state(mapped.code === 'permission' ? SCANNER_STATE.PERMISSION_DENIED : SCANNER_STATE.UNAVAILABLE);
    cleanup();
    return () => {};
  }

  return cleanup;
}
