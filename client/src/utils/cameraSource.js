// Unified camera-source abstraction shared by the Facial-Recognition and
// Smart-Logistics camera workflows.
//
// It layers on top of constants/piCamera.js (Raspberry Pi Camera Module 3
// probe / snapshot / cooldown) and adds the parts every scanner page needs in
// the same shape:
//   - a single vocabulary of sources (pi / webcam / upload / manual) and states
//   - consistent user-facing source labels and fallback-reason wording
//   - standardised laptop-webcam constraints (treated as PREFERENCES)
//   - a start/stop helper that releases MediaStream tracks and logs the ACTUAL
//     negotiated track settings in development
//
// Nothing here writes a captured frame to disk, localStorage or network
// storage — every capture is in-memory and released by the returned stop().
// The deployed JavaScript may reach a private Pi directly from a hotspot-connected
// browser after local-network permission is granted. The Pi is only preferred when
// a URL is explicitly configured (see isPiConfigured); otherwise callers go straight
// to the laptop webcam without waiting on a Pi timeout.

import {
  PI_CAMERA_STREAM_URL,
  PI_CAMERA_SNAPSHOT_URL,
  PI_CAMERA_HEALTH_URL,
  PI_CONNECTION_STATUS,
  PI_CONFIG_SOURCE,
  CAMERA_SOURCES,
  CAMERA_STATUS_MESSAGES,
  getResolvedPiCameraConfig,
  probePiCamera,
  testPiCameraConnection,
  isPiCameraReachable,
  isPiCameraReachableCached,
  getLastPiProbeResult,
  isPiInCooldown,
  markPiUnavailable,
  resetPiAvailabilityCache,
  fetchPiSnapshotBitmap,
  validatePiCameraBaseUrl,
  normalizePiCameraBaseUrl,
  derivePiCameraUrls,
  readRuntimePiCameraBaseUrl,
  saveRuntimePiCameraBaseUrl,
  clearRuntimePiCameraBaseUrl,
} from '../constants/piCamera';

// Re-export the existing Pi helpers so pages can import everything
// camera-related from one module. (constants/piCamera.js stays the low-level
// Pi layer; this file is the unified layer new code imports.)
export {
  PI_CAMERA_STREAM_URL,
  PI_CAMERA_SNAPSHOT_URL,
  PI_CAMERA_HEALTH_URL,
  PI_CONNECTION_STATUS,
  PI_CONFIG_SOURCE,
  CAMERA_SOURCES,
  CAMERA_STATUS_MESSAGES,
  getResolvedPiCameraConfig,
  probePiCamera,
  testPiCameraConnection,
  isPiCameraReachable,
  isPiCameraReachableCached,
  getLastPiProbeResult,
  isPiInCooldown,
  markPiUnavailable,
  resetPiAvailabilityCache,
  fetchPiSnapshotBitmap,
  validatePiCameraBaseUrl,
  normalizePiCameraBaseUrl,
  derivePiCameraUrls,
  readRuntimePiCameraBaseUrl,
  saveRuntimePiCameraBaseUrl,
  clearRuntimePiCameraBaseUrl,
};

// The four kinds of frame source a workflow can draw from. `pi` and `webcam`
// are live cameras; `upload` is a still chosen by the user; `manual` is typed
// data (booking ref / plate) with no image at all.
export const CAMERA_SOURCE = Object.freeze({
  PI: 'pi',
  WEBCAM: 'webcam',
  UPLOAD: 'upload',
  MANUAL: 'manual',
});

// Lifecycle a source moves through. Pages keep their own state variable; this
// is the shared vocabulary so every page names the states the same way.
export const SOURCE_STATE = Object.freeze({
  CHECKING: 'checking',            // probing whether the source is available
  AVAILABLE: 'available',          // reachable but not yet started
  UNAVAILABLE: 'unavailable',      // not configured or not reachable
  STARTING: 'starting',            // acquiring the stream
  ACTIVE: 'active',                // running as the chosen source
  STOPPED: 'stopped',              // cleanly released
  ERROR: 'error',                  // failed to start
  FALLBACK_ACTIVE: 'fallback-active', // running on the webcam after a Pi fallback
});

// One canonical label per source — used verbatim in the UI so wording never
// drifts between pages. The Raspberry Pi is always the full "Camera Module 3".
export const SOURCE_LABELS = Object.freeze({
  pi: 'Raspberry Pi Camera Module 3',
  webcam: 'Laptop Webcam',
  upload: 'Photo Upload',
  manual: 'Manual Entry',
  simulation: 'Simulation',
});

export function sourceLabel(source) {
  return SOURCE_LABELS[source] || 'Camera';
}

// Why a workflow fell back from its preferred source. Kept as machine codes so
// the UI maps them to its own copy (never shows a raw exception).
export const FALLBACK_REASON = Object.freeze({
  PI_NOT_CONFIGURED: 'pi-not-configured',
  PI_UNREACHABLE: 'pi-unreachable',
  LOCAL_NETWORK_PERMISSION_REQUIRED: 'local-network-permission-required',
  PERMISSION_DENIED: 'permission-denied',
  QR_TIMEOUT: 'qr-timeout',
  CLOUD_UNAVAILABLE: 'cloud-unavailable',
  NO_QR: 'no-qr',
  MANUAL_REQUIRED: 'manual-required',
});

