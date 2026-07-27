// Browser camera + QR helpers for the Gate Verification page.
//
// All camera access is user-initiated (the page only calls these after the FM
// presses a button) and every start returns a stop() that releases the camera
// tracks. @zxing/browser is loaded via dynamic import so it stays out of the
// initial app bundle. QR frames are never stored — decoding is live-only.

// FlowGuard booking references look like "FG-XXXXXX" (genRef → FG + 6 hex chars).
// Accept FG- followed by 4–12 alphanumerics; reject arbitrary QR text.
const BOOKING_REF_RE = /^FG-[A-Z0-9]{4,12}$/;

export function normalizeBookingRef(raw) {
  return String(raw ?? '').trim().toUpperCase();
}

export function isValidBookingRef(raw) {
  return BOOKING_REF_RE.test(normalizeBookingRef(raw));
}

// getUserMedia requires a secure context (HTTPS) — localhost is treated as secure.
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

const FRIENDLY = {
  insecure: 'Camera requires a secure (HTTPS) connection. Use HTTPS or localhost, or switch to manual verification.',
  unsupported: 'This browser does not support camera access. Please use a modern browser or manual verification.',
  permission: 'Camera permission was denied. Allow camera access or switch to manual verification.',
  'no-camera': 'No camera was found on this device. Please use manual verification.',
  unknown: 'The camera could not be started. Please try again or use manual verification.',
};

export function cameraErrorMessage(code) {
  return FRIENDLY[code] || FRIENDLY.unknown;
}

function makeError(code) {
  const err = new Error(cameraErrorMessage(code));
  err.code = code;
  return err;
}

function mapGetUserMediaError(e) {
  const name = e?.name || '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') return makeError('permission');
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return makeError('no-camera');
  return makeError('unknown');
}

function stopTracks(videoElement, stream) {
  const src = stream || videoElement?.srcObject;
  if (src && typeof src.getTracks === 'function') {
    src.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
  }
  if (videoElement) {
    try { videoElement.srcObject = null; } catch { /* ignore */ }
  }
}

// Prefer the rear/environment camera; fall back to any camera.
const REAR_CONSTRAINTS = { video: { facingMode: { ideal: 'environment' } }, audio: false };

// Start a plain live-preview camera (used by the PoC plate-capture step).
// Throws a coded Error (code: insecure | unsupported | permission | no-camera | unknown).
export async function startCamera(videoElement) {
  if (!isSecureCameraContext()) throw makeError('insecure');
  if (!isCameraSupported()) throw makeError('unsupported');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(REAR_CONSTRAINTS);
  } catch (e) {
    throw mapGetUserMediaError(e);
  }
  if (videoElement) {
    videoElement.srcObject = stream;
    try { await videoElement.play?.(); } catch { /* autoplay quirks are non-fatal */ }
  }
  return { stop: () => stopTracks(videoElement, stream) };
}

// Start live QR decoding on a <video>. Calls onResult(text) on a decode and
// onError({ code, message }) on a start failure. Returns a stop() function that
// releases the camera. Per-frame "not found" scans are ignored (normal).
export async function startQrScan({ videoElement, onResult, onError }) {
  if (!isSecureCameraContext()) { onError?.({ code: 'insecure', message: cameraErrorMessage('insecure') }); return () => {}; }
  if (!isCameraSupported()) { onError?.({ code: 'unsupported', message: cameraErrorMessage('unsupported') }); return () => {}; }

  let controls;
  let stopped = false;
  try {
    const { BrowserQRCodeReader } = await import('@zxing/browser');
    const reader = new BrowserQRCodeReader();
    controls = await reader.decodeFromConstraints(REAR_CONSTRAINTS, videoElement, (result) => {
      if (stopped || !result) return;
      const text = typeof result.getText === 'function' ? result.getText() : String(result.text ?? result);
      onResult?.(text);
    });
  } catch (e) {
    const mapped = mapGetUserMediaError(e);
    onError?.({ code: mapped.code, message: mapped.message });
    return () => {};
  }

  return () => {
    stopped = true;
    try { controls?.stop(); } catch { /* ignore */ }
    stopTracks(videoElement);
  };
}
