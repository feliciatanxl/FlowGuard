import { useEffect, useEffectEvent, useRef, useState } from 'react';
import axios from 'axios';
import VideocamOffIcon from '@mui/icons-material/VideocamOff';
import Sidebar from '../components/Sidebar';
import SafeMuiIcon from '../components/SafeMuiIcon';
import SecurityLogIcon from '../components/SecurityLogIcon';
import '../css/Dashboard.css';
import '../css/VPatrol.css';
import {
  PI_CAMERA_STREAM_URL,
  CAMERA_SOURCES,
  CAMERA_STATUS_MESSAGES,
  isPiCameraReachableCached,
  markPiUnavailable,
  fetchPiSnapshotBitmap,
} from '../constants/piCamera';
import { SOURCE_LABELS, drawBitmapToCanvasAndClose } from '../utils/cameraSource';
import { API_BASE_URL } from '../constants/api';
import { clampBoxToFrame, faceBoxStyle, smoothBox } from '../constants/faceBox';
import { describeRecognitionSubject, RECOGNITION_STATUS } from '../constants/recognition';
import { formatSingaporeTimestamp, formatSingaporeFull } from '../constants/datetime';
import {
  deriveAccessResult,
  getLogTimestamp,
  filterSecurityLogs,
  hasActiveFilters,
  DATE_FILTERS,
  EVENT_FILTERS,
} from '../constants/securityTimeline';
import {
  SCAN_INTERVAL_MS,
  TARGET_LOCK_MS,
  CAPTURE_MAX_WIDTH,
  CAPTURE_JPEG_QUALITY,
  TRACK_INTERVAL_MS,
  TRACK_MAX_WIDTH,
  TRACK_JPEG_QUALITY,
  BOX_CLEAR_TIMEOUT_MS,
  SERVICE_UNAVAILABLE_MSG,
  createScanGate,
  startTimer,
  logScanTimings,
  logTrackingTimings,
  logLivenessTelemetry,
  nowMs,
} from '../constants/scanControl';
import {
  createHeadTurnChallenge,
  CHALLENGE_STATE,
  LIVENESS_BASELINE_SAMPLES,
} from '../constants/liveness';

// Pi snapshot failures must persist this long before the page falls back to
// the laptop webcam (time-based so the fast tracking loop cannot trip it on a
// single hiccup).
const PI_FAIL_FALLBACK_MS = 2500;

// A single multi-face tracking sample is a transient warning only. The denied
// SecurityLog is written ONLY when more than one face persists this long AND
// an authorisation attempt was aborted because of it (~6 tracking samples).
const MULTI_FACE_LOG_PERSIST_MS = 1500;

const createAccessCycleId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  // RFC-4122-shaped fallback for older kiosk browsers. This is an idempotency
  // token, not a credential or source of security-sensitive randomness.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    return (char === 'x' ? value : ((value & 0x3) | 0x8)).toString(16);
  });
};

