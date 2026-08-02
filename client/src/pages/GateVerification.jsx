import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import axios from 'axios';
import Sidebar from '../components/Sidebar';
import { API_BASE_URL } from '../constants/api';
import { ROLES } from '../constants/roles';
import { normalizePlate } from '../utils/plate';
import {
  isValidBookingRef, normalizeBookingRef,
  isSecureCameraContext, isCameraSupported, cameraErrorMessage,
  startQrScan, startCamera, preloadQrScanner,
  SCANNER_STATE, DECODER_SOURCE,
} from '../utils/gateCamera';
import {
  CAMERA_SOURCE, SOURCE_LABELS, sourceLabel, isPiConfigured,
  markPiUnavailable, fallbackMessage, FALLBACK_REASON,
  CAMERA_STATUS, resolvePreferredCameraSource, fetchPiSnapshotBitmap,
  PI_CAMERA_STREAM_URL, stopStream, drawBitmapToCanvasAndClose,
} from '../utils/cameraSource';
import { recognizePlate } from '../utils/plateOcr';
import { formatSingaporeBookingDateTime } from '../constants/datetime';
import '../css/Dashboard.css';
import '../css/Booking.css';
import '../css/GateVerification.css';

// Cloud QR snapshot fallback config (Phase 5) — all optional Vite env, safe
// defaults. Cloud decode goes through the Node /api/qr/decode proxy; it only
// ever yields a CANDIDATE reference (gate-verification stays authoritative).
const CLOUD_QR_ENABLED =
  String(import.meta.env?.VITE_ENABLE_CLOUD_QR_FALLBACK ?? '').toLowerCase() !== 'false';
const CLOUD_QR_DELAY_MS = Number(import.meta.env?.VITE_QR_CLOUD_FALLBACK_DELAY_MS) || 2500;
const CAMERA_DEBUG = String(import.meta.env?.VITE_CAMERA_DEBUG ?? '').toLowerCase() === 'true';

// Scanner service states → short inline status copy (Phase 2 scanner states).
const SCANNER_STATE_TEXT = {
  'loading-scanner': 'Loading scanner…',
  'starting-camera': 'Starting camera…',
  'camera-ready': 'Camera ready',
  'looking': 'Looking for QR…',
  'qr-detected': 'QR detected',
  'local-slow': 'Local scan taking longer than expected…',
  'cloud-trying': 'Trying cloud-assisted scan…',
  'manual-available': 'Manual entry available',
  'permission-denied': 'Camera permission denied',
  'camera-unavailable': 'Camera unavailable',
};

// Frontend copy per stable server reasonCode — the UI never parses English error
// text, it maps the machine code to its own wording.
const REASON_TEXT = {
  VERIFIED: 'QR and vehicle plate verified.',
  BOOKING_NOT_FOUND: 'No booking matches that reference.',
  BOOKING_NOT_CONFIRMED: 'Booking is not Confirmed yet — it cannot be admitted automatically.',
  BOOKING_CANCELLED: 'This booking has been cancelled. Entry is not authorised.',
  BOOKING_COMPLETED: 'This booking is already completed.',
  ALREADY_ARRIVED: 'This booking is already marked Arrived.',
  ALREADY_COMPLETED: 'This booking is already completed.',
  NOT_ARRIVED: 'No arrival is recorded for this booking — exit cannot be completed.',
  TOO_EARLY: 'The vehicle is earlier than the approved arrival window.',
  TOO_LATE: 'The vehicle is later than the approved arrival window.',
  PLATE_REQUIRED: 'A vehicle plate is required to verify this booking.',
  PLATE_MISMATCH: 'Detected plate does not match the approved booking.',
  OCR_UNREADABLE: 'The plate could not be read automatically.',
  CAMERA_UNAVAILABLE: 'The gate camera was unavailable.',
  OVERRIDE_REASON_REQUIRED: 'A manual override requires a reason.',
  INVALID_ACTION: 'Invalid gate action.',
  AUDIT_FAILED: 'The decision could not be recorded, so access was not granted. Please retry.',
};

const AUTO_STEPS = ['Scan QR', 'Capture Plate', 'Verify Booking', 'Access Decision'];

// Human labels for the actual capture source surfaced in the status card / audit.
const CAPTURE_SOURCE_LABEL = {
  pi: SOURCE_LABELS.pi,
  webcam: SOURCE_LABELS.webcam,
  upload: SOURCE_LABELS.upload,
  manual: SOURCE_LABELS.manual,
  simulation: SOURCE_LABELS.simulation,
};

const fmtSlot = (v) => formatSingaporeBookingDateTime(v);

