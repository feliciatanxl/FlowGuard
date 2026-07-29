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
// A deployed browser can never reach a private Raspberry Pi LAN address, so the
// Pi is only ever *preferred* when a URL is explicitly configured (see
// isPiConfigured); otherwise callers go straight to the laptop webcam without
// waiting on a Pi timeout.

import {
  PI_CAMERA_STREAM_URL,
  PI_CAMERA_SNAPSHOT_URL,
  CAMERA_SOURCES,
  CAMERA_STATUS_MESSAGES,
  isPiCameraReachable,
  isPiCameraReachableCached,
  isPiInCooldown,
  markPiUnavailable,
  resetPiAvailabilityCache,
  fetchPiSnapshotBitmap,
} from '../constants/piCamera';

// Re-export the existing Pi helpers so pages can import everything
// camera-related from one module. (constants/piCamera.js stays the low-level
// Pi layer; this file is the unified layer new code imports.)
export {
  PI_CAMERA_STREAM_URL,
  PI_CAMERA_SNAPSHOT_URL,
  CAMERA_SOURCES,
  CAMERA_STATUS_MESSAGES,
  isPiCameraReachable,
  isPiCameraReachableCached,
  isPiInCooldown,
  markPiUnavailable,
  resetPiAvailabilityCache,
  fetchPiSnapshotBitmap,
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
  PERMISSION_DENIED: 'permission-denied',
  QR_TIMEOUT: 'qr-timeout',
  CLOUD_UNAVAILABLE: 'cloud-unavailable',
  NO_QR: 'no-qr',
  MANUAL_REQUIRED: 'manual-required',
});

export const FALLBACK_MESSAGES = Object.freeze({
  'pi-not-configured': 'Raspberry Pi Camera Module 3 is not configured — using the laptop webcam.',
  'pi-unreachable': 'Raspberry Pi Camera Module 3 is unreachable — using the laptop webcam.',
  'permission-denied': 'Browser camera permission was denied. Allow the camera or use manual entry.',
  'qr-timeout': 'Local QR detection is taking longer than expected — trying a cloud-assisted scan.',
  'cloud-unavailable': 'The cloud decoder is warming up or unavailable — local scanning continues. Manual entry is available.',
  'no-qr': 'No valid FlowGuard QR code was detected. Try again or use manual entry.',
  'manual-required': 'Manual entry is required.',
});

export function fallbackMessage(reason) {
  return FALLBACK_MESSAGES[reason] || '';
}

// A Vite env flag that lets a deployment turn the Pi source off entirely, even
// if a URL leaked into the build. Explicit "false" disables it; anything else
// leaves the URL to decide.
const PI_EXPLICITLY_DISABLED =
  String(import.meta.env?.VITE_ENABLE_PI_CAMERA ?? '').toLowerCase() === 'false';

/**
 * True only when a Raspberry Pi Camera Module 3 is actually configured for this
 * build (a snapshot or stream URL is present and the source isn't disabled).
 * When false, callers must go straight to the laptop webcam WITHOUT probing or
 * awaiting a Pi timeout — a deployed browser cannot reach a private LAN Pi.
 */
export function isPiConfigured() {
  if (PI_EXPLICITLY_DISABLED) return false;
  return Boolean(PI_CAMERA_SNAPSHOT_URL || PI_CAMERA_STREAM_URL);
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
 * unknown) so the caller can show friendly copy and keep manual entry open.
 *
 * @returns {Promise<{ stream: MediaStream, stop: () => void, settings: object }>}
 */
export async function startWebcamStream(videoElement, constraints = QR_WEBCAM_CONSTRAINTS) {
  if (!isSecureCameraContext()) throw makeCameraError('insecure');
  if (!isCameraSupported()) throw makeCameraError('unsupported');

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (e) {
    throw mapGetUserMediaError(e);
  }

  if (videoElement) {
    videoElement.srcObject = stream;
    try { await videoElement.play?.(); } catch { /* autoplay quirks are non-fatal */ }
  }

  logTrackSettings(stream, 'webcam');
  const settings = stream.getVideoTracks?.()[0]?.getSettings?.() || {};
  return {
    stream,
    stop: () => stopStream(videoElement, stream),
    settings,
  };
}