const VPatrol = () => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);       // full-recognition capture canvas
  const trackCanvasRef = useRef(null);  // small tracking capture canvas (independent of recognition)
  const containerRef = useRef(null);    // preview container, for face-box projection

  // Camera source: Raspberry Pi Gate Camera is primary, laptop webcam is fallback
  const [cameraSource, setCameraSource] = useState(CAMERA_SOURCES.PI);
  const [cameraStatusMsg, setCameraStatusMsg] = useState("Connecting to Raspberry Pi Camera Module 3…");
  const cameraSourceRef = useRef(CAMERA_SOURCES.PI);
  const mediaStreamRef = useRef(null);
  const webcamStartPromiseRef = useRef(null);
  const webcamStartSessionRef = useRef(null);
  const piFailSinceRef = useRef(0);
  const piRequestControllersRef = useRef(new Set());
  const piPreviewRef = useRef(null);

  // Staged States: SYSTEM_ACTIVE, PRESENCE_DETECTED, TARGET_LOCKING, LIVENESS_CHECK, AUTHORIZING, SECURE_MATCH, UNKNOWN_QUERY
  const [scanStatus, setScanStatus] = useState("SYSTEM_ACTIVE");
  const [identifiedUser, setIdentifiedUser] = useState(null);
  const [faceBox, setFaceBox] = useState(null);
  const [scanProgress, setScanProgress] = useState(0);
  const [multipleFacesNotice, setMultipleFacesNotice] = useState(false);

  const scanStatusRef = useRef("SYSTEM_ACTIVE");
  const lockTimerRef = useRef(null);
  const progressIntervalRef = useRef(null);
  const resetTimerRef = useRef(null);
  const lockPendingRef = useRef(false);

  // Two INDEPENDENT in-flight locks: tracking (box/liveness) and full
  // recognition (identity) never share a guard.
  const trackingInFlightRef = useRef(false);
  const recognitionInFlightRef = useRef(createScanGate());
  const [serviceNotice, setServiceNotice] = useState('');
  // Manual stop/restart of the automatic recognition loops (patrol control).
  const [monitoringPaused, setMonitoringPaused] = useState(false);
  const pausedRef = useRef(false);
  // Bumped on camera-source switch and unmount; responses from an older
  // session are stale and must be ignored.
  const scanSessionRef = useRef(0);

  // LIVENESS MEMORY: candidate + baseline-movement head-turn challenge
  const candidateUserRef = useRef(null);
  const challengeRef = useRef(null);
  const finalizingRef = useRef(false);
  const lastLogRef = useRef({ name: null, timestamp: 0 });

  // Denied-outcome audit guards: one /denied-event submission per reason per
  // scanner cycle, and one per persistent multi-face episode.
  const deniedReportedRef = useRef(new Set());
  const multiFaceRef = useRef({ since: 0, abortedAuth: false, logged: false });

  // Live tracking state: smoothed frame-space box, last-seen time, and the
  // recent valid head-turn ratios that seed the liveness baseline.
  const smoothedBoxRef = useRef(null);
  const lastFaceSeenAtRef = useRef(0);
  const recentRatiosRef = useRef([]);

  const [systemTime, setSystemTime] = useState(new Date().toLocaleTimeString('en-SG', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
  }));

  const [incidentLogs, setIncidentLogs] = useState([]);

  // Compact timeline filters (frontend-only filtering of the loaded records).
  const [dateFilter, setDateFilter] = useState('all');
  const [eventFilter, setEventFilter] = useState('all');
  const [searchFilter, setSearchFilter] = useState('');

  const token = localStorage.getItem("accessToken");
  // All recognition traffic goes through the Node backend - never FastAPI directly.
  const NODE_SERVER_URL = `${API_BASE_URL}/api/security/logs`;
  const RECOGNIZE_URL = `${API_BASE_URL}/api/facial-recognition/recognize`;
  const TRACK_URL = `${API_BASE_URL}/api/facial-recognition/track`;
  // V-Patrol is a monitoring post: it records access AUDIT events only and must
  // never toggle clock-in/out (that belongs to the Gate Scanner's scan endpoint).
  const ACCESS_EVENT_URL = `${API_BASE_URL}/api/facial-recognition/access-event`;
  // Server-owned audit for FINAL denied outcomes (identity mismatch, liveness
  // timeout, persistent multiple faces). The server decides type/severity/
  // review status; the client only names the allowed reason.
  const DENIED_EVENT_URL = `${API_BASE_URL}/api/facial-recognition/denied-event`;
  const CAMERA_LOCATION = "Biometric Gantry";

  const changeScanState = (nextState) => {
    setScanStatus(nextState);
    scanStatusRef.current = nextState;
  };

  const abortActivePiRequests = () => {
    piRequestControllersRef.current.forEach((controller) => controller.abort());
    piRequestControllersRef.current.clear();
  };

  const clearPiPreview = () => {
    try { piPreviewRef.current?.removeAttribute('src'); } catch { /* ignore */ }
  };

  const applyCameraSource = (source, statusMsg) => {
    if (source !== CAMERA_SOURCES.PI) {
      abortActivePiRequests();
      clearPiPreview();
    }
    cameraSourceRef.current = source;
    setCameraSource(source);
    setCameraStatusMsg(statusMsg);
    piFailSinceRef.current = 0;
  };

  // Wipe every per-source tracking artefact so a stale box from the old
  // camera source can never render over the new one.
  const clearTrackingState = () => {
    smoothedBoxRef.current = null;
    lastFaceSeenAtRef.current = 0;
    recentRatiosRef.current = [];
    setFaceBox(null);
    setMultipleFacesNotice(false);
    multiFaceRef.current = { since: 0, abortedAuth: false, logged: false };
  };

  const probePiReachable = async () => {
    const controller = new AbortController();
    piRequestControllersRef.current.add(controller);
    try {
      return await isPiCameraReachableCached(Date.now(), { signal: controller.signal });
    } finally {
      piRequestControllersRef.current.delete(controller);
    }
  };

  // Primary source: Raspberry Pi Gate Camera. Probe the snapshot endpoint on
  // load; if unreachable, automatically fall back to the laptop webcam.
  const initCameraSource = async () => {
    const scanSession = scanSessionRef.current;
    const piReachable = await probePiReachable();
    if (scanSession !== scanSessionRef.current) return;
    if (piReachable) {
      stopCCTV();
      applyCameraSource(CAMERA_SOURCES.PI, CAMERA_STATUS_MESSAGES.PI_CONNECTED);
      changeScanState("SYSTEM_ACTIVE");
    } else {
      applyCameraSource(CAMERA_SOURCES.WEBCAM, CAMERA_STATUS_MESSAGES.PI_UNAVAILABLE);
      await startCCTV();
    }
  };

  // Manual camera source switch (Pi Gate Camera / Laptop Webcam)
  const selectCameraSource = async (source) => {
    if (source === cameraSourceRef.current) return;
    scanSessionRef.current += 1; // invalidate responses captured from the old source
    abortActivePiRequests();
    clearPiPreview();
    resetScanner();
    clearTrackingState();
    const scanSession = scanSessionRef.current;
    if (source === CAMERA_SOURCES.PI) {
      const piReachable = await probePiReachable();
      if (scanSession !== scanSessionRef.current) return;
      if (piReachable) {
        stopCCTV();
        applyCameraSource(CAMERA_SOURCES.PI, CAMERA_STATUS_MESSAGES.PI_CONNECTED);
        changeScanState("SYSTEM_ACTIVE");
      } else {
        applyCameraSource(CAMERA_SOURCES.WEBCAM, CAMERA_STATUS_MESSAGES.PI_UNAVAILABLE);
        await startCCTV();
      }
    } else {
      applyCameraSource(CAMERA_SOURCES.WEBCAM, CAMERA_STATUS_MESSAGES.WEBCAM_ACTIVE);
      await startCCTV();
    }
  };

  const startCCTV = async () => {
    const scanSession = scanSessionRef.current;
    if (
      webcamStartPromiseRef.current &&
      webcamStartSessionRef.current === scanSession
    ) {
      return webcamStartPromiseRef.current;
    }
    // Guard: browser without camera API (insecure context / no webcam support)
    if (!navigator.mediaDevices?.getUserMedia) {
      changeScanState("HARDWARE_ERR");
      return;
    }
    const startPromise = (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 15, max: 20 },
            facingMode: "user"
          }
        });

        if (
          scanSession !== scanSessionRef.current ||
          cameraSourceRef.current !== CAMERA_SOURCES.WEBCAM
        ) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        stopCCTV();
        mediaStreamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          video.onloadedmetadata = () => {
            if (mediaStreamRef.current !== stream) return;
            video.play().catch(() => {
              if (mediaStreamRef.current === stream) changeScanState("HARDWARE_ERR");
            });
          };
        }
        changeScanState("SYSTEM_ACTIVE");
      } catch (err) {
        // Permission denied, no device, or device busy - surface it instead of a black feed.
        if (scanSession === scanSessionRef.current) {
          console.error("CCTV camera unavailable:", err);
          changeScanState("HARDWARE_ERR");
        }
      }
    })();

    webcamStartPromiseRef.current = startPromise;
    webcamStartSessionRef.current = scanSession;
    try {
      await startPromise;
    } finally {
      if (webcamStartPromiseRef.current === startPromise) {
        webcamStartPromiseRef.current = null;
        webcamStartSessionRef.current = null;
      }
    }
  };

  const stopCCTV = () => {
    const stream = mediaStreamRef.current || videoRef.current?.srcObject;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    mediaStreamRef.current = null;
    if (videoRef.current) {
      videoRef.current.onloadedmetadata = null;
      videoRef.current.srcObject = null;
    }
  };

  const scheduleScannerReset = (delayMs) => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => {
      resetTimerRef.current = null;
      resetScanner();
    }, delayMs);
  };

  const playFeedback = (type) => {
    const audioPath = type === 'success' ? '/sounds/success.mp3' : '/sounds/denied.mp3';
    const audio = new Audio(audioPath);
    audio.volume = 0.4;
    audio.play().catch(() => console.log("Audio waiting for user gesture"));
  };

  const grantFinalAccess = (verifiedUser) => {
    const subject = describeRecognitionSubject(verifiedUser);
    playFeedback('success');
    changeScanState("SECURE_MATCH");
    setIdentifiedUser(subject.identityLabel);
    setScanProgress(100);

    // Exactly one POST is made from this completed authoritative cycle. The
    // stable cycle id makes a retry idempotent, while a later completed cycle
    // receives its own persisted SecurityLog id and remains visible even in the
    // same displayed minute.
    const cycleId = createAccessCycleId();
    axios.post(ACCESS_EVENT_URL, {
      userId: verifiedUser.id,
      cameraLocation: CAMERA_LOCATION,
      cycleId
    }, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        const log = res.data?.logged ? res.data.log : null;
        if (!log?.id) return;
        const timelineLog = {
          ...log,
          role: verifiedUser.role,
          cameraSource: SOURCE_LABELS[cameraSourceRef.current] || null
        };
        setIncidentLogs((prev) => prev.some((existing) => existing.id === log.id)
          ? prev
          : [timelineLog, ...prev.slice(0, 14)]);
      })
      .catch((error) => {
        console.log('Access-event sync failed', error);
        setServiceNotice('Access was verified, but the audit event could not be saved. Retry when the service is available.');
      });

    scheduleScannerReset(3500);
  };

  // Capture one frame from the active camera source onto the given hidden
  // canvas and return it as a compressed JPEG data URL. The tracking loop uses
  // a small/cheap frame; the recognition loop keeps its existing sizing.
  const captureFrom = async (canvas, maxWidth, quality) => {
    if (!canvas) return null;
    const context = canvas.getContext('2d');

    if (cameraSourceRef.current === CAMERA_SOURCES.PI) {
      let bitmap;
      const scanSession = scanSessionRef.current;
      const requestController = new AbortController();
      piRequestControllersRef.current.add(requestController);
      try {
        bitmap = await fetchPiSnapshotBitmap({ signal: requestController.signal });
        piFailSinceRef.current = 0;
      } catch (error) {
        if (error?.code === 'aborted' || scanSession !== scanSessionRef.current) return null;
        // Pi snapshot failed mid-session - once failures persist past the
        // fallback window, switch to the webcam and cache the failure so the
        // Pi isn't re-probed on every cycle.
        const now = nowMs();
        if (!piFailSinceRef.current) {
          piFailSinceRef.current = now;
        } else if (now - piFailSinceRef.current >= PI_FAIL_FALLBACK_MS) {
          markPiUnavailable();
          applyCameraSource(CAMERA_SOURCES.WEBCAM, CAMERA_STATUS_MESSAGES.PI_UNAVAILABLE);
          await startCCTV();
        }
        return null;
      } finally {
        piRequestControllersRef.current.delete(requestController);
      }
      if (scanSession !== scanSessionRef.current || cameraSourceRef.current !== CAMERA_SOURCES.PI) {
        try { bitmap?.close?.(); } catch { /* ignore */ }
        return null;
      }
      drawBitmapToCanvasAndClose(bitmap, canvas, { maxWidth });
      return canvas.toDataURL('image/jpeg', quality);
    }

    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return null;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  };

  const captureFrameBase64 = () => captureFrom(canvasRef.current, CAPTURE_MAX_WIDTH, CAPTURE_JPEG_QUALITY);

  // ------------------------------------------------------------------
  // A. TRACKING LOOP — detection-only /track endpoint (no identity data).
  // Moves the on-screen box, detects presence and samples head-turn movement
  // at ~TRACK_INTERVAL_MS. It can never grant access by itself.
  // ------------------------------------------------------------------
  const performTrackingScan = async () => {
    if (pausedRef.current) return; // monitoring stopped by the operator
    if (trackingInFlightRef.current) return;
    const canvas = trackCanvasRef.current;
    if (!canvas) return;
    const status = scanStatusRef.current;
    if (status === "SECURE_MATCH" || status === "UNKNOWN_QUERY" || status === "AUTHORIZING" || status === "HARDWARE_ERR") return;

    trackingInFlightRef.current = true;
    const scanSession = scanSessionRef.current;
    try {
      const captureTimer = startTimer();
      const imageBase64 = await captureFrom(canvas, TRACK_MAX_WIDTH, TRACK_JPEG_QUALITY);
      const captureMs = captureTimer();
      if (!imageBase64) return;

      const requestTimer = startTimer();
      const res = await axios.post(TRACK_URL, { image: imageBase64 }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      // Stale response: camera source switched (or unmounted) mid-request.
      if (scanSession !== scanSessionRef.current) return;
      logTrackingTimings({ captureMs, requestMs: requestTimer(), inferenceMs: res.data?.inferenceMs });
      handleTrackingResult(res.data, canvas);
    } catch {
      // Tracking is best-effort; the recognition loop owns service-fault
      // messaging and backoff.
    } finally {
      trackingInFlightRef.current = false;
    }
  };

  const handleTrackingResult = (data, canvas) => {
    const { faceDetected, faceCount = 0, box, headTurnRatio } = data || {};
    const now = nowMs();

    if (faceDetected && Array.isArray(box) && box.length === 4) {
      lastFaceSeenAtRef.current = now;
      const frame = { width: canvas.width, height: canvas.height };
      // Smooth in frame space, then project onto the current container size so
      // preview/container resizes are handled on every tracking update.
      smoothedBoxRef.current = smoothBox(smoothedBoxRef.current, clampBoxToFrame(box, frame.width, frame.height));
      const containerEl = containerRef.current;
      const container = containerEl
        ? { width: containerEl.clientWidth, height: containerEl.clientHeight }
        : frame;
      const sb = smoothedBoxRef.current;
      setFaceBox(faceBoxStyle([sb.x, sb.y, sb.width, sb.height], frame, container, 'contain'));

      const ratio = headTurnRatio ?? null;
      if (ratio !== null) {
        recentRatiosRef.current = [...recentRatiosRef.current, ratio].slice(-LIVENESS_BASELINE_SAMPLES);
      }

      if (faceCount > 1) {
        const episode = multiFaceRef.current;
        if (!episode.since) {
          multiFaceRef.current = { since: now, abortedAuth: false, logged: false };
        }
        // Was an authorisation attempt in progress when this crowd appeared?
        // Only an aborted attempt is a security event, not idle passers-by.
        if (scanStatusRef.current === "TARGET_LOCKING" ||
            scanStatusRef.current === "LIVENESS_CHECK" ||
            lockPendingRef.current ||
            candidateUserRef.current) {
          multiFaceRef.current.abortedAuth = true;
        }
        // Never continue authorisation with more than one person in frame.
        abortAuthorizationForMultipleFaces();
        // Persisted long enough + aborted an attempt -> ONE denied audit event
        // per episode (never one per 250 ms tracking sample).
        if (multiFaceRef.current.abortedAuth &&
            !multiFaceRef.current.logged &&
            now - multiFaceRef.current.since >= MULTI_FACE_LOG_PERSIST_MS) {
          multiFaceRef.current.logged = true;
          recordDeniedSecurityEvent("MULTIPLE_FACES", null, null);
        }
        return;
      }
      setMultipleFacesNotice(false);
      if (multiFaceRef.current.since) {
        // Crowd cleared - close the episode so a later one can log again.
        multiFaceRef.current = { since: 0, abortedAuth: false, logged: false };
        deniedReportedRef.current.delete("MULTIPLE_FACES");
      }

      const status = scanStatusRef.current;

      if (status === "LIVENESS_CHECK") {
        const challenge = challengeRef.current;
        if (!challenge || !candidateUserRef.current) { resetScanner(); return; }
        const result = challenge.observe(ratio, now);
        logLivenessTelemetry({ baseline: result.baseline, current: ratio, delta: result.delta, consecutive: result.consecutive });
        // Progress comes ONLY from real tracking observations.
        setScanProgress(Math.min(96, Math.round((result.consecutive / challenge.requiredConsecutiveSamples) * 96)));
        if (result.state === CHALLENGE_STATE.TIMED_OUT) {
          failLivenessTimeout();
        } else if (result.state === CHALLENGE_STATE.PASSED) {
          runFinalConfirmation();
        }
        return;
      }

      if (status === "SYSTEM_ACTIVE" || status === "PRESENCE_DETECTED") {
        const proximityPct = (sb.width / frame.width) * 100;
        if (proximityPct < 5) {
          changeScanState("PRESENCE_DETECTED");
          setScanProgress(0);
        } else {
          changeScanState("TARGET_LOCKING");
        }
      }
      return;
    }

    // No face in this tracking sample.
    if (scanStatusRef.current === "LIVENESS_CHECK" && challengeRef.current) {
      const result = challengeRef.current.observe(null, now);
      if (result.state === CHALLENGE_STATE.TIMED_OUT) {
        failLivenessTimeout();
        return;
      }
    }
    // Retain the box through a brief miss, then clear it and rearm.
    if (lastFaceSeenAtRef.current && now - lastFaceSeenAtRef.current >= BOX_CLEAR_TIMEOUT_MS) {
      clearTrackingState();
      const status = scanStatusRef.current;
      if (status === "PRESENCE_DETECTED" || status === "TARGET_LOCKING" || status === "LIVENESS_CHECK") {
        // Person left the frame — fail closed and return to monitoring.
        resetScanner();
      }
    }
  };

  const abortAuthorizationForMultipleFaces = () => {
    if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    lockPendingRef.current = false;
    candidateUserRef.current = null;
    challengeRef.current = null;
    setScanProgress(0);
    setMultipleFacesNotice(true);
    changeScanState("PRESENCE_DETECTED");
  };

  // ------------------------------------------------------------------
  // B. FULL RECOGNITION LOOP — identity only, ~once per SCAN_INTERVAL_MS,
  // and ONLY while identification is needed (TARGET_LOCKING). Once a
  // candidate is secured it stops until the final confirmation.
  // ------------------------------------------------------------------
  const performRecognitionScan = async () => {
    if (pausedRef.current) return; // monitoring stopped by the operator
    const gate = recognitionInFlightRef.current;
    // No overlapping requests; short backoff after a recognition-service failure.
    if (!gate.canScan()) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (scanStatusRef.current !== "TARGET_LOCKING" || lockPendingRef.current) return;

    gate.begin();
    const totalTimer = startTimer();
    const scanSession = scanSessionRef.current;

    try {
      const captureTimer = startTimer();
      const imageBase64 = await captureFrameBase64();
      const captureMs = captureTimer();
      if (!imageBase64) return;

      const apiTimer = startTimer();
      const res = await axios.post(RECOGNIZE_URL,
        { image: imageBase64, cameraLocation: CAMERA_LOCATION },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      // Stale response: camera source switched (or unmounted) mid-request.
      if (scanSession !== scanSessionRef.current) return;
      logScanTimings({
        captureMs,
        apiMs: apiTimer(),
        totalMs: totalTimer(),
        serverTimings: res.data?.timings
      });
      setServiceNotice('');

      if (scanStatusRef.current !== "TARGET_LOCKING" || lockPendingRef.current) return;

      const recognizedUser = res.data?.user;
      if (!recognizedUser) return; // presence/no-face resets belong to the tracking loop

      // TARGET LOCKING SEQUENCE — one decision per lock window.
      lockPendingRef.current = true;
      setScanProgress(12);
      let progress = 12;
      progressIntervalRef.current = setInterval(() => {
        progress += Math.floor(Math.random() * 14) + 4;
        if (progress >= 96) {
          setScanProgress(96);
          clearInterval(progressIntervalRef.current);
        } else {
          setScanProgress(progress);
        }
      }, 120);

      lockTimerRef.current = setTimeout(() => {
        clearInterval(progressIntervalRef.current);
        lockPendingRef.current = false;
        resolveCandidateDecision(recognizedUser);
      }, TARGET_LOCK_MS);
    } catch (err) {
      // Node/FastAPI unavailable - back off instead of flooding the endpoint.
      // The camera preview keeps running; webcam fallback is ONLY for Pi failure.
      console.error("AI Command Loop Fault:", err);
      recognitionInFlightRef.current.applyBackoff();
      setServiceNotice(SERVICE_UNAVAILABLE_MSG);
    } finally {
      recognitionInFlightRef.current.end();
    }
  };

  const resolveCandidateDecision = (recognizedUser) => {
    if (scanStatusRef.current !== "TARGET_LOCKING") return;

    const currentTimestamp = nowMs();
    const logTimeStr = new Date(currentTimestamp).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

    if (recognizedUser && recognizedUser.status === RECOGNITION_STATUS.AUTHORIZED) {
      candidateUserRef.current = recognizedUser;
      // Baseline = median of up to three recent valid tracking ratios; the
      // challenge then requires sustained CHANGE from that baseline.
      challengeRef.current = createHeadTurnChallenge({
        initialSamples: recentRatiosRef.current,
      });
      setScanProgress(0);
      changeScanState("LIVENESS_CHECK");
    } else {
      // Suspended or unknown - the Node backend has already written the
      // deduplicated SecurityLog; the client only updates its local timeline.
      const isSuspended = recognizedUser && recognizedUser.status === RECOGNITION_STATUS.SUSPENDED;
      const subject = describeRecognitionSubject(recognizedUser);

      playFeedback('denied');
      changeScanState("UNKNOWN_QUERY");
      setIdentifiedUser(isSuspended ? `${subject.identityLabel} - SUSPENDED` : "UNKNOWN PERSONNEL");
      setScanProgress(0);

      const dedupName = isSuspended ? recognizedUser.name : "UNKNOWN";
      if (lastLogRef.current.name !== dedupName || (currentTimestamp - lastLogRef.current.timestamp > 10000)) {
        const newLog = {
          id: `SEC-${currentTimestamp}`,
          // New event happening right now - stamped at detection time.
          occurredAt: new Date(currentTimestamp).toISOString(),
          time: logTimeStr,
          type: isSuspended ? 'Suspended Access Attempt' : 'Intrusion Alert',
          desc: isSuspended
            ? `Suspended account denied at gantry: ${subject.identityLabel}.`
            : 'Unregistered personnel detected at gantry.',
          severity: 'critical',
          icon: isSuspended ? 'DENIED' : 'ALERT',
          personnelName: isSuspended ? recognizedUser.name : null,
          role: isSuspended ? recognizedUser.role : null,
          confidence: recognizedUser ? recognizedUser.confidence : null,
          cameraLocation: CAMERA_LOCATION,
          cameraSource: SOURCE_LABELS[cameraSourceRef.current] || null
        };

        setIncidentLogs(prev => [newLog, ...prev.slice(0, 14)]);
        lastLogRef.current = { name: dedupName, timestamp: currentTimestamp };
      }

      scheduleScannerReset(3500);
    }
  };

  // ------------------------------------------------------------------
  // DENIED-OUTCOME AUDIT — posts the FINAL denied outcome (identity mismatch,
  // liveness timeout, persistent multi-face abort) to the server-owned
  // /denied-event endpoint, then prepends the REAL database record into the
  // timeline. Strictly non-fatal: the red fail-closed UI never waits on it,
  // and it can never grant access. Unknown/suspended recognition outcomes are
  // NOT sent here — /recognize already writes those logs itself.
  // ------------------------------------------------------------------
  const recordDeniedSecurityEvent = async (reason, candidate = null, confidence = null) => {
    if (deniedReportedRef.current.has(reason)) return; // once per scanner cycle
    deniedReportedRef.current.add(reason);
    const scanSession = scanSessionRef.current;
    try {
      const res = await axios.post(DENIED_EVENT_URL, {
        reason,
        candidateUserId: candidate?.id ?? null,
        cameraLocation: CAMERA_LOCATION,
        confidence: typeof confidence === 'number' ? confidence : null
      }, { headers: { Authorization: `Bearer ${token}` } });
      // Stale response: camera source switched (or unmounted) mid-request.
      if (scanSession !== scanSessionRef.current) return;
      const log = res.data?.logged ? res.data.log : null; // deduplicated -> nothing to add
      if (log?.id) {
        // Prepend the server-created record exactly once per database ID.
        setIncidentLogs(prev => prev.some(existing => existing.id === log.id)
          ? prev
          : [log, ...prev.slice(0, 14)]);
      }
    } catch (err) {
      // Audit sync is best-effort; the denied UI outcome already stands.
      console.log("Denied-event sync failed", err);
    }
  };

  // Liveness timeout: fail closed — no access event is ever recorded from an
  // unconfirmed challenge.
  const failLivenessTimeout = () => {
    const candidate = candidateUserRef.current;
    recordDeniedSecurityEvent("LIVENESS_TIMEOUT", candidate, candidate?.confidence ?? null);
    candidateUserRef.current = null;
    challengeRef.current = null;
    setScanProgress(0);
    playFeedback('denied');
    changeScanState("UNKNOWN_QUERY");
    setIdentifiedUser("LIVENESS TIMEOUT — NOT CONFIRMED");
    scheduleScannerReset(3500);
  };

  // ------------------------------------------------------------------
  // FINAL SAME-IDENTITY CONFIRMATION — the lightweight tracker never grants
  // access. After the head-turn passes, one final full recognition must match
  // the ORIGINAL candidate user ID (and still be AUTHORIZED) before the
  // access event is recorded. Anything else fails closed.
  // ------------------------------------------------------------------
  const runFinalConfirmation = async () => {
    const candidate = candidateUserRef.current;
    if (!candidate || finalizingRef.current) return;
    finalizingRef.current = true;
    challengeRef.current = null;
    changeScanState("AUTHORIZING");
    const scanSession = scanSessionRef.current;

    try {
      const imageBase64 = await captureFrameBase64();
      if (!imageBase64) { failFinalConfirmation(); return; }
      const res = await axios.post(RECOGNIZE_URL,
        { image: imageBase64, cameraLocation: CAMERA_LOCATION },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (scanSession !== scanSessionRef.current) return;

      const finalUser = res.data?.user;
      if (
        finalUser &&
        finalUser.id != null &&
        finalUser.id === candidate.id &&
        finalUser.status === RECOGNITION_STATUS.AUTHORIZED
      ) {
        grantFinalAccess(candidate);
      } else {
        // Identity differs, disappeared, unknown or suspended — fail closed.
        failFinalConfirmation();
      }
    } catch (err) {
      console.error("Final identity confirmation failed:", err);
      failFinalConfirmation();
    } finally {
      finalizingRef.current = false;
    }
  };

  const failFinalConfirmation = () => {
    // Retain the original candidate's id/confidence for the audit BEFORE the
    // fail-closed reset clears them.
    const candidate = candidateUserRef.current;
    recordDeniedSecurityEvent("FINAL_IDENTITY_MISMATCH", candidate, candidate?.confidence ?? null);
    candidateUserRef.current = null;
    challengeRef.current = null;
    setScanProgress(0);
    playFeedback('denied');
    changeScanState("UNKNOWN_QUERY");
    setIdentifiedUser("IDENTITY NOT CONFIRMED");
    scheduleScannerReset(3500);
  };

  // Frontend filtering of the loaded timeline records (PoC).
  const activeFilters = { dateRange: dateFilter, eventType: eventFilter, search: searchFilter };
  const filteredLogs = filterSecurityLogs(incidentLogs, activeFilters);

  const resetScanner = () => {
    if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    lockTimerRef.current = null;
    progressIntervalRef.current = null;
    resetTimerRef.current = null;
    lockPendingRef.current = false;
    setIdentifiedUser(null);
    setFaceBox(null);
    smoothedBoxRef.current = null;
    setScanProgress(0);
    setMultipleFacesNotice(false);
    candidateUserRef.current = null;
    challengeRef.current = null;
    deniedReportedRef.current.clear(); // new scanner cycle -> denied audit re-armed
    changeScanState("SYSTEM_ACTIVE");
  };

  // Stop / restart the automatic recognition loops (patrol control). Stopping
  // clears any in-progress lock and returns the gantry to idle.
  const toggleMonitoring = () => {
    const next = !pausedRef.current;
    pausedRef.current = next;
    setMonitoringPaused(next);
    if (next) {
      resetScanner();
      setServiceNotice('Monitoring stopped. Use “Run Single Check” or resume.');
    } else {
      setServiceNotice('');
    }
  };

  // Manual single check: identify whoever is in frame WITHOUT the access-grant /
  // liveness flow — V-Patrol only monitors, so this just reports the current
  // identity. Uses the shared scan gate, so it never overlaps another request.
  const runSingleCheck = async () => {
    const gate = recognitionInFlightRef.current;
    if (!gate.canScan()) return;
    gate.begin();
    const scanSession = scanSessionRef.current;
    try {
      const imageBase64 = await captureFrameBase64();
      if (!imageBase64) { setServiceNotice('No frame captured — check the camera source.'); return; }
      const res = await axios.post(RECOGNIZE_URL,
        { image: imageBase64, cameraLocation: CAMERA_LOCATION },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (scanSession !== scanSessionRef.current) return;
      const user = res.data?.user;
      const subject = describeRecognitionSubject(user);
      const label = user ? subject.identityLabel : 'No match';
      setIdentifiedUser(user ? subject.identityLabel : 'UNKNOWN PERSONNEL');
      setServiceNotice(`Manual check via ${SOURCE_LABELS[cameraSourceRef.current] || 'camera'}: ${label}`);
    } catch {
      setServiceNotice(SERVICE_UNAVAILABLE_MSG);
    } finally {
      gate.end();
    }
  };

  const initializeCamera = useEffectEvent(async () => {
    await initCameraSource();
  });

  const loadIncidentTimeline = useEffectEvent(async (signal) => {
    try {
      const res = await axios.get(NODE_SERVER_URL, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
      if (signal.aborted) return;
      if (res.data && res.data.length > 0) {
        setIncidentLogs(res.data);
      } else {
        setIncidentLogs([{
          id: 'SYS-001',
          occurredAt: new Date(nowMs()).toISOString(),
          type: 'System Online',
          desc: 'Biometric sensors initialized.',
          severity: 'safe',
          icon: 'OK'
        }]);
      }
    } catch (err) {
      if (signal.aborted) return;
      console.error("Database connection waiting...", err);
      setIncidentLogs([{
        id: 'SYS-001',
        occurredAt: new Date(nowMs()).toISOString(),
        type: 'System Offline',
        desc: 'Cannot connect to security database.',
        severity: 'critical',
        icon: 'WARNING'
      }]);
    }
  });

  const runTrackingScan = useEffectEvent(() => {
    void performTrackingScan();
  });

  const runRecognitionScan = useEffectEvent(() => {
    void performRecognitionScan();
  });

  const releaseCamera = useEffectEvent(() => {
    stopCCTV();
  });

  useEffect(() => {
    const controller = new AbortController();
    const initialize = async () => {
      await Promise.all([
        initializeCamera(),
        loadIncidentTimeline(controller.signal),
      ]);
    };

    void initialize();
    const clockInterval = setInterval(() => {
      setSystemTime(new Date().toLocaleTimeString('en-SG', {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
      }));
    }, 1000);
    const trackInterval = setInterval(runTrackingScan, TRACK_INTERVAL_MS);
    const scanInterval = setInterval(runRecognitionScan, SCAN_INTERVAL_MS);

    return () => {
      controller.abort();
      scanSessionRef.current += 1;
      clearInterval(clockInterval);
      clearInterval(trackInterval);
      clearInterval(scanInterval);
      if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      abortActivePiRequests();
      clearPiPreview();
      releaseCamera();
    };
  }, []);

  return (
    <div className="dashboard-layout">
      <Sidebar />
      <main className="dashboard-main vpatrol-main">
        <header className="dashboard-header">
          <div className="header-titles">
            <h1>V-Patrol AI Command Center</h1>
            <p>Real-time biometric gantry and anomaly detection timeline</p>
          </div>
        </header>

        <section className="camera-control-panel" aria-label="V-Patrol camera controls">
          <div className="camera-control-row">
          <span className="camera-control-label">Camera Source:</span>
          <button
            type="button"
            className={`camera-control-btn ${cameraSource === CAMERA_SOURCES.PI ? 'active' : ''}`}
            onClick={() => selectCameraSource(CAMERA_SOURCES.PI)}
            aria-pressed={cameraSource === CAMERA_SOURCES.PI}
          >
            Raspberry Pi Camera Module 3
          </button>
          <button
            type="button"
            className={`camera-control-btn ${cameraSource === CAMERA_SOURCES.WEBCAM ? 'active' : ''}`}
            onClick={() => selectCameraSource(CAMERA_SOURCES.WEBCAM)}
            aria-pressed={cameraSource === CAMERA_SOURCES.WEBCAM}
          >
            Laptop Webcam
          </button>
          <button
            type="button"
            className="camera-control-btn"
            onClick={runSingleCheck}
          >
            Run Single Check
          </button>
          <button
            type="button"
            className={`camera-control-btn ${monitoringPaused ? 'resume' : ''}`}
            onClick={toggleMonitoring}
          >
            {monitoringPaused ? 'Resume Monitoring' : 'Stop Monitoring'}
          </button>
          </div>
          <p className="camera-status-line" role="status">{cameraStatusMsg}</p>
          {serviceNotice && (
            <p className="camera-status-line camera-service-notice" role="status">{serviceNotice}</p>
          )}
        </section>

        <div className="vpatrol-grid">
          <div className="vpatrol-card monitor-section">
            <div ref={containerRef} className={`cctv-container state-theme-${scanStatus.toLowerCase()}`} style={{ width: '100%', height: '100%' }}>
              {cameraSource === CAMERA_SOURCES.PI && PI_CAMERA_STREAM_URL && (
                <img
                  ref={piPreviewRef}
                  src={PI_CAMERA_STREAM_URL}
                  alt="Raspberry Pi gate camera live preview"
                  className="video-feed"
                />
              )}
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="video-feed"
                style={cameraSource === CAMERA_SOURCES.PI ? { display: 'none' } : undefined}
              />
              <canvas ref={canvasRef} style={{ display: 'none' }} />
              <canvas ref={trackCanvasRef} style={{ display: 'none' }} />

              {scanStatus === "HARDWARE_ERR" && (
                <div className="camera-error-overlay" style={{
                  position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', textAlign: 'center',
                  background: 'rgba(15,23,42,0.92)', color: '#e2e8f0', padding: '24px', zIndex: 5
                }}>
                  <SafeMuiIcon icon={VideocamOffIcon} style={{ fontSize: 40 }} aria-hidden="true" />
                  <h3 style={{ margin: '10px 0 4px' }}>Camera unavailable</h3>
                  <p style={{ color: '#94a3b8', maxWidth: 360 }}>
                    Allow camera access in your browser, close other apps using the webcam, then
                    reload. If this device has no camera, the live patrol feed can't run here.
                  </p>
                  <button
                    onClick={startCCTV}
                    style={{ marginTop: 12, padding: '8px 16px', borderRadius: 8, border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0', cursor: 'pointer' }}
                  >
                    Retry camera
                  </button>
                </div>
              )}

              {faceBox && (
                <div
                  className={`face-tracking-box state-${scanStatus.toLowerCase()}`}
                  style={{
                    top: faceBox.top,
                    left: faceBox.left,
                    width: faceBox.width,
                    height: faceBox.height,
                    transition: 'top 100ms linear, left 100ms linear, width 100ms linear, height 100ms linear'
                  }}
                >
                  <div className="corner-bracket top-left"></div>
                  <div className="corner-bracket top-right"></div>
                  <div className="corner-bracket bottom-left"></div>
                  <div className="corner-bracket bottom-right"></div>

                  {scanStatus === "TARGET_LOCKING" && <div className="matrix-scan-line"></div>}

                  <div className="box-identity-panel">
                    <span className="access-status-label">
                      {scanStatus === "TARGET_LOCKING" && `ANALYZING: ${scanProgress}%`}
                      {scanStatus === "LIVENESS_CHECK" && "MOTION LIVENESS ACTIVE"}
                      {scanStatus === "AUTHORIZING" && "CONFIRMING IDENTITY"}
                      {scanStatus === "SECURE_MATCH" && "GRANT ACCESS"}
                      {scanStatus === "UNKNOWN_QUERY" && "ACCESS DENIED"}
                    </span>
                    <span className="person-name-label">
                      {multipleFacesNotice && "MULTIPLE FACES DETECTED — ONE PERSON AT A TIME"}
                      {!multipleFacesNotice && scanStatus === "TARGET_LOCKING" && "LOCKING VECTORS..."}
                      {!multipleFacesNotice && scanStatus === "LIVENESS_CHECK" && "TURN HEAD SLIGHTLY AND HOLD"}
                      {!multipleFacesNotice && scanStatus === "AUTHORIZING" && "HOLD STILL"}
                      {!multipleFacesNotice && scanStatus === "SECURE_MATCH" && identifiedUser}
                      {!multipleFacesNotice && scanStatus === "UNKNOWN_QUERY" && (identifiedUser || "SUSPICIOUS ACTIVITY")}
                    </span>
                  </div>
                </div>
              )}

              <div className="hud-overlay">
                <div className="hud-top">
                  <div className="hud-left-meta">
                    <span className="hud-node">SYS_MODE // BIOMETRIC_GANTRY</span>
                    {scanStatus === "PRESENCE_DETECTED" && (
                      <span className="hud-radar-alert">
                        {multipleFacesNotice ? "MULTIPLE FACES DETECTED" : "PROXIMITY SIGNAL DETECTED"}
                      </span>
                    )}
                  </div>
                  <span className={`hud-status-badge status-${scanStatus.toLowerCase()}`}>
                    {scanStatus === "SYSTEM_ACTIVE" && "IDLE MONITORING"}
                    {scanStatus === "PRESENCE_DETECTED" && "MOTION ACQUIRED"}
                    {scanStatus === "TARGET_LOCKING" && "VECTOR LOCK ACTIVE"}
                    {scanStatus === "LIVENESS_CHECK" && "HEAD-TURN VERIFICATION"}
                    {scanStatus === "AUTHORIZING" && "FINAL IDENTITY CHECK"}
                    {scanStatus === "SECURE_MATCH" && "SUCCESS MATCH"}
                    {scanStatus === "UNKNOWN_QUERY" && "ALERT WARNING"}
                  </span>
                </div>

                <div className="hud-bottom">
                  <div className="hud-coordinates-telemetry">
                    <p>LAT: 1.3521 N // LON: 103.8198 E</p>
                    <p className="hud-engine-log">MATRIX_ENGINE: ACTIVE_v3.42</p>
                  </div>
                  <p className="hud-clock">{systemTime}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="vpatrol-card timeline-section">
            <div className="section-header">
              <h2>Security Timeline</h2>
            </div>

            {/* Compact filter row - dropdowns + search, frontend filtering only */}
            <div className="timeline-filters">
              <select
                className="timeline-filter"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                aria-label="Filter by date"
              >
                {DATE_FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
              <select
                className="timeline-filter"
                value={eventFilter}
                onChange={(e) => setEventFilter(e.target.value)}
                aria-label="Filter by event type"
              >
                {EVENT_FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
              <input
                type="text"
                className="timeline-filter timeline-search"
                placeholder="Search name / role / location..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                aria-label="Search timeline"
              />
              {hasActiveFilters(activeFilters) && (
                <button
                  type="button"
                  className="timeline-clear-btn"
                  onClick={() => { setDateFilter('all'); setEventFilter('all'); setSearchFilter(''); }}
                >
                  Clear Filters
                </button>
              )}
            </div>

            <div className="vpatrol-list">
              {incidentLogs.length === 0 ? (
                <p>Initializing security sensors...</p>
              ) : filteredLogs.length === 0 ? (
                <div className="timeline-empty">
                  <p>No security events match the current filters.</p>
                  <button
                    type="button"
                    className="timeline-clear-btn"
                    onClick={() => { setDateFilter('all'); setEventFilter('all'); setSearchFilter(''); }}
                  >
                    Clear Filters
                  </button>
                </div>
              ) : filteredLogs.map((log) => {
                const accessResult = deriveAccessResult(log);
                const timestamp = getLogTimestamp(log);
                const timeLabel = formatSingaporeTimestamp(timestamp) || log.time || 'Unknown time';
                const confidencePct = typeof log.confidence === 'number'
                  ? `${Math.round(log.confidence * 100)}%` : null;
                return (
                  <div key={log.id} className={`vpatrol-item ${log.severity}`}>
                    {/* Primary: event, person, outcome */}
                    <div className="item-body">
                      <div className="item-icon"><SecurityLogIcon log={log} /></div>
                      <div className="item-text">
                        <div className="item-title-row">
                          <h4>{log.type}</h4>
                          <span className={`access-result-badge result-${accessResult.toLowerCase()}`}>
                            {accessResult}
                          </span>
                        </div>
                        <p className="item-person">
                          {log.personnelName || 'Unknown Person'}
                          {log.role ? <span className="item-role"> | {log.role}</span> : null}
                        </p>
                        <p className="item-meta" title={formatSingaporeFull(timestamp) || undefined}>
                          {timeLabel}
                          {confidencePct ? ` | ${confidencePct} confidence` : ''}
                          {log.cameraLocation ? ` | ${log.cameraLocation}` : ''}
                          {log.cameraSource ? ` | ${log.cameraSource}` : ''}
                        </p>
                        <p className="item-desc">{log.desc}</p>
                      </div>
                    </div>
                    {/* Secondary: muted UUID + review status */}
                    <div className="item-footer-muted">
                      <span className="item-id-muted">#{log.id}</span>
                      {log.reviewStatus ? <span className="item-review-status">{log.reviewStatus}</span> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default VPatrol;