const GateVerification = () => {
  const navigate = useNavigate();
  const role = localStorage.getItem('userRole');
  const token = localStorage.getItem('accessToken');
  const authHeader = { headers: { Authorization: `Bearer ${token}` } };

  const [action, setAction] = useState('entry');           // entry | exit
  const [mode, setMode] = useState('automatic');           // automatic | manual
  const [step, setStep] = useState(0);                     // automatic-flow step index

  // Booking ref (from QR or typed) is shared by both tabs.
  const [bookingRef, setBookingRef] = useState('');
  const [manualPlate, setManualPlate] = useState('');

  // Unified camera-source state (Pi Camera Module 3 preferred; webcam fallback).
  const piConfigured = isPiConfigured();
  const [primarySource, setPrimarySource] = useState(CAMERA_SOURCE.WEBCAM); // auto-selected preferred
  const [sourceStatus, setSourceStatus] = useState(
    piConfigured ? CAMERA_STATUS.CHECKING_PI : CAMERA_STATUS.WEBCAM_ACTIVE
  );
  const [piReachable, setPiReachable] = useState(null);    // null = checking / unknown
  const [actualQrSource, setActualQrSource] = useState(null);   // pi | webcam | manual
  const [actualPlateSource, setActualPlateSource] = useState(null); // pi|webcam|upload|simulation|manual

  // QR scanner
  const [scanning, setScanning] = useState(false);
  const [qrError, setQrError] = useState('');
  const [qrSource, setQrSource] = useState(CAMERA_SOURCE.WEBCAM); // webcam | pi
  const [scannerState, setScannerState] = useState(null);
  const [qrMetrics, setQrMetrics] = useState(null);

  // PoC OCR
  const [plateCamSource, setPlateCamSource] = useState(CAMERA_SOURCE.WEBCAM); // webcam | pi
  const [plateCamActive, setPlateCamActive] = useState(false);
  const [ocr, setOcr] = useState(null);                   // { raw, normalized, confidence, simulated? }
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrError, setOcrError] = useState('');
  const [plateSource, setPlateSource] = useState('ocr');  // ocr | simulation (server plateSource)
  const [simInput, setSimInput] = useState('');

  // Verification result
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [decision, setDecision] = useState(null);
  const [lastPayload, setLastPayload] = useState(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideError, setOverrideError] = useState('');

  const qrVideoRef = useRef(null);
  const plateVideoRef = useRef(null);
  const qrStopRef = useRef(null);
  const plateStopRef = useRef(null);
  const mountedRef = useRef(true);
  const cameraGenerationRef = useRef(0);
  const cameraAbortRef = useRef(null);
  const cameraStartPromiseRef = useRef(null);

  const isCameraWorkCurrent = (generation) => (
    mountedRef.current && generation === cameraGenerationRef.current
  );

  const invalidateCameraWork = () => {
    cameraGenerationRef.current += 1;
    try { cameraAbortRef.current?.abort(); } catch { /* ignore */ }
    cameraAbortRef.current = null;
    return cameraGenerationRef.current;
  };

  const stopQrResources = () => {
    try { qrStopRef.current?.(); } catch { /* ignore */ }
    qrStopRef.current = null;
    stopStream(qrVideoRef.current);
    if (mountedRef.current) {
      setScanning(false);
      setScannerState(null);
    }
  };

  const stopPlateResources = () => {
    try { plateStopRef.current?.stop?.(); } catch { /* ignore */ }
    plateStopRef.current = null;
    stopStream(plateVideoRef.current);
    if (mountedRef.current) setPlateCamActive(false);
  };

  const stopAllCameraResources = () => {
    stopQrResources();
    stopPlateResources();
    if (mountedRef.current) setOcrBusy(false);
  };

  const stopQr = () => {
    invalidateCameraWork();
    stopQrResources();
  };
  const stopPlateCam = () => {
    invalidateCameraWork();
    stopPlateResources();
  };
  const stopAllCameras = () => {
    invalidateCameraWork();
    stopAllCameraResources();
  };
  const beginCameraWork = () => {
    const generation = invalidateCameraWork();
    stopAllCameraResources();
    const controller = new AbortController();
    cameraAbortRef.current = controller;
    return { generation, signal: controller.signal };
  };
  const releaseAllCameras = useEffectEvent(() => {
    stopAllCameras();
  });

  // Release cameras on unmount (route navigation) and when the tab is hidden.
  // Also warm the QR scanner (download @zxing/browser + probe BarcodeDetector)
  // so the first "Start Scanner" doesn't wait on a module download. This never
  // opens a camera — it only preloads code.
  useEffect(() => {
    mountedRef.current = true;
    preloadQrScanner();
    const onVisibility = () => { if (document.hidden) releaseAllCameras(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      mountedRef.current = false;
      document.removeEventListener('visibilitychange', onVisibility);
      releaseAllCameras();
    };
  }, []);

  // Auto-select the preferred camera source ONCE at page start. When the Pi is not
  // configured this returns instantly (no network probe, no Pi timeout wait) so the
  // laptop webcam is available immediately. The FM can still switch sources manually
  // after this runs. Probing happens once here, never on every render.
  useEffect(() => {
    const generation = cameraGenerationRef.current;
    // The initial status ("Checking…" / "Laptop Webcam active") is already set by the
    // sourceStatus useState initializer, so the effect only updates state AFTER the
    // async probe resolves (never synchronously in the effect body).
    (async () => {
      const pref = await resolvePreferredCameraSource();
      if (!isCameraWorkCurrent(generation)) return;
      setPrimarySource(pref.source);
      setPiReachable(pref.source === CAMERA_SOURCE.PI);
      setQrSource(pref.source);
      setPlateCamSource(pref.source);
      setSourceStatus(
        pref.source === CAMERA_SOURCE.PI ? CAMERA_STATUS.PI_CONNECTED
          : piConfigured ? CAMERA_STATUS.PI_FALLBACK
            : CAMERA_STATUS.WEBCAM_ACTIVE
      );
    })();
  }, [piConfigured]);

  if (role !== ROLES.FM) {
    return (
      <div className="dashboard-layout">
        <Sidebar />
        <main className="dashboard-main">
          <div className="gate-restricted" role="alert">
            <h1>Loading Bay Gate Verification</h1>
            <p>This tool is restricted to Facilities Managers.</p>
          </div>
        </main>
      </div>
    );
  }

  // When the Pi fails during a capture, drop back to the webcam for the whole page and
  // reflect it in the shared status line + cooldown (so we don't re-probe immediately).
  const activatePiFallback = () => {
    stopAllCameras();
    markPiUnavailable();
    setPiReachable(false);
    setPrimarySource(CAMERA_SOURCE.WEBCAM);
    setSourceStatus(CAMERA_STATUS.PI_FALLBACK);
  };

  // --- QR scanning ---
  // Uploads a still to the Node /api/qr/decode proxy (which forwards to the
  // FastAPI OpenCV decoder) and returns a CANDIDATE ref or null. Cold/unavailable
  // cloud is non-fatal — local scanning + manual entry stay available. The
  // frontend never calls FastAPI directly.
  const decodeViaCloud = async (dataUrl, signal) => {
    try {
      const res = await axios.post(`${API_BASE_URL}/api/qr/decode`, { image: dataUrl }, { ...authHeader, signal });
      return res.data?.success ? res.data.bookingRef : null;
    } catch {
      return null;
    }
  };

  const onQrResult = (text, capturedFrom = CAMERA_SOURCE.WEBCAM) => {
    const ref = normalizeBookingRef(text);
    if (!isValidBookingRef(ref)) {
      setQrError('Unrecognised QR code. Expected a FlowGuard booking reference (e.g. FG-ABC123).');
      return; // keep scanning; do not accept arbitrary QR text
    }
    setQrError('');
    setBookingRef(ref);
    setActualQrSource(capturedFrom);
    stopQr();
    setScannerState(SCANNER_STATE.QR_DETECTED);
    setStep(1);
  };

  const startQr = () => {
    if (cameraStartPromiseRef.current) return cameraStartPromiseRef.current;
    const { generation, signal } = beginCameraWork();
    setQrError('');
    setScannerState(SCANNER_STATE.LOADING);
    if (!isSecureCameraContext()) { setQrError(cameraErrorMessage('insecure')); setScannerState(SCANNER_STATE.UNAVAILABLE); return; }
    if (!isCameraSupported()) { setQrError(cameraErrorMessage('unsupported')); setScannerState(SCANNER_STATE.UNAVAILABLE); return; }
    setScanning(true);
    const promise = (async () => {
      try {
        const stop = await startQrScan({
          videoElement: qrVideoRef.current,
          onResult: (text) => {
            if (isCameraWorkCurrent(generation)) onQrResult(text, CAMERA_SOURCE.WEBCAM);
          },
          onError: ({ message }) => {
            if (!isCameraWorkCurrent(generation)) return;
            setQrError(message);
            setScanning(false);
          },
          onState: (state) => { if (isCameraWorkCurrent(generation)) setScannerState(state); },
          onMetrics: (metrics) => { if (isCameraWorkCurrent(generation)) setQrMetrics(metrics); },
          enableCloud: CLOUD_QR_ENABLED,
          cloudFallbackDelayMs: CLOUD_QR_DELAY_MS,
          onCloudDecode: async (dataUrl, requestSignal) => {
            const ref = await decodeViaCloud(dataUrl, requestSignal || signal);
            return isCameraWorkCurrent(generation) ? ref : null;
          },
          signal,
        });
        if (!isCameraWorkCurrent(generation)) {
          try { stop?.(); } catch { /* ignore */ }
          stopStream(qrVideoRef.current);
          return;
        }
        stopQrResources();
        qrStopRef.current = stop;
        setScanning(true);
      } catch (error) {
        if (!isCameraWorkCurrent(generation) || error?.code === 'aborted') return;
        setQrError(error?.message || cameraErrorMessage('unknown'));
        setScanning(false);
        setScannerState(SCANNER_STATE.UNAVAILABLE);
      }
    })();
    cameraStartPromiseRef.current = promise;
    promise.finally(() => {
      if (cameraStartPromiseRef.current === promise) cameraStartPromiseRef.current = null;
    });
    return promise;
  };

  // Raspberry Pi Camera Module 3 automatic QR: grab one fresh still (in-memory canvas,
  // never persisted) and send it to the cloud decoder (a Pi MJPEG frame can't be
  // BarcodeDetector-scanned in the browser). Auto-falls-back to the laptop webcam if
  // the Pi is unreachable, and shows the reason.
  const captureQrFromPi = async () => {
    const { generation, signal } = beginCameraWork();
    setQrError('');
    setScannerState(SCANNER_STATE.STARTING);
    let bitmap;
    try {
      bitmap = await fetchPiSnapshotBitmap();
    } catch {
      if (!isCameraWorkCurrent(generation)) return;
      activatePiFallback();
      setQrSource(CAMERA_SOURCE.WEBCAM);
      setScannerState(SCANNER_STATE.UNAVAILABLE);
      setQrError(`${fallbackMessage(FALLBACK_REASON.PI_UNREACHABLE)} Switched to the laptop webcam — or use manual entry.`);
      return;
    }
    const canvas = document.createElement('canvas');
    try {
      // The helper owns ImageBitmap.close() in a finally block. The canvas stays
      // in memory only and is discarded when this operation returns.
      drawBitmapToCanvasAndClose(bitmap, canvas);
      if (!isCameraWorkCurrent(generation)) return;
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      setScannerState(SCANNER_STATE.CLOUD);
      const ref = await decodeViaCloud(dataUrl, signal);
      if (!isCameraWorkCurrent(generation)) return;
      if (ref && isValidBookingRef(ref)) {
        setQrMetrics({ decoder: DECODER_SOURCE.PI_CAMERA_CLOUD });
        onQrResult(ref, CAMERA_SOURCE.PI);
      } else {
        setScannerState(SCANNER_STATE.MANUAL);
        setQrError('No valid FlowGuard QR detected in the Raspberry Pi snapshot. Capture again or use manual entry.');
      }
    } catch {
      if (!isCameraWorkCurrent(generation)) return;
      setScannerState(SCANNER_STATE.UNAVAILABLE);
      setQrError('Could not process the Raspberry Pi snapshot. Try again or use manual entry.');
    }
  };

  const switchQrSource = (next) => {
    if (next === qrSource) return;
    stopAllCameras();
    setQrError('');
    setScannerState(null);
    setQrMetrics(null);
    setQrSource(next);
  };

  const useTypedRef = () => {
    if (!isValidBookingRef(bookingRef)) {
      setQrError('Enter a valid FlowGuard booking reference (e.g. FG-ABC123).');
      return;
    }
    stopAllCameras();
    setQrError('');
    setBookingRef(normalizeBookingRef(bookingRef));
    setActualQrSource(CAMERA_SOURCE.MANUAL);
    setStep(1);
  };

  // --- PoC OCR ---
  const startPlateCam = () => {
    if (cameraStartPromiseRef.current) return cameraStartPromiseRef.current;
    const { generation, signal } = beginCameraWork();
    setOcrError('');
    const promise = (async () => {
      try {
        const controls = await startCamera(plateVideoRef.current, { signal });
        if (!isCameraWorkCurrent(generation)) {
          try { controls?.stop?.(); } catch { /* ignore */ }
          stopStream(plateVideoRef.current);
          return;
        }
        stopPlateResources();
        plateStopRef.current = controls;
        setPlateCamActive(true);
      } catch (e) {
        if (!isCameraWorkCurrent(generation) || e?.code === 'aborted') return;
        setOcrError(e.message || cameraErrorMessage('unknown'));
        setPlateCamActive(false);
      }
    })();
    cameraStartPromiseRef.current = promise;
    promise.finally(() => {
      if (cameraStartPromiseRef.current === promise) cameraStartPromiseRef.current = null;
    });
    return promise;
  };

  const runOcrOn = async (source, capturedFrom, generation = cameraGenerationRef.current) => {
    if (!isCameraWorkCurrent(generation)) return null;
    setOcrBusy(true);
    setOcrError('');
    try {
      const result = await recognizePlate(source);
      if (!isCameraWorkCurrent(generation)) return null;
      setOcr({ ...result, simulated: false });
      if (!result.normalized) {
        setOcrError('No plate text could be read. Retake the photo, or use manual verification.');
      }
      setPlateSource('ocr');
      setActualPlateSource(capturedFrom);
      return result;
    } catch (e) {
      if (!isCameraWorkCurrent(generation)) return null;
      setOcrError(e.message || 'OCR failed. Please retake the photo.');
      return null;
    } finally {
      if (isCameraWorkCurrent(generation)) setOcrBusy(false);
    }
  };

  const captureAndRead = async () => {
    if (!plateVideoRef.current) return;
    const generation = cameraGenerationRef.current;
    await runOcrOn(plateVideoRef.current, CAMERA_SOURCE.WEBCAM, generation);
    if (isCameraWorkCurrent(generation)) stopPlateCam();
  };

  // Raspberry Pi Camera Module 3 plate capture: grab one fresh still onto an in-memory
  // canvas (released immediately, never saved), then run the existing OCR on it. On Pi
  // failure, automatically activate the laptop-webcam fallback.
  const capturePlateFromPi = async () => {
    const { generation } = beginCameraWork();
    setOcrError('');
    setOcrBusy(true);
    let bitmap;
    try {
      bitmap = await fetchPiSnapshotBitmap();
    } catch {
      if (!isCameraWorkCurrent(generation)) return;
      activatePiFallback();
      setPlateCamSource(CAMERA_SOURCE.WEBCAM);
      setOcrBusy(false);
      setOcrError(`${fallbackMessage(FALLBACK_REASON.PI_UNREACHABLE)} Switched to the laptop webcam — press Start Camera.`);
      return;
    }
    const canvas = document.createElement('canvas');
    try {
      // ImageBitmap is closed by the helper even when drawing throws. The frame
      // remains only in this in-memory canvas and is never persisted.
      drawBitmapToCanvasAndClose(bitmap, canvas);
      if (!isCameraWorkCurrent(generation)) return;
      await runOcrOn(canvas, CAMERA_SOURCE.PI, generation);
    } catch (error) {
      if (!isCameraWorkCurrent(generation)) return;
      setOcrError(error?.message || 'Could not process the Raspberry Pi snapshot.');
      setOcrBusy(false);
    }
  };

  const onUploadImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file; nothing is persisted
    if (!file) return;
    const { generation } = beginCameraWork();
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      const loaded = new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Could not read that image.'));
      });
      img.src = url;
      await loaded;
      if (!isCameraWorkCurrent(generation)) return;
      await runOcrOn(img, CAMERA_SOURCE.UPLOAD, generation);
    } catch (err) {
      if (isCameraWorkCurrent(generation)) setOcrError(err.message || 'Could not read that image.');
    } finally {
      URL.revokeObjectURL(url); // never keep the image around
    }
  };

  const useSimulatedPlate = () => {
    const normalized = normalizePlate(simInput);
    if (!normalized) { setOcrError('Enter a plate value for the simulated reading.'); return; }
    setOcrError('');
    setOcr({ raw: simInput.trim(), normalized, confidence: null, simulated: true });
    setPlateSource('simulation');
    setActualPlateSource('simulation');
  };

  const retakePlate = () => {
    stopAllCameras();
    setOcr(null);
    setOcrError('');
    setSimInput('');
    setPlateSource('ocr');
    setActualPlateSource(null);
  };

  const switchPlateSource = (next) => {
    if (next === plateCamSource) return;
    stopAllCameras();
    setOcrError('');
    setPlateCamSource(next);
  };

  // --- Verification ---
  const verify = async (payload) => {
    setBusy(true);
    setSubmitError('');
    setOverrideError('');
    try {
      const res = await axios.post(`${API_BASE_URL}/api/bookings/gate-verification`, payload, authHeader);
      setDecision(res.data);
      setLastPayload(payload);
      setStep(3);
    } catch (err) {
      // 400 (bad request) and 500 (audit failure) still carry a decision body.
      const data = err.response?.data;
      if (data && data.reasonCode) {
        setDecision(data);
        setLastPayload(payload);
        setStep(3);
      } else {
        setSubmitError('Could not reach the verification service. Please check your connection and try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const submitAutomatic = () => {
    if (!isValidBookingRef(bookingRef)) { setSubmitError('Scan or enter a valid booking reference first.'); return; }
    stopAllCameras();
    verify({
      action,
      bookingRef: normalizeBookingRef(bookingRef),
      observedPlate: ocr?.normalized || '',
      verificationMode: 'automatic',
      plateSource,
      plateConfidence: ocr?.confidence ?? null,
      manualOverride: false,
      overrideReason: null,
      // Informational capture-source metadata for the audit trail (server ignores
      // any field it doesn't recognise; plateSource stays the authoritative enum).
      qrCaptureSource: actualQrSource,
      plateCaptureSource: actualPlateSource,
    });
  };

  const submitManual = () => {
    if (!isValidBookingRef(bookingRef)) { setSubmitError('Enter a valid booking reference (e.g. FG-ABC123).'); return; }
    verify({
      action,
      bookingRef: normalizeBookingRef(bookingRef),
      observedPlate: normalizePlate(manualPlate),
      verificationMode: 'manual',
      plateSource: 'manual',
      manualOverride: false,
      overrideReason: null,
      qrCaptureSource: CAMERA_SOURCE.MANUAL,
      plateCaptureSource: CAMERA_SOURCE.MANUAL,
    });
  };

  const authoriseOverride = () => {
    if (!overrideReason.trim()) { setOverrideError('A reason is required to authorise a manual override.'); return; }
    verify({
      ...(lastPayload || {}),
      action,
      bookingRef: normalizeBookingRef(bookingRef),
      verificationMode: 'manual',
      plateSource: 'manual',
      manualOverride: true,
      overrideReason: overrideReason.trim(),
    });
  };

  const reset = () => {
    stopAllCameras();
    setBookingRef('');
    setManualPlate('');
    setOcr(null);
    setOcrError('');
    setQrError('');
    setSimInput('');
    setPlateSource('ocr');
    setDecision(null);
    setLastPayload(null);
    setOverrideReason('');
    setOverrideError('');
    setSubmitError('');
    setScannerState(null);
    setQrMetrics(null);
    setActualQrSource(null);
    setActualPlateSource(null);
    setQrSource(primarySource);
    setPlateCamSource(primarySource);
    setStep(0);
  };

  const switchMode = (next) => {
    if (next === mode) return;
    setMode(next);
    reset();
  };

  const decisionGranted = decision?.access === 'GRANTED';
  const decisionOverride = Boolean(decision?.overrideUsed);
  const reviewable = Boolean(decision && decision.access === 'DENIED' && decision.manualReviewRequired);

  // Manual-tab field validity (Section 5: disable Verify until both are valid).
  const manualRefValid = isValidBookingRef(bookingRef);
  const manualPlateNorm = normalizePlate(manualPlate);
  const manualPlateValid = manualPlateNorm.length > 0;
  const manualValid = manualRefValid && manualPlateValid;

  // Connection state for the compact source card.
  const connectionState = piReachable === null
    ? (piConfigured ? 'Checking…' : 'Webcam only')
    : piReachable ? 'Pi connected' : (piConfigured ? 'Pi unavailable — webcam fallback' : 'Webcam only');

  const fallbackSourceLabel = piConfigured ? SOURCE_LABELS.webcam : SOURCE_LABELS.upload;

  return (
    <div className="dashboard-layout">
      <Sidebar />
      <main className="dashboard-main">
        <header className="dashboard-header">
          <div className="header-titles">
            <h1>Loading Bay Gate Verification</h1>
            <p>Dual-mode QR &amp; vehicle-plate check for the loading-bay barrier (Proof of Concept).</p>
          </div>
          <div className="header-actions">
            <button type="button" className="edit-btn" onClick={() => navigate('/logistics')}>← Back to Logistics</button>
          </div>
        </header>

        {/* Compact camera-source status card — one place shows the primary source,
            the fallback, and the live connection state (no scattered buttons). */}
        <section className="gate-source-card" aria-label="Camera source status">
          <div className="gate-source-card-main">
            <span className={`gate-source-dot ${piReachable ? 'ok' : piReachable === null ? 'checking' : 'fallback'}`} aria-hidden="true" />
            <div>
              <p className="gate-source-status" aria-live="polite">{sourceStatus}</p>
              <p className="gate-source-detail">
                Primary: <strong>{sourceLabel(primarySource)}</strong>
                <span className="gate-source-sep">·</span>
                Fallback: <strong>{fallbackSourceLabel}</strong>
                <span className="gate-source-sep">·</span>
                <span>{connectionState}</span>
              </p>
            </div>
          </div>
          <div className="gate-source-badges">
            {actualQrSource && (
              <span className="gate-source-chip">QR: {CAPTURE_SOURCE_LABEL[actualQrSource] || actualQrSource}</span>
            )}
            {actualPlateSource && (
              <span className="gate-source-chip">Plate: {CAPTURE_SOURCE_LABEL[actualPlateSource] || actualPlateSource}</span>
            )}
          </div>
        </section>

        {/* Entry / Exit segmented control */}
        <div className="gate-action-selector" role="group" aria-label="Gate action">
          <button
            type="button"
            className={`gate-seg ${action === 'entry' ? 'active' : ''}`}
            aria-pressed={action === 'entry'}
            onClick={() => setAction('entry')}
          >⇥ Entry (Arrival)</button>
          <button
            type="button"
            className={`gate-seg ${action === 'exit' ? 'active' : ''}`}
            aria-pressed={action === 'exit'}
            onClick={() => setAction('exit')}
          >⇤ Exit (Departure)</button>
        </div>

        {/* Mode tabs */}
        <div className="gate-tabs" role="tablist" aria-label="Verification mode">
          <button
            type="button" role="tab" aria-selected={mode === 'automatic'}
            className={`gate-tab ${mode === 'automatic' ? 'active' : ''}`}
            onClick={() => switchMode('automatic')}
          >Automatic Verification</button>
          <button
            type="button" role="tab" aria-selected={mode === 'manual'}
            className={`gate-tab ${mode === 'manual' ? 'active' : ''}`}
            onClick={() => switchMode('manual')}
          >Manual Verification</button>
        </div>

        {submitError && <div className="error-banner gate-submit-error">⚠️ {submitError}</div>}

        <div className="gate-grid">
          {/* LEFT: capture / input workflow */}
          <section className="gate-panel">
            {mode === 'automatic' ? (
              <>
                {/* Step indicator */}
                <ol className="gate-steps" aria-label="Verification progress">
                  {AUTO_STEPS.map((label, i) => (
                    <li key={label} className={`gate-step ${i === step ? 'current' : ''} ${i < step ? 'done' : ''}`}>
                      <span className="gate-step-num">{i < step ? '✓' : i + 1}</span>
                      <span className="gate-step-label">{label}</span>
                    </li>
                  ))}
                </ol>

                {/* Step 1: Scan QR */}
                <div className="gate-block">
                  <h3>1 · Scan Driver QR</h3>

                  {/* Camera source: Raspberry Pi Camera Module 3 (preferred when
                      reachable) or the laptop webcam. */}
                  <div className="gate-source-select" role="group" aria-label="QR camera source">
                    <span className="gate-source-label">Camera source:</span>
                    {piConfigured && (
                      <button
                        type="button"
                        className={`gate-source-btn ${qrSource === CAMERA_SOURCE.PI ? 'active' : ''}`}
                        aria-pressed={qrSource === CAMERA_SOURCE.PI}
                        onClick={() => switchQrSource(CAMERA_SOURCE.PI)}
                      >{SOURCE_LABELS.pi}</button>
                    )}
                    <button
                      type="button"
                      className={`gate-source-btn ${qrSource === CAMERA_SOURCE.WEBCAM ? 'active' : ''}`}
                      aria-pressed={qrSource === CAMERA_SOURCE.WEBCAM}
                      onClick={() => switchQrSource(CAMERA_SOURCE.WEBCAM)}
                    >{SOURCE_LABELS.webcam}</button>
                  </div>

                  <div className="gate-video-wrap">
                    {/* A Pi MJPEG stream is shown via an <img> (never attached to a
                        MediaStream <video>); processing always uses a fresh /snapshot. */}
                    {qrSource === CAMERA_SOURCE.PI && PI_CAMERA_STREAM_URL ? (
                      <img className="gate-video" src={PI_CAMERA_STREAM_URL} alt="Raspberry Pi Camera Module 3 live preview" />
                    ) : (
                      <video ref={qrVideoRef} className="gate-video" muted playsInline aria-label="QR scanner preview" />
                    )}
                    {qrSource === CAMERA_SOURCE.PI
                      ? (!PI_CAMERA_STREAM_URL && <div className="gate-video-idle">{SOURCE_LABELS.pi} — capture a snapshot to scan</div>)
                      : (!scanning && <div className="gate-video-idle">Camera is off</div>)}
                  </div>

                  {scannerState && SCANNER_STATE_TEXT[scannerState] && (
                    <p className="gate-scanner-state" aria-live="polite">{SCANNER_STATE_TEXT[scannerState]}</p>
                  )}
                  {qrError && <div className="gate-inline-error" role="alert">⚠️ {qrError}</div>}

                  <div className="gate-btn-row">
                    {qrSource === CAMERA_SOURCE.WEBCAM ? (
                      !scanning ? (
                        <button type="button" className="new-booking-btn" onClick={startQr}>Start QR Scanner</button>
                      ) : (
                        <button type="button" className="cancel-btn" onClick={stopQr}>Stop Scanner</button>
                      )
                    ) : (
                      <button type="button" className="new-booking-btn" onClick={captureQrFromPi}>
                        Capture QR from {SOURCE_LABELS.pi}
                      </button>
                    )}
                  </div>

                  {CAMERA_DEBUG && qrMetrics && (
                    <details className="gate-diag" open>
                      <summary>QR timing (debug)</summary>
                      <ul className="gate-diag-list">
                        {qrMetrics.decoder && <li>decoder: <code>{qrMetrics.decoder}</code></li>}
                        {qrMetrics.cameraStartupMs != null && <li>camera start: {qrMetrics.cameraStartupMs} ms</li>}
                        {qrMetrics.firstFrameMs != null && <li>first frame: {qrMetrics.firstFrameMs} ms</li>}
                        {qrMetrics.localDecodeMs != null && <li>local decode: {qrMetrics.localDecodeMs} ms</li>}
                        {qrMetrics.cloudDecodeMs != null && <li>cloud decode: {qrMetrics.cloudDecodeMs} ms</li>}
                      </ul>
                    </details>
                  )}

                  <div className="gate-fallback">
                    <label htmlFor="gate-ref">Or enter booking reference (manual fallback)</label>
                    <div className="gate-btn-row">
                      <input
                        id="gate-ref"
                        aria-label="Booking reference"
                        placeholder="FG-ABC123"
                        value={bookingRef}
                        onChange={(e) => setBookingRef(e.target.value)}
                      />
                      <button type="button" className="edit-btn" onClick={useTypedRef}>Use reference</button>
                    </div>
                  </div>
                  {bookingRef && isValidBookingRef(bookingRef) && (
                    <p className="gate-ok">Booking reference set: <strong>{normalizeBookingRef(bookingRef)}</strong></p>
                  )}
                </div>

                {/* Step 2: PoC Plate OCR */}
                <div className="gate-block">
                  <h3>2 · PoC Plate OCR</h3>
                  <p className="gate-note">
                    <strong>PoC Plate OCR.</strong> Recognition accuracy may vary with lighting, glare,
                    camera angle and plate condition. Manual verification is available.
                  </p>

                  {/* Plate camera source: Pi Camera Module 3 (preferred) or laptop webcam. */}
                  <div className="gate-source-select" role="group" aria-label="Plate camera source">
                    <span className="gate-source-label">Camera source:</span>
                    {piConfigured && (
                      <button
                        type="button"
                        className={`gate-source-btn ${plateCamSource === CAMERA_SOURCE.PI ? 'active' : ''}`}
                        aria-pressed={plateCamSource === CAMERA_SOURCE.PI}
                        aria-label={`Plate camera source: ${SOURCE_LABELS.pi}`}
                        onClick={() => switchPlateSource(CAMERA_SOURCE.PI)}
                      >{SOURCE_LABELS.pi}</button>
                    )}
                    <button
                      type="button"
                      className={`gate-source-btn ${plateCamSource === CAMERA_SOURCE.WEBCAM ? 'active' : ''}`}
                      aria-pressed={plateCamSource === CAMERA_SOURCE.WEBCAM}
                      aria-label={`Plate camera source: ${SOURCE_LABELS.webcam}`}
                      onClick={() => switchPlateSource(CAMERA_SOURCE.WEBCAM)}
                    >{SOURCE_LABELS.webcam}</button>
                  </div>

                  <div className="gate-video-wrap">
                    {plateCamSource === CAMERA_SOURCE.PI && PI_CAMERA_STREAM_URL ? (
                      <img className="gate-video" src={PI_CAMERA_STREAM_URL} alt="Raspberry Pi Camera Module 3 plate preview" />
                    ) : (
                      <video ref={plateVideoRef} className="gate-video" muted playsInline aria-label="Plate camera preview" />
                    )}
                    {plateCamSource === CAMERA_SOURCE.PI
                      ? (!PI_CAMERA_STREAM_URL && <div className="gate-video-idle">{SOURCE_LABELS.pi} — capture a snapshot to read</div>)
                      : (!plateCamActive && <div className="gate-video-idle">Camera is off</div>)}
                  </div>
                  {ocrError && <div className="gate-inline-error" role="alert">⚠️ {ocrError}</div>}
                  <div className="gate-btn-row">
                    {plateCamSource === CAMERA_SOURCE.PI ? (
                      <button type="button" className="new-booking-btn" onClick={capturePlateFromPi} disabled={ocrBusy}>
                        {ocrBusy ? 'Reading…' : `Capture Plate from ${SOURCE_LABELS.pi}`}
                      </button>
                    ) : !plateCamActive ? (
                      <button type="button" className="edit-btn" onClick={startPlateCam}>Start Camera</button>
                    ) : (
                      <button type="button" className="new-booking-btn" onClick={captureAndRead} disabled={ocrBusy}>
                        {ocrBusy ? 'Reading…' : 'Capture & Read Plate'}
                      </button>
                    )}
                    <label className="gate-upload edit-btn">
                      Upload Plate Image
                      <input type="file" accept="image/*" aria-label="Upload plate image" onChange={onUploadImage} hidden />
                    </label>
                    {ocr && <button type="button" className="cancel-btn" onClick={retakePlate}>Retake</button>}
                  </div>

                  {/* Clearly-labelled simulated provider for controlled demos */}
                  <details className="gate-sim">
                    <summary>Simulated LPR (demo)</summary>
                    <p className="gate-note">
                      <strong>Simulated LPR — PoC demonstration.</strong> This is not real AI recognition;
                      it stands in for the camera during controlled demos.
                    </p>
                    <div className="gate-btn-row">
                      <input
                        aria-label="Simulated plate"
                        placeholder="e.g. GBG 1234M"
                        value={simInput}
                        onChange={(e) => setSimInput(e.target.value)}
                      />
                      <button type="button" className="edit-btn" onClick={useSimulatedPlate}>Use simulated plate</button>
                    </div>
                  </details>

                  {ocr && (
                    <div className="gate-ocr-result" aria-label="OCR result">
                      {ocr.simulated && <span className="gate-badge sim">Simulated LPR — PoC demonstration</span>}
                      <div className="gate-ocr-row"><span>Raw OCR text</span><code>{ocr.raw || '(none)'}</code></div>
                      <div className="gate-ocr-row"><span>Normalised plate</span><strong>{ocr.normalized || '(none)'}</strong></div>
                      <div className="gate-ocr-row">
                        <span>OCR confidence</span>
                        <span>{ocr.confidence == null ? '—' : `${ocr.confidence}%`}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Step 3: Verify */}
                <div className="gate-block">
                  <h3>3 · Verify Access</h3>
                  <button type="button" className="new-booking-btn gate-verify-btn" onClick={submitAutomatic} disabled={busy}>
                    {busy ? 'Verifying…' : `Verify ${action === 'entry' ? 'Entry' : 'Exit'}`}
                  </button>
                </div>
              </>
            ) : (
              /* MANUAL TAB — polished dark card (Section 5) */
              <div className="gate-manual-card">
                <div className="gate-manual-head">
                  <h3>Manual gate check</h3>
                  <p className="gate-note">
                    Manually confirm the booking reference and the plate you observe on the vehicle.
                    A mismatch is denied unless you perform an audited manual override.
                  </p>
                </div>

                <div className="gate-field-grid">
                  <div className={`gate-field ${bookingRef && !manualRefValid ? 'has-error' : ''}`}>
                    <label htmlFor="gate-ref-m">Booking Reference <span className="gate-req" aria-hidden="true">*</span></label>
                    <input
                      id="gate-ref-m"
                      className="gate-input"
                      aria-label="Booking reference"
                      aria-required="true"
                      aria-invalid={Boolean(bookingRef) && !manualRefValid}
                      placeholder="FG-ABC123"
                      value={bookingRef}
                      onChange={(e) => setBookingRef(e.target.value)}
                    />
                    <small className="gate-field-hint">Format: FG- followed by 4–12 letters/digits. Example: FG-ABC123</small>
                    {bookingRef && !manualRefValid && (
                      <p className="gate-field-error" role="alert">Enter a valid FlowGuard reference (e.g. FG-ABC123).</p>
                    )}
                  </div>

                  <div className={`gate-field ${manualPlate && !manualPlateValid ? 'has-error' : ''}`}>
                    <label htmlFor="gate-plate-m">Observed Vehicle Plate <span className="gate-req" aria-hidden="true">*</span></label>
                    <input
                      id="gate-plate-m"
                      className="gate-input gate-input-plate"
                      aria-label="Observed vehicle plate"
                      aria-required="true"
                      aria-invalid={Boolean(manualPlate) && !manualPlateValid}
                      placeholder="GBG 1234M"
                      value={manualPlate}
                      onChange={(e) => setManualPlate(e.target.value)}
                    />
                    <small className="gate-field-hint">
                      As shown on the vehicle. Example: GBG 1234M{manualPlateNorm ? ` → normalised ${manualPlateNorm}` : ''}
                    </small>
                    {manualPlate && !manualPlateValid && (
                      <p className="gate-field-error" role="alert">Enter the plate you can read on the vehicle.</p>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  className="new-booking-btn gate-verify-btn"
                  onClick={submitManual}
                  disabled={busy || !manualValid}
                >
                  {busy ? (<><span className="gate-spinner" aria-hidden="true" /> Verifying…</>) : `Verify ${action === 'entry' ? 'Entry' : 'Exit'}`}
                </button>
              </div>
            )}
          </section>

          {/* RIGHT: decision */}
          <section className="gate-panel gate-decision-panel">
            <h3>{AUTO_STEPS[3]}</h3>
            {!decision ? (
              <div className="gate-decision-empty">
                <p>No decision yet. Complete the steps and press <strong>Verify</strong>.</p>
              </div>
            ) : (
              <div className={`gate-decision ${decisionGranted ? 'granted' : 'denied'}`} role="status" aria-live="polite">
                <div className="gate-decision-head">
                  <span className="gate-decision-icon" aria-hidden="true">{decisionGranted ? '✓' : '✕'}</span>
                  <span className="gate-decision-title">
                    {decisionGranted
                      ? (decisionOverride ? 'ACCESS GRANTED — MANUAL OVERRIDE' : 'ACCESS GRANTED')
                      : 'ACCESS DENIED'}
                  </span>
                </div>

                <p className="gate-decision-msg">{REASON_TEXT[decision.reasonCode] || decision.message}</p>

                {decisionGranted ? (
                  <div className="gate-barrier" aria-label="Barrier simulation">
                    <div className="gate-barrier-track"><div className="gate-barrier-arm open" /></div>
                    <p className="gate-sim-note">
                      {decisionOverride
                        ? <>Approved by Facilities Manager. Reason: <em>{lastPayload?.overrideReason}</em></>
                        : <>Proceed to {decision.booking?.loading_bay || 'the assigned bay'}.</>}
                    </p>
                    <p className="gate-sim-note muted">Barrier opening simulated — no physical barrier is connected.</p>
                  </div>
                ) : (
                  <div className="gate-barrier denied" aria-label="Barrier simulation">
                    <div className="gate-barrier-track"><div className="gate-barrier-arm closed" /></div>
                    <p className="gate-sim-note">Barrier remains closed.{reviewable ? ' Manual verification required.' : ''}</p>
                  </div>
                )}

                {decision.warning === 'SCHEDULE_UNVERIFIED' && (
                  <p className="gate-inline-error" role="alert">⚠️ Schedule validation was unavailable (no slot on this booking).</p>
                )}

                {/* Plate comparison */}
                <div className="gate-compare">
                  <div><span>Expected plate</span><strong>{decision.expectedPlate || '—'}</strong></div>
                  <div><span>Detected plate</span><strong>{decision.observedPlate || '—'}</strong></div>
                  <div>
                    <span>Plate check</span>
                    <strong className={decision.plateMatched ? 'match' : 'mismatch'}>
                      {decision.plateMatched == null ? '—' : decision.plateMatched ? '✓ Match' : '✕ Mismatch'}
                    </strong>
                  </div>
                </div>

                {/* Actual capture sources recorded for this decision (audit visibility). */}
                {(lastPayload?.qrCaptureSource || lastPayload?.plateCaptureSource) && (
                  <div className="gate-source-provenance">
                    {lastPayload?.qrCaptureSource && (
                      <span className="gate-source-chip">QR: {CAPTURE_SOURCE_LABEL[lastPayload.qrCaptureSource] || lastPayload.qrCaptureSource}</span>
                    )}
                    {lastPayload?.plateCaptureSource && (
                      <span className="gate-source-chip">Plate: {CAPTURE_SOURCE_LABEL[lastPayload.plateCaptureSource] || lastPayload.plateCaptureSource}</span>
                    )}
                  </div>
                )}

                {lastPayload?.plateSource === 'simulation' && (
                  <span className="gate-badge sim">Simulated LPR — PoC demonstration</span>
                )}

                {/* Booking summary */}
                {decision.booking && (
                  <div className="gate-summary">
                    <div><span>Reference</span><strong>{decision.booking.booking_ref}</strong></div>
                    <div><span>Company</span><strong>{decision.booking.transport_company || '—'}</strong></div>
                    <div><span>Driver</span><strong>{decision.booking.driver_name || '—'}</strong></div>
                    <div><span>Bay</span><strong>{decision.booking.loading_bay || '—'}</strong></div>
                    <div><span>Slot</span><strong>{fmtSlot(decision.booking.slot_start)}</strong></div>
                    <div><span>Status</span><strong>{decision.booking.status}</strong></div>
                  </div>
                )}

                {/* Override path for reviewable denials */}
                {reviewable && (
                  <div className="gate-override">
                    <h4>Authorised manual override</h4>
                    <p className="gate-note">Overriding a plate/OCR failure is recorded against your account.</p>
                    <textarea
                      aria-label="Override reason"
                      placeholder="Reason for override (required)"
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                      rows={2}
                    />
                    {overrideError && <div className="gate-inline-error" role="alert">⚠️ {overrideError}</div>}
                    <button type="button" className="new-booking-btn" onClick={authoriseOverride} disabled={busy}>
                      {busy ? 'Working…' : 'Authorise Manual Override'}
                    </button>
                  </div>
                )}

                <button type="button" className="edit-btn gate-reset-btn" onClick={reset}>New Scan</button>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
};

export default GateVerification;