export const FALLBACK_MESSAGES = Object.freeze({
  'pi-not-configured': 'Raspberry Pi Camera Module 3 is not configured — using the laptop webcam.',
  'pi-unreachable': 'Raspberry Pi Camera Module 3 is unreachable — using the laptop webcam.',
  'local-network-permission-required': 'Local-network permission is required to reach the Raspberry Pi Camera Module 3 — using the laptop webcam.',
  'permission-denied': 'Browser camera permission was denied. Allow the camera or use manual entry.',
  'qr-timeout': 'Local QR detection is taking longer than expected — trying a cloud-assisted scan.',
  'cloud-unavailable': 'The cloud decoder is warming up or unavailable — local scanning continues. Manual entry is available.',
  'no-qr': 'No valid FlowGuard QR code was detected. Try again or use manual entry.',
  'manual-required': 'Manual entry is required.',
});

export function fallbackMessage(reason) {
  return FALLBACK_MESSAGES[reason] || '';
}

// Canonical user-facing camera-source status lines, shared by every scanner page so
// the wording never drifts. These are the four states a gate scanner moves through
// while it decides between the Raspberry Pi Camera Module 3 and the laptop webcam.
export const CAMERA_STATUS = Object.freeze({
  CHECKING_PI: 'Checking Raspberry Pi Camera Module 3...',
  PI_CONNECTED: 'Pi Camera connected',
  PI_FALLBACK: 'Pi unreachable — Laptop Webcam fallback selected',
  PI_PERMISSION_REQUIRED: 'Local-network permission required — Laptop Webcam fallback selected',
  WEBCAM_SELECTED: 'Laptop Webcam selected — camera is off',
  WEBCAM_ACTIVE: 'Laptop Webcam active',
});

/**
 * True only when a Raspberry Pi Camera Module 3 is actually configured for this
 * build (a snapshot or stream URL is present and the source isn't disabled).
 * When false, callers must go straight to the laptop webcam WITHOUT probing or
 * awaiting a Pi timeout. Cloud Run is never part of this browser-to-Pi path.
 */
export function isPiConfigured() {
  return getResolvedPiCameraConfig().configured;
}

/**
 * Decide the PREFERRED camera source at page start.
 *
 * Source priority is Pi → webcam → upload/manual. When the Pi is not configured this
 * returns 'webcam' IMMEDIATELY with NO network probe (no Pi timeout wait). When the Pi
 * IS configured, the hotspot-connected browser's cooldown-aware reachability probe
 * decides: a recent failure short-circuits to 'webcam' without re-probing. Never throws.
 *
 * @returns {Promise<{source:'pi'|'webcam', reason:(string|null), probed:boolean}>}
 */
export async function resolvePreferredCameraSource(now = Date.now(), options = {}) {
  if (!isPiConfigured()) {
    return { source: CAMERA_SOURCE.WEBCAM, reason: FALLBACK_REASON.PI_NOT_CONFIGURED, probed: false };
  }
  const reachable = await isPiCameraReachableCached(now, options);
  const probeResult = getLastPiProbeResult();
  return reachable
    ? { source: CAMERA_SOURCE.PI, reason: null, probed: true }
    : {
        source: CAMERA_SOURCE.WEBCAM,
        reason: PI_CONNECTION_STATUS.PERMISSION_REQUIRED
          && probeResult?.status === PI_CONNECTION_STATUS.PERMISSION_REQUIRED
          ? FALLBACK_REASON.LOCAL_NETWORK_PERMISSION_REQUIRED
          : FALLBACK_REASON.PI_UNREACHABLE,
        probed: true,
      };
}

/**
 * Draw ONE fresh Raspberry Pi snapshot onto an in-memory canvas (for OCR / QR decode),
 * then RELEASE the ImageBitmap. The frame is never written to disk, localStorage or
 * any network store — it lives only as long as the returned canvas. Cache-busting is
 * handled inside fetchPiSnapshotBitmap (?t=…). Throws if the Pi snapshot cannot be
 * fetched, so the caller can fall back to the laptop webcam and show the reason.
 *
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function capturePiSnapshotCanvas(options) {
  const bitmap = await fetchPiSnapshotBitmap(options);
  return drawBitmapToCanvasAndClose(bitmap, document.createElement('canvas'));
}

/**
 * Draw an ImageBitmap into an in-memory canvas and always release the bitmap.
 * Callers may supply maxWidth for a scaled capture. This helper deliberately
 * owns closing the bitmap so draw/canvas failures cannot leak native resources.
 */
