import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  CAMERA_SOURCE, SOURCE_LABELS, isPiConfigured,
  fetchPiSnapshotBitmap, markPiUnavailable,
  fallbackMessage, FALLBACK_REASON,
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

  // QR scanner
  const [scanning, setScanning] = useState(false);
  const [qrError, setQrError] = useState('');
  const [qrSource, setQrSource] = useState(CAMERA_SOURCE.WEBCAM); // webcam | pi
  const [scannerState, setScannerState] = useState(null);
  const [qrMetrics, setQrMetrics] = useState(null);
  const piConfigured = isPiConfigured();

  // PoC OCR
  const [plateCamActive, setPlateCamActive] = useState(false);
  const [ocr, setOcr] = useState(null);                   // { raw, normalized, confidence, simulated? }
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrError, setOcrError] = useState('');
  const [plateSource, setPlateSource] = useState('ocr');  // ocr | simulation
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

  const stopQr = () => {
    try { qrStopRef.current?.(); } catch { /* ignore */ }
    qrStopRef.current = null;
    setScanning(false);
    setScannerState(null);
  };
  const stopPlateCam = () => {
    try { plateStopRef.current?.stop?.(); } catch { /* ignore */ }
    plateStopRef.current = null;
    setPlateCamActive(false);
  };
  const stopAllCameras = () => { stopQr(); stopPlateCam(); };

  // Release cameras on unmount (route navigation) and when the tab is hidden.
  // Also warm the QR scanner (download @zxing/browser + probe BarcodeDetector)
  // so the first "Start Scanner" doesn't wait on a module download. This never
  // opens a camera — it only preloads code.
  useEffect(() => {
    preloadQrScanner();
    const onVisibility = () => { if (document.hidden) stopAllCameras(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stopAllCameras();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const onQrResult = (text) => {
    const ref = normalizeBookingRef(text);
    if (!isValidBookingRef(ref)) {
      setQrError('Unrecognised QR code. Expected a FlowGuard booking reference (e.g. FG-ABC123).');
      return; // keep scanning; do not accept arbitrary QR text
    }
    setQrError('');
    setBookingRef(ref);
    stopQr();
    setScannerState(SCANNER_STATE.QR_DETECTED);
    setStep(1);
  };

  const startQr = async () => {
    setQrError('');
    setScannerState(SCANNER_STATE.LOADING);
    if (!isSecureCameraContext()) { setQrError(cameraErrorMessage('insecure')); setScannerState(SCANNER_STATE.UNAVAILABLE); return; }
    if (!isCameraSupported()) { setQrError(cameraErrorMessage('unsupported')); setScannerState(SCANNER_STATE.UNAVAILABLE); return; }
    setScanning(true);
    const stop = await startQrScan({
      videoElement: qrVideoRef.current,
      onResult: onQrResult,
      onError: ({ message }) => { setQrError(message); setScanning(false); },
      onState: setScannerState,
      onMetrics: setQrMetrics,
      enableCloud: CLOUD_QR_ENABLED,
      cloudFallbackDelayMs: CLOUD_QR_DELAY_MS,
      onCloudDecode: decodeViaCloud,
    });
    qrStopRef.current = stop;
  };

  // Raspberry Pi Camera Module 3 automatic QR: grab one fresh still and send it
  // to the cloud decoder (a Pi MJPEG frame can't be BarcodeDetector-scanned in
  // the browser). Falls back to the laptop webcam if the Pi is unreachable.
  // Never persists the snapshot.
  const captureQrFromPi = async () => {
    setQrError('');
    setScannerState(SCANNER_STATE.STARTING);
    let bitmap;
    try {
      bitmap = await fetchPiSnapshotBitmap();
    } catch {
      markPiUnavailable();
      setScannerState(SCANNER_STATE.UNAVAILABLE);
      setQrError(`${fallbackMessage(FALLBACK_REASON.PI_UNREACHABLE)} Or use manual entry.`);
      setQrSource(CAMERA_SOURCE.WEBCAM);
      return;
    }
    try {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      bitmap.close?.();
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      setScannerState(SCANNER_STATE.CLOUD);
      const ref = await decodeViaCloud(dataUrl);
      if (ref && isValidBookingRef(ref)) {
        setQrMetrics({ decoder: DECODER_SOURCE.PI_CAMERA_CLOUD });
        onQrResult(ref);
      } else {
        setScannerState(SCANNER_STATE.MANUAL);
        setQrError('No valid FlowGuard QR detected in the Raspberry Pi snapshot. Capture again or use manual entry.');
      }
    } catch {
      setScannerState(SCANNER_STATE.UNAVAILABLE);
      setQrError('Could not process the Raspberry Pi snapshot. Try again or use manual entry.');
    }
  };

  const switchQrSource = (next) => {
    if (next === qrSource) return;
    stopQr();
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
    setQrError('');
    setBookingRef(normalizeBookingRef(bookingRef));
    setStep(1);
  };

  // --- PoC OCR ---
  const startPlateCam = async () => {
    setOcrError('');
    stopQr(); // stop QR scanning before the plate camera / heavy OCR (no dual streams)
    try {
      const controls = await startCamera(plateVideoRef.current);
      plateStopRef.current = controls;
      setPlateCamActive(true);
    } catch (e) {
      setOcrError(e.message || cameraErrorMessage('unknown'));
      setPlateCamActive(false);
    }
  };

  const runOcrOn = async (source) => {
    setOcrBusy(true);
    setOcrError('');
    try {
      const result = await recognizePlate(source);
      if (!result.normalized) {
        setOcr({ ...result, simulated: false });
        setOcrError('No plate text could be read. Retake the photo, or use manual verification.');
      } else {
        setOcr({ ...result, simulated: false });
      }
      setPlateSource('ocr');
    } catch (e) {
      setOcrError(e.message || 'OCR failed. Please retake the photo.');
    } finally {
      setOcrBusy(false);
    }
  };

  const captureAndRead = async () => {
    if (!plateVideoRef.current) return;
    await runOcrOn(plateVideoRef.current);
    stopPlateCam();
  };

  const onUploadImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file; nothing is persisted
    if (!file) return;
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      const loaded = new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Could not read that image.'));
      });
      img.src = url;
      await loaded;
      await runOcrOn(img);
    } catch (err) {
      setOcrError(err.message || 'Could not read that image.');
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
  };

  const retakePlate = () => {
    stopPlateCam();
    setOcr(null);
    setOcrError('');
    setSimInput('');
    setPlateSource('ocr');
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
    setQrSource(CAMERA_SOURCE.WEBCAM);
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

        {/* Entry / Exit selector */}
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

        {submitError && <div className="error-banner" style={{ margin: '12px 0' }}>⚠️ {submitError}</div>}

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

                  {/* Camera source: laptop webcam (default) or Raspberry Pi Camera Module 3. */}
                  <div className="gate-source-select" role="group" aria-label="QR camera source">
                    <span className="gate-source-label">Camera source:</span>
                    <button
                      type="button"
                      className={`gate-source-btn ${qrSource === CAMERA_SOURCE.WEBCAM ? 'active' : ''}`}
                      aria-pressed={qrSource === CAMERA_SOURCE.WEBCAM}
                      onClick={() => switchQrSource(CAMERA_SOURCE.WEBCAM)}
                    >{SOURCE_LABELS.webcam}</button>
                    {piConfigured && (
                      <button
                        type="button"
                        className={`gate-source-btn ${qrSource === CAMERA_SOURCE.PI ? 'active' : ''}`}
                        aria-pressed={qrSource === CAMERA_SOURCE.PI}
                        onClick={() => switchQrSource(CAMERA_SOURCE.PI)}
                      >{SOURCE_LABELS.pi}</button>
                    )}
                  </div>

                  <div className="gate-video-wrap">
                    <video ref={qrVideoRef} className="gate-video" muted playsInline aria-label="QR scanner preview" />
                    {qrSource === CAMERA_SOURCE.PI
                      ? <div className="gate-video-idle">{SOURCE_LABELS.pi} — capture a snapshot to scan</div>
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
                  <div className="gate-video-wrap">
                    <video ref={plateVideoRef} className="gate-video" muted playsInline aria-label="Plate camera preview" />
                    {!plateCamActive && <div className="gate-video-idle">Camera is off</div>}
                  </div>
                  {ocrError && <div className="gate-inline-error" role="alert">⚠️ {ocrError}</div>}
                  <div className="gate-btn-row">
                    {!plateCamActive ? (
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
              /* MANUAL TAB */
              <div className="gate-block">
                <h3>Manual Verification</h3>
                <p className="gate-note">
                  Manually confirm the booking reference and the plate you observe on the vehicle.
                  A mismatch is denied unless you perform an audited manual override.
                </p>
                <div className="form-group">
                  <label htmlFor="gate-ref-m">Booking Reference *</label>
                  <input
                    id="gate-ref-m"
                    aria-label="Booking reference"
                    placeholder="FG-ABC123"
                    value={bookingRef}
                    onChange={(e) => setBookingRef(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="gate-plate-m">Observed Vehicle Plate *</label>
                  <input
                    id="gate-plate-m"
                    aria-label="Observed vehicle plate"
                    placeholder="e.g. GBG 1234M"
                    value={manualPlate}
                    onChange={(e) => setManualPlate(e.target.value)}
                  />
                </div>
                <button type="button" className="new-booking-btn gate-verify-btn" onClick={submitManual} disabled={busy}>
                  {busy ? 'Verifying…' : `Verify ${action === 'entry' ? 'Entry' : 'Exit'}`}
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