export function drawBitmapToCanvasAndClose(bitmap, canvas, { maxWidth } = {}) {
  try {
    const scale = maxWidth ? Math.min(1, maxWidth / bitmap.width) : 1;
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    try { bitmap.close?.(); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Webcam constraints. Treated as PREFERENCES: if the device cannot supply the
// ideal mode the browser negotiates the closest supported one rather than
// failing. QR wants a sharp rear/environment feed; face wants the front camera.
// ---------------------------------------------------------------------------
export const QR_WEBCAM_CONSTRAINTS = Object.freeze({
  video: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30, max: 30 },
    facingMode: { ideal: 'environment' },
  },
  audio: false,
});

export const FACE_WEBCAM_CONSTRAINTS = Object.freeze({
  video: {
    width: { ideal: 640 },
    height: { ideal: 480 },
    frameRate: { ideal: 15, max: 20 },
    facingMode: 'user',
  },
  audio: false,
});

// getUserMedia requires a secure context (HTTPS); localhost is treated secure.
export function isSecureCameraContext() {
  if (typeof window === 'undefined') return false;
  if (window.isSecureContext === true) return true;
  const host = window.location?.hostname || '';
  return host === 'localhost' || host === '127.0.0.1';
}

export function isCameraSupported() {
  return typeof navigator !== 'undefined'
    && !!navigator.mediaDevices
    && typeof navigator.mediaDevices.getUserMedia === 'function';
}

const CAMERA_ERROR_MESSAGES = Object.freeze({
  insecure: 'Camera requires a secure (HTTPS) connection. Use HTTPS or localhost, or switch to manual entry.',
  unsupported: 'This browser does not support camera access. Please use a modern browser or manual entry.',
  permission: 'Camera permission was denied. Allow camera access or switch to manual entry.',
  'no-camera': 'No camera was found on this device. Please use manual entry.',
  'in-use': 'Camera is already in use. Close other apps or tabs using it, then try again.',
  unknown: 'The camera could not be started. Please try again or use manual entry.',
});

export function cameraErrorMessage(code) {
  return CAMERA_ERROR_MESSAGES[code] || CAMERA_ERROR_MESSAGES.unknown;
}

export function makeCameraError(code) {
  const err = new Error(cameraErrorMessage(code));
  err.code = code;
  return err;
}

export function mapGetUserMediaError(e) {
  const name = e?.name || '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return makeCameraError('permission');
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return makeCameraError('no-camera');
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return makeCameraError('in-use');
  }
  return makeCameraError('unknown');
}

/**
 * Stop every track on a stream (or on the element's srcObject) and detach it
 * from the <video>. Safe to call repeatedly; never throws. Always call this
 * before switching sources so the previous camera light goes off.
 */
export function stopStream(videoElement, stream) {
  const src = stream || videoElement?.srcObject;
  if (src && typeof src.getTracks === 'function') {
    src.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
  }
  if (videoElement) {
    try { videoElement.srcObject = null; } catch { /* ignore */ }
  }
}

/**
 * Log the ACTUAL negotiated MediaStreamTrack settings (resolution / frame
 * rate / facing mode) in development only. Diagnostic durations/sizes ONLY —
 * never image or biometric data. No-op in production builds.
 */
export function logTrackSettings(stream, label = 'webcam') {
  if (!import.meta.env?.DEV) return;
  try {
    const track = stream?.getVideoTracks?.()[0];
    const s = track?.getSettings?.() || {};
    console.debug(
      `[camera ${label}] ${s.width ?? '?'}x${s.height ?? '?'} @ ${s.frameRate ?? '?'}fps `
      + `facing=${s.facingMode ?? 'n/a'}`
    );
  } catch { /* diagnostics are best-effort */ }
}

/**
 * Start a laptop-webcam MediaStream with standardised (preference) constraints,
 * attach it to the given <video>, and return handles to it.
 *
 * Throws a coded Error (code: insecure | unsupported | permission | no-camera |
 * in-use | unknown) so the caller can show friendly copy and keep manual entry open.
 *
 * @returns {Promise<{ stream: MediaStream, stop: () => void, settings: object }>}
 */
export async function startWebcamStream(videoElement, constraints = QR_WEBCAM_CONSTRAINTS, { signal } = {}) {
  if (!isSecureCameraContext()) throw makeCameraError('insecure');
  if (!isCameraSupported()) throw makeCameraError('unsupported');

  const cancelled = () => {
    const err = new Error('Camera start cancelled.');
    err.code = 'aborted';
    return err;
  };
  if (signal?.aborted) throw cancelled();

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (e) {
    throw mapGetUserMediaError(e);
  }

  // getUserMedia itself is not abortable. If the page changed source or
  // unmounted while the permission prompt was open, release the late stream
  // before it can be attached to the video element.
  if (signal?.aborted) {
    stopStream(null, stream);
    throw cancelled();
  }

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    signal?.removeEventListener?.('abort', stop);
    stopStream(videoElement, stream);
  };
  signal?.addEventListener?.('abort', stop, { once: true });

  if (videoElement) {
    videoElement.srcObject = stream;
    try { await videoElement.play?.(); } catch { /* autoplay quirks are non-fatal */ }
  }

  logTrackSettings(stream, 'webcam');
  const settings = stream.getVideoTracks?.()[0]?.getSettings?.() || {};
  return {
    stream,
    stop,
    settings,
  };
}
