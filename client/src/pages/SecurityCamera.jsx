import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router';
import Sidebar from '../components/Sidebar';
import {
  SECUREPI_CONNECTION_STATUS,
  clearSecurePiStreamOverride,
  getHardwarePeopleCountUrl,
  getHardwareStreamUrl,
  readSecurePiStreamOverride,
  saveSecurePiStreamOverride,
  testSecurePiConnection,
} from '../utils/securepiStream';
import { validateVideoFile, createTemporaryObjectUrl, revokeTemporaryObjectUrl } from '../utils/mediaPreview';
import { buildAnalyzeFramePayload, buildBearerHeaders } from '../utils/analyzeFrame';
import { resolveAlertSource } from '../utils/alertSource';
import { API_BASE_URL } from '../constants/api';
import '../css/Dashboard.css';
import '../css/ObjectDetection.css';

const ZONES_URL = '/api/zones';
const CAMERAS_URL = '/api/cameras';
const ALERTS_URL = '/api/detection-alerts';
// YOLO endpoints are served by the Node backend, which proxies to the PRIVATE
// AI service with service-to-service auth — the browser never calls FastAPI
// directly (the old '/ai/...' Vite/Nginx passthrough is gone).
const PEOPLE_URL = '/api/yolo/people-count';
const ANALYZE_FRAME_URL = '/api/yolo/analyze-frame';
const OPEN_ALERT_STATUSES = ['Active', 'Acknowledged', 'Investigating', 'Escalated', 'Dispatched'];
const SECUREPI_STREAM_URL = import.meta.env.VITE_SECUREPI_STREAM_URL || '';
const SECUREPI_POLL_MS = 5000;
const SECUREPI_FIRST_FRAME_TIMEOUT_MS = 8000;

const emptySecurePiConnection = () => ({ status: 'idle', message: '', details: null, fallback: false });

const securePiFailureMessage = (status) => {
  if (status === SECUREPI_CONNECTION_STATUS.TIMEOUT) return 'SecurePi connection timed out';
  if (status === SECUREPI_CONNECTION_STATUS.PERMISSION_REQUIRED) return 'Local Network Access permission required';
  if (status === SECUREPI_CONNECTION_STATUS.INVALID_RESPONSE) return 'Invalid SecurePi response';
  if (status === SECUREPI_CONNECTION_STATUS.INVALID_URL) return 'The selected camera does not have a valid SecurePi stream URL';
  return 'SecurePi unreachable from this network';
};

const Icon = ({ name }) => <span className={`od-icon od-icon-${name}`} aria-hidden="true" />;

const alertSource = (alert) => alert?.source || 'Security Camera';

// Readable titles for every alert family, including the SecurePi edge types
// (pest / restricted-zone motion / forgotten belonging / item movement). The key
// is resolved from alert_type first, then a text heuristic on alert_type+object_class.
const ALERT_TYPE_LABELS = {
  PEST_DETECTION: 'Pest detected',
  UNATTENDED_OBJECT: 'Unattended pallet/object detected',
  FORGOTTEN_BELONGING: 'Forgotten belonging detected',
  RESTRICTED_MOTION: 'Restricted-zone motion detected',
  ITEM_PICKED_UP: 'Item picked up',
  ITEM_SET_DOWN: 'Item set down',
  ITEM_MOVEMENT: 'Item movement detected',
  OVERCROWDING: 'Crowd density threshold exceeded',
};
const normalizeAlertKey = (value) => String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
const alertTypeKey = (alert) => {
  const key = normalizeAlertKey(alert?.alert_type);
  if (key === 'RESTRICTED_ZONE_MOTION') return 'RESTRICTED_MOTION';
  if (ALERT_TYPE_LABELS[key]) return key;
  const hay = `${alert?.alert_type || ''} ${alert?.object_class || ''}`.toLowerCase();
  if (/\b(rat|mouse|mice|rodent|pest)\b/.test(hay)) return 'PEST_DETECTION';
  if (/motion/.test(hay) && /(restricted|after|night)/.test(hay)) return 'RESTRICTED_MOTION';
  if (/forgotten|belonging/.test(hay)) return 'FORGOTTEN_BELONGING';
  if (/picked up|set down|item mov/.test(hay)) return 'ITEM_MOVEMENT';
  if (/crowd/.test(hay)) return 'OVERCROWDING';
  if (/unattended/.test(hay)) return 'UNATTENDED_OBJECT';
  return '';
};
const alertTitle = (alert) => {
  if (!alert) return '';
  const key = alertTypeKey(alert);
  if (key && ALERT_TYPE_LABELS[key]) return ALERT_TYPE_LABELS[key];
  const rawTitle = String(alert.object_class || alert.alert_type || 'Detection Alert').replace(/^(Critical|Warning):\s*/i, '');
  return /detect/i.test(rawTitle) ? rawTitle : `${rawTitle} Detected`;
};

// Only a valid remote http(s) URL is safe to render as a clickable snapshot link.
// A Raspberry Pi local path (runtime/snapshots/...) must NEVER be turned into an
// href — it isn't reachable from a browser and could be a misleading dead link.
const isRemoteSnapshot = (url) => typeof url === 'string' && /^https?:\/\//i.test(url.trim());
const isProtectedSnapshot = (url) => typeof url === 'string' && /^\/api\/detection-alerts\/\d+\/snapshot\/[^/]+$/i.test(url.trim());
const snapshotRequestUrl = (url) => `${API_BASE_URL}${url}`;

// WhatsApp security-alert notification status (persisted on the alert by the edge route).
const whatsappStatusOf = (alert) => alert?.whatsapp_status || 'Not Requested';
const whatsappStatusClass = (status) => `od-wa-pill od-wa-${String(status || 'Not Requested').replace(/\s+/g, '-').toLowerCase()}`;

// Confidence may arrive as a 0–1 float or an already-scaled percentage.
const confidencePercent = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  return Math.round(n <= 1 ? n * 100 : n);
};
const alertTimestamp = (alert) => {
  const raw = alert?.occurred_at || alert?.createdAt || alert?.timestamp;
  if (!raw) return 'n/a';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return 'n/a';
  return date.toLocaleString('en-SG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
};

const parseSensorMetadata = (alert) => {
  const raw = alert?.sensor_metadata ?? alert?.sensorMetadata ?? null;
  if (!raw) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
};

const sensorLabel = (value) => {
  if (value === true) return 'ACTIVE';
  if (value === false) return 'CLEAR';
  if (value === undefined || value === null || value === '') return 'Awaiting edge metadata';
  return String(value);
};

const distanceLabel = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? `${Math.round(n)} cm` : 'Awaiting edge metadata';
};

const identityLabel = (alert) => {
  const rawStatus = alert?.identity_status
    || alert?.identityStatus
    || alert?.sensor_metadata?.identity_status
    || alert?.sensorMetadata?.identity_status
    || '';
  const name = alert?.person_name
    || alert?.personName
    || alert?.sensor_metadata?.person_name
    || alert?.sensorMetadata?.person_name;
  if (name && String(name).trim().toUpperCase() !== 'UNKNOWN') {
    return rawStatus ? `${name} (${rawStatus})` : name;
  }
  if (rawStatus) return rawStatus === 'UNKNOWN' ? 'Unknown Person' : rawStatus;
  if (name && String(name).trim().toUpperCase() === 'UNKNOWN') return 'Unknown Person';
  return 'Awaiting facial recognition';
};

const classificationLabel = (alert) => (
  alert?.classification
  || alert?.security_classification
  || alert?.identity_status
  || alert?.identityStatus
  || alert?.sensor_metadata?.identity_status
  || alert?.sensorMetadata?.identity_status
  || alert?.alert_type
  || 'Awaiting edge classification'
);

const computeHumanDisplayBox = (personBox, faceCropBox) => {
  if (!Array.isArray(personBox) || personBox.length < 4) return personBox;
  const [pX1, pY1, pX2, pY2] = personBox;
  const pW = Math.max(1, pX2 - pX1);
  const pH = Math.max(1, pY2 - pY1);

  if (Array.isArray(faceCropBox) && faceCropBox.length === 4) {
    const [fX, fY, fW, fH] = faceCropBox;
    const fullX1 = Math.max(pX1, Math.min(pX2, pX1 + fX));
    const fullY1 = Math.max(pY1, Math.min(pY2, pY1 + fY));
    const fullX2 = Math.max(fullX1, Math.min(pX2, fullX1 + fW));
    const fullY2 = Math.max(fullY1, Math.min(pY2, fullY1 + fH));
    return [fullX1, fullY1, fullX2, fullY2];
  }

  // Fallback head-region approximation (upper 35% of person height, 20% horizontal inset on each side)
  const padX = pW * 0.2;
  const fX1 = pX1 + padX;
  const fX2 = Math.max(fX1 + 10, pX2 - padX);
  const fY1 = pY1;
  const fY2 = Math.max(fY1 + 10, pY1 + pH * 0.35);
  return [fX1, fY1, fX2, fY2];
};


const SecurityCamera = () => {
  const [zones, setZones] = useState([]);
  const [cameras, setCameras] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [alerts, setAlerts] = useState([]);
  const [peopleCount, setPeopleCount] = useState(0);
  const [detectionActive, setDetectionActive] = useState(false);
  const [workflowMessage, setWorkflowMessage] = useState('');
  const [alertActionBusy, setAlertActionBusy] = useState(false);
  const [selectedAlertId, setSelectedAlertId] = useState(null);
  const [alertsRefreshing, setAlertsRefreshing] = useState(false);
  const [alertTypeFilter, setAlertTypeFilter] = useState('all');
  const [alertSeverityFilter, setAlertSeverityFilter] = useState('all');
  const [snapshotPreview, setSnapshotPreview] = useState({ url: '', source: '', error: false });

  const [streamError, setStreamError] = useState(false);
  const [aiOffline, setAiOffline] = useState(false);
  const [nodeOffline, setNodeOffline] = useState(false);
  const [cameraStatus, setCameraStatus] = useState('starting');
  const [detections, setDetections] = useState([]);
  const [frameSize, setFrameSize] = useState({ width: 640, height: 480 });
  const [browserCameraError, setBrowserCameraError] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [sourceMode, setSourceMode] = useState('camera');
  const [uploadedVideoUrl, setUploadedVideoUrl] = useState('');
  const [uploadedVideoName, setUploadedVideoName] = useState('');
  const [securePiConnection, setSecurePiConnection] = useState(emptySecurePiConnection);
  const [securePiOverrideInput, setSecurePiOverrideInput] = useState('');
  const [securePiOverrideUrl, setSecurePiOverrideUrl] = useState('');
  const [securePiOverrideMessage, setSecurePiOverrideMessage] = useState('');
  const [inspectionCycleActiveState, setInspectionCycleActiveState] = useState(false);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const processingFrameRef = useRef(false);
  const aiHealthFailuresRef = useRef(0);
  const mountedRef = useRef(false);
  const securePiProbeControllerRef = useRef(null);
  const securePiPollControllerRef = useRef(null);
  const securePiPollInFlightRef = useRef(false);
  const unsupportedPeopleCountUrlsRef = useRef(new Set());
  const currentInspectionCycleRef = useRef(null);
  const prevInspectionActiveRef = useRef(false);
  const lastHandledCycleIdRef = useRef(null);
  const trackRecognitionRef = useRef(new Map());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const token = localStorage.getItem('accessToken');
  // Memoised so the fetch callbacks below can list `headers` as a stable
  // dependency without being recreated (and re-polling) on every render.
  const headers = useMemo(() => buildBearerHeaders(token), [token]);

  const fetchZones = useCallback(() => {
    axios.get(ZONES_URL, { headers })
      .then(res => {
        if (!mountedRef.current) return;
        setZones(res.data);
        setNodeOffline(false);
      })
      .catch(() => {
        if (mountedRef.current) setNodeOffline(true);
      });
  }, [headers]);

  const fetchCameras = useCallback(() => {
    axios.get(CAMERAS_URL, { headers })
      .then(res => {
        if (!mountedRef.current) return;
        const list = Array.isArray(res.data) ? res.data : [];
        setCameras(list);
        setSelectedCameraId((prev) => (list.some((cam) => String(cam.id) === String(prev)) ? prev : (list[0]?.id ?? '')));
      })
      .catch(() => {
        if (mountedRef.current) setCameras([]);
      });
  }, [headers]);

  const fetchAlerts = useCallback(() => {
    axios.get(ALERTS_URL, { headers })
      .then(res => {
        if (!mountedRef.current) return;
        setAlerts(res.data);
        setNodeOffline(false);
      })
      .catch(() => {
        if (mountedRef.current) setNodeOffline(true);
      });
  }, [headers]);

  const handleRefreshAlerts = useCallback(() => {
    setAlertsRefreshing(true);
    axios.get(ALERTS_URL, { headers })
      .then(res => {
        if (!mountedRef.current) return;
        setAlerts(res.data);
        setNodeOffline(false);
      })
      .catch(() => {
        if (mountedRef.current) setNodeOffline(true);
      })
      .finally(() => {
        if (mountedRef.current) setAlertsRefreshing(false);
      });
  }, [headers]);

  // Read by fetchPeopleCount to skip the browser-YOLO poll while SecurePi hardware mode
  // owns peopleCount/detectionActive (see the hardware people-count effect below) — a
  // ref (not a dependency) so the 5s interval set up on mount doesn't need to restart
  // every time the user switches source mode.
  const sourceModeRef = useRef('camera');
  useEffect(() => {
    sourceModeRef.current = sourceMode;
  }, [sourceMode]);

  const fetchPeopleCount = useCallback(() => {
    if (sourceModeRef.current === 'hardware') return;
    axios.get(PEOPLE_URL, { timeout: 8000, headers })
      .then(res => {
        if (!mountedRef.current) return;
        aiHealthFailuresRef.current = 0;
        setPeopleCount(res.data.count ?? 0);
        setDetectionActive(res.data.detection_active ?? false);
        setAiOffline(false);
        setStreamError(false);
      })
      .catch(() => {
        if (!mountedRef.current) return;
        aiHealthFailuresRef.current += 1;
        setPeopleCount(0);
        setDetectionActive(false);
        if (aiHealthFailuresRef.current >= 3) {
          setAiOffline(true);
        }
      });
  }, [headers]);

  const monitoredCamera = useMemo(
    () => cameras.find((cam) => String(cam.id) === String(selectedCameraId)) || null,
    [cameras, selectedCameraId]
  );
  // Read by analyzeCurrentFrame (inside a useEffect keyed on [sourceMode, uploadedVideoUrl])
  // so the analyse request always uses the currently-selected camera, even when the
  // camera selection changes without that effect re-running.
  const monitoredCameraRef = useRef(null);
  useEffect(() => {
    monitoredCameraRef.current = monitoredCamera;
  }, [monitoredCamera]);
  const hardwareStreamUrl = useMemo(
    () => getHardwareStreamUrl(
      monitoredCamera,
      SECUREPI_STREAM_URL,
      securePiOverrideUrl
    ),
    [monitoredCamera, securePiOverrideUrl]
  );
  const hardwarePeopleCountUrl = useMemo(
    () => getHardwarePeopleCountUrl(hardwareStreamUrl),
    [hardwareStreamUrl]
  );

  useEffect(() => {
    const storedOverride = readSecurePiStreamOverride(monitoredCamera?.id);
    const overrideUrl = storedOverride.valid ? storedOverride.normalized : '';
    // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronizes the per-camera browser setting into the editor
    setSecurePiOverrideInput(overrideUrl);
    setSecurePiOverrideUrl(overrideUrl);
    setSecurePiOverrideMessage('');
  }, [monitoredCamera?.id]);

  const abortSecurePiRequests = useCallback(() => {
    securePiProbeControllerRef.current?.abort();
    securePiProbeControllerRef.current = null;
    securePiPollControllerRef.current?.abort();
    securePiPollControllerRef.current = null;
    securePiPollInFlightRef.current = false;
  }, []);

  const clearSecurePiLiveState = useCallback(() => {
    setPeopleCount(0);
    setDetectionActive(false);
    setDetections([]);
  }, []);

  const activateLaptopFallback = useCallback((status, message = securePiFailureMessage(status)) => {
    securePiPollControllerRef.current?.abort();
    securePiPollControllerRef.current = null;
    securePiPollInFlightRef.current = false;
    clearSecurePiLiveState();
    setStreamError(false);
    setSourceMode('camera');
    setCameraStatus('browser_camera_fallback');
    setSecurePiConnection({ status, message, details: null, fallback: true });
  }, [clearSecurePiLiveState]);

  const applySecurePiResult = useCallback((result) => {
    const degraded = result.status === SECUREPI_CONNECTION_STATUS.STALE;
    if (result.peopleCountSupported === false && result.endpoints?.peopleCountUrl) {
      unsupportedPeopleCountUrlsRef.current.add(result.endpoints.peopleCountUrl);
    }
    setPeopleCount(result.details.visiblePeople);
    setDetectionActive(Boolean(result.details.detectionActive));
    setCameraStatus(degraded ? 'securepi_degraded' : 'securepi_connected');
    setSecurePiConnection({
      status: result.status,
      message: degraded ? 'SecurePi responding but frame is stale' : 'SecurePi connected',
      details: result.details,
      fallback: false,
    });
  }, []);

  const connectSecurePi = useCallback(async () => {
    abortSecurePiRequests();
    setSecurePiConnection({ status: 'testing', message: 'Testing SecurePi…', details: null, fallback: false });
    setCameraStatus('testing_securepi');

    const controller = new AbortController();
    securePiProbeControllerRef.current = controller;
    const result = await testSecurePiConnection({
      streamUrl: hardwareStreamUrl,
      timeoutMs: 3500,
      signal: controller.signal,
      probePeopleCount: !unsupportedPeopleCountUrlsRef.current.has(hardwarePeopleCountUrl),
    });
    if (!mountedRef.current || controller.signal.aborted) return;
    securePiProbeControllerRef.current = null;

    if (!result.ok) {
      activateLaptopFallback(result.status, securePiFailureMessage(result.status));
      return;
    }

    setStreamError(false);
    setCameraReady(false);
    applySecurePiResult(result);
    setSourceMode('hardware');
  }, [abortSecurePiRequests, activateLaptopFallback, applySecurePiResult, hardwarePeopleCountUrl, hardwareStreamUrl]);

  const handleCameraSelectionChange = (event) => {
    abortSecurePiRequests();
    clearSecurePiLiveState();
    setSelectedCameraId(event.target.value);
    setSecurePiConnection(emptySecurePiConnection());
    setSourceMode('camera');
  };

  const handleBrowserCameraSelection = () => {
    abortSecurePiRequests();
    setSecurePiConnection(emptySecurePiConnection());
    setSourceMode('camera');
  };

  const saveLocalSecurePiOverride = () => {
    abortSecurePiRequests();
    setSourceMode('camera');
    clearSecurePiLiveState();
    const result = saveSecurePiStreamOverride(monitoredCamera?.id, securePiOverrideInput);
    if (!result.ok) {
      setSecurePiOverrideMessage(result.error);
      return;
    }
    setSecurePiOverrideInput(result.normalized);
    setSecurePiOverrideUrl(result.normalized);
    setSecurePiOverrideMessage('Browser-local override saved. Retry SecurePi to test it.');
    setSecurePiConnection(emptySecurePiConnection());
  };

  const clearLocalSecurePiOverride = () => {
    abortSecurePiRequests();
    setSourceMode('camera');
    clearSecurePiLiveState();
    clearSecurePiStreamOverride(monitoredCamera?.id);
    setSecurePiOverrideInput('');
    setSecurePiOverrideUrl('');
    setSecurePiOverrideMessage('Browser-local override cleared; Camera Inventory is the fallback.');
    setSecurePiConnection(emptySecurePiConnection());
  };

  useEffect(() => {
    fetchZones();
    fetchCameras();
    fetchAlerts();
    fetchPeopleCount();

    const peopleInterval = setInterval(fetchPeopleCount, 5000);
    const alertsInterval = setInterval(fetchAlerts, 15000);

    return () => {
      clearInterval(peopleInterval);
      clearInterval(alertsInterval);
    };
  }, [fetchZones, fetchCameras, fetchAlerts, fetchPeopleCount]);

  useEffect(() => {
    let stream;
    let frameInterval;
    let sourceCancelled = false;

    const stopBrowserCamera = () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      if (videoRef.current && videoRef.current.srcObject) {
        videoRef.current.srcObject = null;
      }
    };

    const analyzeCurrentFrame = async () => {
    if (processingFrameRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth === 0) return;

    processingFrameRef.current = true;
    const context = canvas.getContext('2d');
    const maxWidth = sourceMode === 'file' ? 1280 : 960;
    const jpegQuality = sourceMode === 'file' ? 0.72 : 0.62;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL('image/jpeg', jpegQuality);
    const payload = buildAnalyzeFramePayload(image, monitoredCameraRef.current, resolveAlertSource(sourceMode));

    try {
      const res = await axios.post(ANALYZE_FRAME_URL, payload, { timeout: 20000, headers });
      if (sourceCancelled || !mountedRef.current) return;
      const rawDetections = res.data.detections ?? [];

      const frameDetections = rawDetections.map((det) => {
        if ((det.type === 'person' || det.status === 'person') && det.track_id != null) {
          const trackId = det.track_id;
          const trackRec = trackRecognitionRef.current.get(trackId);
          const identityStatus = trackRec?.identity_status || det.identity_status || 'SUSPICIOUS';
          const personName = trackRec?.person_name !== undefined
            ? trackRec.person_name
            : (det.person_name || (identityStatus === 'VERIFIED' ? null : 'Unknown Person'));
          const personRole = trackRec?.person_role || det.person_role || null;
          const faceBbox = trackRec?.face_bbox ?? null;

          let statusClass = 'suspicious';
          let labelText = `#${trackId} ${personName ? String(personName).toUpperCase() : 'UNKNOWN PERSON'} — SUSPICIOUS`;

          if (identityStatus === 'VERIFIED') {
            statusClass = 'authorized';
            labelText = `#${trackId} ${personName ? String(personName).toUpperCase() : ''} — VERIFIED`;
          } else if (identityStatus === 'UNAVAILABLE') {
            statusClass = 'unavailable';
            labelText = `#${trackId} IDENTITY UNAVAILABLE`;
          } else if (identityStatus === 'SUSPENDED') {
            statusClass = 'suspicious';
            labelText = `#${trackId} ${personName ? String(personName).toUpperCase() : 'SUSPENDED USER'} — SUSPENDED`;
          }

          const displayBox = computeHumanDisplayBox(det.box, faceBbox);

          return {
            ...det,
            status: statusClass,
            label: labelText,
            identity_status: identityStatus,
            person_name: personName,
            person_role: personRole,
            face_bbox: faceBbox,
            display_box: displayBox,
          };
        }
        return det;
      });

      setDetections(frameDetections);
      setPeopleCount(res.data.count ?? 0);
      setDetectionActive(res.data.detection_active ?? false);
      setCameraStatus(res.data.camera_status ?? 'browser_camera');
      setFrameSize({
        width: res.data.frame_width || canvas.width,
        height: res.data.frame_height || canvas.height,
      });
      setAiOffline(false);
      setStreamError(false);

      // Multi-person identity recognition: trigger per-track recognition asynchronously
      const now = Date.now();
      frameDetections.forEach((det) => {
        if ((det.type === 'person' || det.status === 'person' || det.identity_status) && det.track_id != null && det.box) {
          const trackId = det.track_id;
          const rec = trackRecognitionRef.current.get(trackId) || {
            identity_status: null,
            person_name: null,
            person_role: null,
            face_bbox: null,
            lastRecognitionAt: 0,
            recognitionInFlight: false,
          };

          if (!rec.recognitionInFlight && (now - rec.lastRecognitionAt >= 1000 || !rec.identity_status)) {
            rec.recognitionInFlight = true;
            trackRecognitionRef.current.set(trackId, { ...rec });

            const [x1, y1, x2, y2] = det.box;
            const cropCanvas = document.createElement('canvas');
            const cropW = Math.max(1, Math.round(x2 - x1));
            const cropH = Math.max(1, Math.round(y2 - y1));
            cropCanvas.width = cropW;
            cropCanvas.height = cropH;
            const cropCtx = cropCanvas.getContext('2d');
            cropCtx.drawImage(canvas, x1, y1, cropW, cropH, 0, 0, cropW, cropH);
            const cropDataUrl = cropCanvas.toDataURL('image/jpeg', 0.74);

            axios.post('/api/facial-recognition/recognize', {
              image: cropDataUrl,
              cameraLocation: monitoredCameraRef.current?.location || monitoredCameraRef.current?.camera_name || 'Security Camera',
            }, { headers, timeout: 10000 })
              .then((recRes) => {
                if (!mountedRef.current) return;
                const user = recRes.data?.user;
                const rawFaceBox = Array.isArray(recRes.data?.box) && recRes.data.box.length === 4 ? recRes.data.box : null;
                let resolvedStatus = 'SUSPICIOUS';
                let resolvedName = 'Unknown Person';
                let resolvedRole = 'Unknown';

                if (user && user.status === 'AUTHORIZED') {
                  resolvedStatus = 'VERIFIED';
                  resolvedName = user.name || 'Verified User';
                  resolvedRole = user.role || 'Staff';
                } else if (user && user.status === 'SUSPENDED') {
                  resolvedStatus = 'SUSPENDED';
                  resolvedName = user.name || 'Suspended User';
                  resolvedRole = user.role || 'Staff';
                } else if (user && user.status === 'DENIED') {
                  resolvedStatus = 'SUSPICIOUS';
                  resolvedName = 'Unknown Person';
                  resolvedRole = 'Unknown';
                }

                trackRecognitionRef.current.set(trackId, {
                  identity_status: resolvedStatus,
                  person_name: resolvedName,
                  person_role: resolvedRole,
                  face_bbox: rawFaceBox,
                  lastRecognitionAt: Date.now(),
                  recognitionInFlight: false,
                });

                setDetections((prevDets) => prevDets.map((d) => {
                  if (d.track_id === trackId) {
                    const statusClass = resolvedStatus === 'VERIFIED' ? 'authorized' : resolvedStatus === 'UNAVAILABLE' ? 'unavailable' : 'suspicious';
                    const labelText = resolvedStatus === 'VERIFIED'
                      ? `#${trackId} ${resolvedName.toUpperCase()} — VERIFIED`
                      : resolvedStatus === 'UNAVAILABLE'
                        ? `#${trackId} IDENTITY UNAVAILABLE`
                        : `#${trackId} ${resolvedName.toUpperCase()} — ${resolvedStatus}`;
                    const displayBox = computeHumanDisplayBox(d.box, rawFaceBox);
                    return {
                      ...d,
                      status: statusClass,
                      label: labelText,
                      identity_status: resolvedStatus,
                      person_name: resolvedName,
                      person_role: resolvedRole,
                      face_bbox: rawFaceBox,
                      display_box: displayBox,
                    };
                  }
                  return d;
                }));
              })
              .catch(() => {
                if (!mountedRef.current) return;
                trackRecognitionRef.current.set(trackId, {
                  identity_status: 'UNAVAILABLE',
                  person_name: null,
                  person_role: null,
                  face_bbox: null,
                  lastRecognitionAt: Date.now(),
                  recognitionInFlight: false,
                });

                setDetections((prevDets) => prevDets.map((d) => {
                  if (d.track_id === trackId) {
                    const displayBox = computeHumanDisplayBox(d.box, null);
                    return {
                      ...d,
                      status: 'unavailable',
                      label: `#${trackId} IDENTITY UNAVAILABLE`,
                      identity_status: 'UNAVAILABLE',
                      person_name: null,
                      person_role: null,
                      face_bbox: null,
                      display_box: displayBox,
                    };
                  }
                  return d;
                }));
              });
          }
        }
      });

      if (
        sourceModeRef.current === 'camera'
        && currentInspectionCycleRef.current
        && !currentInspectionCycleRef.current.processed
      ) {
        const cycle = currentInspectionCycleRef.current;
        if (Date.now() - cycle.startTime > 10000) {
          cycle.processed = true;
          setInspectionCycleActiveState(false);
        } else {
          const personDet = frameDetections.find((d) => d.type === 'person' || d.track_id !== undefined || d.status === 'person');
          const animalDet = frameDetections.find((d) => d.type === 'animal' || d.type === 'pest' || (d.label && /\b(cat|dog)\b/i.test(d.label)));

          if (personDet) {
            cycle.processed = true;
            setInspectionCycleActiveState(false);
            lastHandledCycleIdRef.current = cycle.cycleId;

            const rawStatus = personDet.identity_status || 'SUSPICIOUS';
            const personName = personDet.person_name || (rawStatus === 'SUSPICIOUS' ? 'Unknown Person' : null);
            const personRole = personDet.person_role || null;
            const trackId = personDet.track_id ?? null;
            const confidence = personDet.confidence ?? 0.92;
            const resolvedSeverity = (rawStatus === 'VERIFIED' || rawStatus === 'UNAVAILABLE') ? 'High' : 'Critical';

            const alertPayload = {
              cycle_id: cycle.cycleId,
              event_id: cycle.cycleId,
              zone_name: monitoredCameraRef.current?.zone?.zone_name || monitoredCameraRef.current?.camera_name || 'Restricted Storage A',
              camera_location: monitoredCameraRef.current?.location || monitoredCameraRef.current?.camera_name || 'Storage Cam 01',
              status: 'Active',
              object_class: 'person',
              person_name: personName,
              identity_status: rawStatus,
              person_role: personRole,
              alert_type: 'RESTRICTED_MOTION',
              severity: resolvedSeverity,
              source: 'Browser Webcam',
              confidence,
              track_id: trackId,
              sensor_metadata: {
                ...cycle.sensorData,
                pir: cycle.sensorData?.pir ?? null,
                distance_cm: cycle.sensorData?.distance_cm ?? null,
                trigger: cycle.sensorData?.trigger ?? null,
                after_hours: cycle.sensorData?.after_hours ?? null,
                inspection_active: true,
                cycle_id: cycle.cycleId,
                identity_status: rawStatus,
                person_role: personRole,
                track_id: trackId,
                person_name: personName,
              },
            };

            axios.post(ALERTS_URL, alertPayload, { headers })
              .then((postRes) => {
                if (!mountedRef.current) return;
                setAlerts((prev) => [postRes.data, ...prev.filter((a) => a.id !== postRes.data.id)]);
                setSelectedAlertId(postRes.data.id);
              })
              .catch((alertErr) => {
                if (!mountedRef.current) return;
                const status = alertErr.response?.status;
                if (status === 401 || status === 403) {
                  setWorkflowMessage('Detection alert rejected: Authentication error (401/403).');
                } else if (status === 400) {
                  setWorkflowMessage('Detection alert rejected: Invalid payload parameters (400).');
                } else if (status >= 500) {
                  setWorkflowMessage(`Detection alert rejected: Server error (${status}).`);
                } else {
                  setWorkflowMessage('Detection alert failed: Network or server unreachable.');
                }
              });
          } else if (animalDet) {
            cycle.processed = true;
            setInspectionCycleActiveState(false);
            lastHandledCycleIdRef.current = cycle.cycleId;

            const animalClass = animalDet.label ? animalDet.label.split(' ')[0].toLowerCase() : 'animal';
            const confidence = animalDet.confidence ?? 0.85;

            const alertPayload = {
              cycle_id: cycle.cycleId,
              event_id: cycle.cycleId,
              zone_name: monitoredCameraRef.current?.zone?.zone_name || monitoredCameraRef.current?.camera_name || 'Restricted Storage A',
              camera_location: monitoredCameraRef.current?.location || monitoredCameraRef.current?.camera_name || 'Storage Cam 01',
              status: 'Active',
              object_class: animalClass,
              alert_type: 'RESTRICTED_MOTION',
              severity: 'High',
              source: 'Browser Webcam',
              confidence,
              sensor_metadata: {
                ...cycle.sensorData,
                pir: cycle.sensorData?.pir ?? null,
                distance_cm: cycle.sensorData?.distance_cm ?? null,
                trigger: cycle.sensorData?.trigger ?? null,
                after_hours: cycle.sensorData?.after_hours ?? null,
                inspection_active: true,
                cycle_id: cycle.cycleId,
              },
            };

            axios.post(ALERTS_URL, alertPayload, { headers })
              .then((postRes) => {
                if (!mountedRef.current) return;
                setAlerts((prev) => [postRes.data, ...prev.filter((a) => a.id !== postRes.data.id)]);
                setSelectedAlertId(postRes.data.id);
              })
              .catch((alertErr) => {
                if (!mountedRef.current) return;
                const status = alertErr.response?.status;
                if (status === 401 || status === 403) {
                  setWorkflowMessage('Detection alert rejected: Authentication error (401/403).');
                } else if (status === 400) {
                  setWorkflowMessage('Detection alert rejected: Invalid payload parameters (400).');
                } else if (status >= 500) {
                  setWorkflowMessage(`Detection alert rejected: Server error (${status}).`);
                } else {
                  setWorkflowMessage('Detection alert failed: Network or server unreachable.');
                }
              });
          }
        }
      }
    } catch (err) {
      if (sourceCancelled || !mountedRef.current) return;
      setDetectionActive(false);
      setCameraStatus(err.response ? 'analysis_error' : 'analysis_retrying');
    } finally {
      processingFrameRef.current = false;
    }
  };

    const startBrowserCamera = async () => {
      try {
        setDetections([]);
        setCameraStatus('requesting_browser_camera');
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 15, max: 20 },
            facingMode: 'user',
          },
          audio: false,
        });

        if (sourceCancelled || !mountedRef.current) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }

        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          video.onloadedmetadata = async () => {
            if (sourceCancelled || !mountedRef.current) return;
            try {
              await video.play();
              if (sourceCancelled || !mountedRef.current) return;
              setCameraReady(true);
              setCameraStatus('browser_camera_active');
              analyzeCurrentFrame();
            } catch {
              if (!sourceCancelled && mountedRef.current) setCameraStatus('browser_camera_paused');
            }
          };
          setBrowserCameraError(false);
          frameInterval = setInterval(analyzeCurrentFrame, 350);
        }
      } catch {
        if (sourceCancelled || !mountedRef.current) return;
        setBrowserCameraError(true);
        setCameraStatus('browser_camera_denied');
      }
    };

    const startUploadedVideo = async () => {
      const video = videoRef.current;
      if (!video || !uploadedVideoUrl) {
        setCameraReady(false);
        setCameraStatus('waiting_for_video_file');
        return;
      }

      setBrowserCameraError(false);
      setCameraStatus('uploaded_video');
      video.srcObject = null;
      video.src = uploadedVideoUrl;
      video.loop = true;
      video.onloadedmetadata = async () => {
        if (sourceCancelled || !mountedRef.current) return;
        try {
          await video.play();
          if (sourceCancelled || !mountedRef.current) return;
          setCameraReady(true);
          analyzeCurrentFrame();
        } catch {
          if (!sourceCancelled && mountedRef.current) setCameraStatus('uploaded_video_paused');
        }
      };
      frameInterval = setInterval(analyzeCurrentFrame, 350);
    };

    const startHardwareStream = async () => {
      setBrowserCameraError(false);
      setDetections([]);
    };

    if (sourceMode === 'file') {
      startUploadedVideo();
    } else if (sourceMode === 'camera') {
      startBrowserCamera();
    } else if (sourceMode === 'hardware') {
      startHardwareStream();
    }

    return () => {
      sourceCancelled = true;
      clearInterval(frameInterval);
      stopBrowserCamera();
    };
  }, [sourceMode, uploadedVideoUrl, headers]);

  useEffect(() => () => {
    if (uploadedVideoUrl) URL.revokeObjectURL(uploadedVideoUrl);
  }, [uploadedVideoUrl]);

  // One SecurePi polling cycle owns both requests: /health is always validated
  // before /people-count. Leaving hardware mode or selecting another camera
  // clears this interval and aborts its in-flight request.
  useEffect(() => {
    if (!hardwareStreamUrl) return undefined;
    let cancelled = false;
    const pollSecurePi = async () => {
      if (cancelled || securePiPollInFlightRef.current) return;
      securePiPollInFlightRef.current = true;
      const controller = new AbortController();
      securePiPollControllerRef.current = controller;
      const result = await testSecurePiConnection({
        streamUrl: hardwareStreamUrl,
        timeoutMs: 3500,
        signal: controller.signal,
        probePeopleCount: !unsupportedPeopleCountUrlsRef.current.has(hardwarePeopleCountUrl),
      });
      securePiPollInFlightRef.current = false;
      if (securePiPollControllerRef.current === controller) securePiPollControllerRef.current = null;
      if (cancelled || controller.signal.aborted || !mountedRef.current) return;
      if (result.ok) {
        if (sourceModeRef.current === 'hardware') {
          applySecurePiResult(result);
        } else {
          setSecurePiConnection({
            status: result.status,
            message: result.status === SECUREPI_CONNECTION_STATUS.STALE ? 'SecurePi responding but frame is stale' : 'SecurePi connected',
            details: result.details,
            fallback: false,
          });
        }
      } else if (sourceModeRef.current === 'hardware') {
        activateLaptopFallback(result.status, securePiFailureMessage(result.status));
      }
    };

    const interval = setInterval(() => { void pollSecurePi(); }, SECUREPI_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
      securePiPollControllerRef.current?.abort();
      securePiPollControllerRef.current = null;
      securePiPollInFlightRef.current = false;
    };
  }, [activateLaptopFallback, applySecurePiResult, hardwarePeopleCountUrl, hardwareStreamUrl]);

  useEffect(() => {
    const sensor = securePiConnection.details?.sensor || null;
    const isInspectionActive = Boolean(
      sensor?.inspection_active
      || sensor?.pir
      || sensor?.motion
      || (sensor?.distance_change_cm && sensor.distance_change_cm > 15)
    );
    const isAfterHours = Boolean(sensor?.after_hours);

    if (isAfterHours && isInspectionActive && !prevInspectionActiveRef.current) {
      const cycleId = sensor?.inspection_id
        || sensor?.inspection_cycle_id
        || `cycle_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      if (lastHandledCycleIdRef.current !== cycleId) {
        currentInspectionCycleRef.current = {
          cycleId,
          startTime: Date.now(),
          sensorData: { ...sensor },
          processed: false,
        };
        setInspectionCycleActiveState(true);
      }
    }
    prevInspectionActiveRef.current = isInspectionActive;

    if (!isInspectionActive && currentInspectionCycleRef.current?.processed) {
      currentInspectionCycleRef.current = null;
      setInspectionCycleActiveState(false);
    }
  }, [securePiConnection.details?.sensor]);

  useEffect(() => () => abortSecurePiRequests(), [abortSecurePiRequests]);

  useEffect(() => {
    if (sourceMode !== 'hardware' || cameraReady) return undefined;
    const firstFrameTimer = setTimeout(() => {
      if (!mountedRef.current) return;
      activateLaptopFallback(
        SECUREPI_CONNECTION_STATUS.TIMEOUT,
        'SecurePi MJPEG first frame timed out'
      );
    }, SECUREPI_FIRST_FRAME_TIMEOUT_MS);
    return () => clearTimeout(firstFrameTimer);
  }, [activateLaptopFallback, cameraReady, hardwareStreamUrl, sourceMode]);

  const handleUpdateAlertStatus = async (id, status) => {
    setAlertActionBusy(true);
    setWorkflowMessage('');
    try {
      const res = await axios.put(`${ALERTS_URL}/${id}`, { status }, { headers });
      if (!mountedRef.current) return;
      setAlerts(prev => prev.map(a => a.id === id ? res.data : a));
      setWorkflowMessage(status === 'Cleared' ? 'Alert marked cleared.' : `Alert marked ${status.toLowerCase()}.`);
    } catch (err) {
      console.error('Update alert error:', err);
      if (mountedRef.current) setWorkflowMessage('Could not update this alert. Check that the Node.js server is running.');
    } finally {
      if (mountedRef.current) setAlertActionBusy(false);
    }
  };

  const handleAcknowledgeAlert = (id) => {
    handleUpdateAlertStatus(id, 'Acknowledged');
  };

  const handleInvestigateAlert = (id) => {
    handleUpdateAlertStatus(id, 'Investigating');
  };

  const handleEscalateAlert = (id) => {
    handleUpdateAlertStatus(id, 'Escalated');
  };

  const handleClearAlert = (id) => {
    handleUpdateAlertStatus(id, 'Cleared');
  };

  const handleClearAllAlerts = async () => {
    const openAlerts = alerts.filter((a) => OPEN_ALERT_STATUSES.includes(a.status));
    if (openAlerts.length === 0) return;
    setAlertActionBusy(true);
    setWorkflowMessage('');
    try {
      const results = await Promise.all(
        openAlerts.map((a) => axios.put(`${ALERTS_URL}/${a.id}`, { status: 'Cleared' }, { headers }))
      );
      if (!mountedRef.current) return;
      setAlerts((prev) => prev.map((a) => {
        const updated = results.find((r) => r.data.id === a.id);
        return updated ? updated.data : a;
      }));
      setWorkflowMessage('All active alerts cleared.');
    } catch (err) {
      console.error('Clear all alerts error:', err);
      if (mountedRef.current) setWorkflowMessage('Could not clear all alerts. Check that the Node.js server is running.');
    } finally {
      if (mountedRef.current) setAlertActionBusy(false);
    }
  };

  const handleVideoUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    // Validate MIME + size before creating any preview URL; only a validated
    // File/Blob is ever turned into a blob: object URL (never a raw/remote URL).
    const check = validateVideoFile(file);
    if (!check.ok) { setWorkflowMessage(check.error); return; }
    revokeTemporaryObjectUrl(uploadedVideoUrl);
    abortSecurePiRequests();
    setSecurePiConnection(emptySecurePiConnection());
    setUploadedVideoUrl(createTemporaryObjectUrl(check.file));
    setUploadedVideoName(check.file.name);
    setSourceMode('file');
    setCameraReady(false);
    setDetections([]);
  };

  const activeAlertCount = alerts.filter(a => OPEN_ALERT_STATUSES.includes(a.status)).length;
  const clearedAlertCount = alerts.filter(a => a.status === 'Cleared').length;
  const latestOpenAlert = useMemo(() => (
    alerts.find(alert => OPEN_ALERT_STATUSES.includes(alert.status)) || null
  ), [alerts]);
  const displayedAlert = useMemo(() => {
    const selected = selectedAlertId
      ? alerts.find(alert => alert.id === selectedAlertId && OPEN_ALERT_STATUSES.includes(alert.status))
      : null;
    return selected || latestOpenAlert;
  }, [alerts, selectedAlertId, latestOpenAlert]);
  const latestIncidentTitle = useMemo(() => {
    if (!displayedAlert) return '';
    return alertTitle(displayedAlert);
  }, [displayedAlert]);
  const displayedSnapshotUrl = displayedAlert?.snapshot_url || '';
  const activeSnapshotPreview = isRemoteSnapshot(displayedSnapshotUrl)
    ? { url: displayedSnapshotUrl, error: false }
    : snapshotPreview.source === displayedSnapshotUrl
      ? snapshotPreview
      : { url: '', error: false };
  useEffect(() => {
    const snapshotUrl = displayedSnapshotUrl;
    if (!isProtectedSnapshot(snapshotUrl)) return undefined;

    let cancelled = false;
    let objectUrl = '';
    axios.get(snapshotRequestUrl(snapshotUrl), { headers, responseType: 'blob' })
      .then((res) => {
        if (cancelled) return;
        if (typeof URL.createObjectURL !== 'function') {
          setSnapshotPreview({ url: '', source: snapshotUrl, error: true });
          return;
        }
        objectUrl = URL.createObjectURL(res.data);
        setSnapshotPreview({ url: objectUrl, source: snapshotUrl, error: false });
      })
      .catch(() => {
        if (!cancelled) setSnapshotPreview({ url: '', source: snapshotUrl, error: true });
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [displayedSnapshotUrl, headers]);
  const sourceTitle = sourceMode === 'hardware'
    ? 'Raspberry Pi 5 — Sony IMX500 SecurePi'
    : sourceMode === 'file'
      ? uploadedVideoName || 'Uploaded video file'
      : 'Laptop Webcam';
  const sourceSubtitle = sourceMode === 'hardware'
    ? 'Validated local service connection and annotated MJPEG stream'
    : 'Facial recognition test mode';
  const activeSourceLabel = sourceMode === 'hardware'
    ? cameraReady
      ? 'Active source: Raspberry Pi 5 — Sony IMX500 SecurePi'
      : 'Connecting source: Raspberry Pi 5 — Sony IMX500 SecurePi'
    : sourceMode === 'file'
      ? 'Active source: Uploaded Video'
      : 'Active source: Laptop Webcam';
  const liveSensorMetadata = securePiConnection.details?.sensor || null;
  const alertSensorMetadata = parseSensorMetadata(displayedAlert);
  const displayedSensorMetadata = liveSensorMetadata || alertSensorMetadata;
  const isRestrictedMotionAlert = /restricted[-\s]?zone motion|restricted motion/i.test(
    String(displayedAlert?.alert_type || displayedAlert?.classification || '')
  );
  const pirState = displayedSensorMetadata?.pir
    ?? displayedSensorMetadata?.pir_motion
    ?? displayedSensorMetadata?.motion
    ?? (isRestrictedMotionAlert && displayedSensorMetadata ? true : undefined);
  const ultrasonicDistance = displayedSensorMetadata?.distance_cm ?? displayedSensorMetadata?.ultrasonic_cm;
  const ultrasonicChange = displayedSensorMetadata?.distance_change_cm;
  const sensorTrigger = displayedSensorMetadata?.trigger
    || displayedSensorMetadata?.trigger_source
    || (isRestrictedMotionAlert && displayedSensorMetadata ? 'PIR Motion' : null);
  const afterHoursState = displayedSensorMetadata?.after_hours
    ?? displayedSensorMetadata?.night_inspection
    ?? (isRestrictedMotionAlert && displayedSensorMetadata ? true : undefined);
  const activePersonDet = detections.find((d) => d.type === 'person' || d.track_id !== undefined || d.status === 'person');
  const liveTrackId = activePersonDet?.track_id !== undefined ? `#${activePersonDet.track_id}` : null;
  const livePersonName = activePersonDet?.person_name;
  const liveIdentityStatus = activePersonDet?.identity_status;
  const liveFacialIdentity = livePersonName
    ? (liveIdentityStatus ? `${livePersonName} (${liveIdentityStatus})` : livePersonName)
    : (activePersonDet ? (liveIdentityStatus === 'SUSPICIOUS' ? 'Unknown Person' : liveIdentityStatus || 'Awaiting facial recognition') : null);

  const facialIdentity = liveFacialIdentity || (displayedAlert ? identityLabel(displayedAlert) : 'Awaiting facial recognition');
  const facialRole = displayedAlert?.person_role || displayedAlert?.personRole || alertSensorMetadata?.person_role || alertSensorMetadata?.personRole || 'No role supplied';
  const trackId = liveTrackId || (displayedAlert?.track_id ?? displayedAlert?.trackId ?? alertSensorMetadata?.track_id ?? alertSensorMetadata?.trackId ?? 'Awaiting edge metadata');

  return (
    <div className="dashboard-layout">
      <Sidebar />
      <main className="dashboard-main od-main">
        <header className="dashboard-header od-header">
          <div className="header-titles">
            <h1>Security Camera</h1>
            <p>SecurePi sensor-triggered inspection, facial recognition, and restricted-zone response</p>
          </div>
          <div className="od-header-actions">
            <div className={`od-engine-badge ${aiOffline ? 'offline' : ''}`}>
              <span className="od-people-dot" />
              Facial AI: {aiOffline ? 'Offline' : 'Online'}
            </div>
            <div className="od-people-badge">
              <Icon name="person" />
              {sourceMode === 'hardware' && peopleCount === null
                ? 'People count not provided'
                : `${peopleCount} ${peopleCount === 1 ? 'Person' : 'People'} Detected`}
            </div>
          </div>
        </header>

        {nodeOffline && (
          <div className="od-system-banner danger">
            Node.js server offline - run <strong>node index.js</strong> in /server (port 5001)
          </div>
        )}
        {aiOffline && (
          <div className="od-system-banner warning">
            Python AI service offline - run <strong>uvicorn main:app --host 0.0.0.0 --port 8501</strong> in /ai-service
          </div>
        )}

        <section className="od-command-strip">
          <div className="od-command-card cyan">
            <span>Security Events</span>
            <strong>{(peopleCount ?? 0) + alerts.length}</strong>
            <small>Visible people plus alert log</small>
          </div>
          <div className="od-command-card red">
            <span>Open Alerts</span>
            <strong>{activeAlertCount}</strong>
            <small>{clearedAlertCount} cleared in alert log</small>
          </div>
          <div className="od-command-card amber">
            <span>Restricted Zones</span>
            <strong>{zones.length}</strong>
            <small>Managed in Detection Setup</small>
          </div>
          <div className="od-command-card green">
            <span>Inspection State</span>
            <strong>{detectionActive ? 'Active' : 'Standby'}</strong>
            <small>{cameraStatus.replace(/_/g, ' ')}</small>
          </div>
        </section>

        <div className="od-grid">
          <div className="od-stream-card">
            <div className="od-stream-header">
              <div>
                <h2>Live Security Feed</h2>
                <p>{sourceTitle} - {sourceSubtitle}</p>
              </div>
              <div className="od-stream-badges">
                <span className={sourceMode === 'hardware' && cameraReady ? 'active' : detectionActive ? 'active' : 'standby'}>
                  {sourceMode === 'hardware' ? (cameraReady ? 'SENSOR EDGE LIVE' : 'SECUREPI CONNECTING') : detectionActive ? 'FACIAL AI ACTIVE' : 'FACIAL AI STANDBY'}
                </span>
                <span>CAMERA: {cameraStatus.replace(/_/g, ' ').toUpperCase()}</span>
              </div>
            </div>

            <div className="od-source-controls">
              <button
                type="button"
                className={sourceMode === 'camera' ? 'active' : ''}
                onClick={handleBrowserCameraSelection}
              >
                Browser Camera Test
              </button>
              <label className={sourceMode === 'file' ? 'active' : ''}>
                Upload Test Video
                <input type="file" accept="video/*" onChange={handleVideoUpload} />
              </label>
              <button
                type="button"
                className={sourceMode === 'hardware' ? 'active' : ''}
                onClick={() => { void connectSecurePi(); }}
                disabled={securePiConnection.status === 'testing'}
              >
                {securePiConnection.status === 'testing' ? 'Testing SecurePi...' : 'SecurePi Sensor Camera'}
              </button>
              <select
                className="od-input od-camera-picker"
                value={selectedCameraId}
                onChange={handleCameraSelectionChange}
              >
                {cameras.length === 0 && <option value="">No cameras in inventory</option>}
                {cameras.map((cam) => (
                  <option key={cam.id} value={cam.id}>{cam.camera_code} - {cam.camera_name}</option>
                ))}
              </select>
            </div>

            <p className="od-monitoring-label">
              {monitoredCamera
                ? <>Currently Monitoring: <strong>{monitoredCamera.camera_code}</strong> &middot; {monitoredCamera.zone?.zone_name || 'Unassigned zone'}</>
                : 'No security camera selected from inventory - add one in Camera Inventory.'}
            </p>

            <div className="od-source-status" role="status">
              <strong>{activeSourceLabel}</strong>
              {securePiConnection.fallback && (
                <>
                  <span>SecurePi sensor camera unavailable - using laptop camera fallback</span>
                  <span>
                    {securePiConnection.message}.
                    {[SECUREPI_CONNECTION_STATUS.UNREACHABLE, SECUREPI_CONNECTION_STATUS.TIMEOUT].includes(securePiConnection.status)
                      ? ' Local device not reachable from this network. Confirm this computer and the Raspberry Pi are on the same hotspot or LAN.'
                      : ''}
                  </span>
                  {securePiConnection.status === SECUREPI_CONNECTION_STATUS.PERMISSION_REQUIRED && (
                    <span>Allow Local Network Access for this FlowGuard site, then try again.</span>
                  )}
                  <button type="button" className="od-btn-primary" onClick={() => { void connectSecurePi(); }}>
                    Retry SecurePi
                  </button>
                </>
              )}
              {!securePiConnection.fallback && securePiConnection.message && (
                <span>{securePiConnection.message}</span>
              )}
            </div>

            {monitoredCamera && (
              <details className="od-securepi-override">
                <summary>SecurePi URL for this browser</summary>
                <p>Optional override scoped to {monitoredCamera.camera_code}; Camera Inventory remains the fallback.</p>
                <div>
                  <input
                    className="od-input"
                    type="url"
                    inputMode="url"
                    aria-label="SecurePi URL for this browser"
                    value={securePiOverrideInput}
                    onChange={(event) => {
                      setSecurePiOverrideInput(event.target.value);
                      setSecurePiOverrideMessage('');
                    }}
                    placeholder="http://securepi.local:8001/video_feed"
                  />
                  <button type="button" className="od-btn-primary" onClick={saveLocalSecurePiOverride}>Save local override</button>
                  <button type="button" className="od-btn-cancel" onClick={clearLocalSecurePiOverride}>Clear override</button>
                </div>
                {securePiOverrideUrl && <span>Browser-local override active for this camera.</span>}
                {securePiOverrideMessage && <span>{securePiOverrideMessage}</span>}
              </details>
            )}

            {sourceMode === 'hardware' && securePiConnection.details && (
              <div className="od-securepi-details" aria-label="SecurePi connection details">
                <span>Connection <strong>{securePiConnection.status === SECUREPI_CONNECTION_STATUS.STALE ? 'Degraded' : 'Connected'}</strong></span>
                <span>Detection <strong>{securePiConnection.details.detectionActive ? 'Active' : 'Standby'}</strong></span>
                <span>Visible people <strong>{securePiConnection.details.visiblePeople === null ? 'Not provided by this SecurePi service' : securePiConnection.details.visiblePeople}</strong></span>
                {securePiConnection.details.deviceId && <span>Device ID <strong>{securePiConnection.details.deviceId}</strong></span>}
                {securePiConnection.details.zone && <span>Zone <strong>{securePiConnection.details.zone}</strong></span>}
                {securePiConnection.details.frameAgeSeconds !== null && <span>Frame age <strong>{securePiConnection.details.frameAgeSeconds}s</strong></span>}
              </div>
            )}

            <canvas ref={canvasRef} style={{ display: 'none' }} />

            {sourceMode === 'file' && !uploadedVideoUrl ? (
              <div className="od-stream-placeholder">
                Select a video file to run object detection on uploaded footage
              </div>
            ) : browserCameraError ? (
              <div className="od-stream-placeholder">
                Browser camera blocked - allow camera permission and refresh this page
              </div>
            ) : streamError ? (
              <div className="od-stream-placeholder">
                Python AI service offline - start ai-service to enable stream
              </div>
            ) : (
              <div
                className={`od-video-stage ${sourceMode === 'hardware' ? 'od-video-stage-hardware' : ''}`}
                style={sourceMode === 'hardware' ? undefined : { aspectRatio: `${frameSize.width} / ${frameSize.height}` }}
              >
                {sourceMode === 'hardware' ? (
                  <img
                    key={hardwareStreamUrl}
                    src={hardwareStreamUrl}
                    className="od-stream-img od-stream-img-hardware"
                    alt="SecurePi live hardware camera"
                    onLoad={() => {
                      setCameraReady(true);
                      setStreamError(false);
                    }}
                    onError={() => {
                      setCameraReady(false);
                      activateLaptopFallback(SECUREPI_CONNECTION_STATUS.UNREACHABLE, 'SecurePi MJPEG stream unavailable');
                    }}
                  />
                ) : (
                  <video ref={videoRef} autoPlay playsInline muted className="od-stream-img" />
                )}
                {!cameraReady && (
                  <div className="od-camera-message">
                    {sourceMode === 'hardware' ? 'Connecting to SecurePi stream...' : 'Starting camera...'}
                  </div>
                )}
                {sourceMode !== 'hardware' && (
                <div className="od-detection-layer">
                  <div className="od-video-hud">
                    <span>{cameraStatus.replace(/_/g, ' ')}</span>
                    <span>{detections.length} detections</span>
                  </div>
                  {detections.map((detection, index) => {
                    const boxToDraw = (detection.type === 'person' || detection.status === 'person' || detection.identity_status)
                      ? (detection.display_box || detection.box)
                      : detection.box;
                    const [x1, y1, x2, y2] = boxToDraw;
                    return (
                      <div
                        key={`${detection.label}-${index}`}
                        className={`od-detection-box ${detection.status}`}
                        style={{
                          left: `${(x1 / frameSize.width) * 100}%`,
                          top: `${(y1 / frameSize.height) * 100}%`,
                          width: `${((x2 - x1) / frameSize.width) * 100}%`,
                          height: `${((y2 - y1) / frameSize.height) * 100}%`,
                        }}
                      >
                        <span>{detection.label}</span>
                      </div>
                    );
                  })}
                </div>
                )}
                <div className="od-video-footer">
                  <span className={sourceMode === 'hardware' && cameraReady ? 'live' : detectionActive ? 'live' : 'standby'}>
                    {sourceMode === 'hardware' && cameraReady ? 'LIVE' : detectionActive ? 'LIVE' : 'STANDBY'}
                  </span>
                  <span>{sourceMode === 'hardware' ? 'SecurePi Edge Live | sensor-triggered facial overlay' : sourceMode === 'file' ? 'Uploaded Video' : `Browser Feed | ${detections.length} Detections`}</span>
                  <span>{sourceMode === 'hardware' ? 'MJPEG' : '1080p'}</span>
                </div>
              </div>
            )}
          </div>

          <div className="od-right-column">
            <div className="od-incident-card">
              <div className="od-incident-title">
                <Icon name="alert" />
                <div>
                  <span className={displayedAlert ? 'critical' : 'clear'}>
                    {displayedAlert ? displayedAlert.status : 'CLEAR'}
                  </span>
                  <h2>{displayedAlert ? latestIncidentTitle : 'No Active Incident'}</h2>
                  <p>{displayedAlert ? 'Incident console - resolution workflow' : 'Live alerts will appear here when created'}</p>
                </div>
              </div>

              {displayedAlert ? (
                <>
                  <div className="od-incident-body">
                    <p>{displayedAlert.zone_name} - {displayedAlert.camera_location}</p>
                    <div className="od-incident-meta">
                      <span>Camera <strong>{displayedAlert.camera_location}</strong></span>
                      <span>Status <strong>{displayedAlert.status}</strong></span>
                      <span>Object <strong>{displayedAlert.object_class || 'Package-like object'}</strong></span>
                      <span>Source <strong>{alertSource(displayedAlert)}</strong></span>
                      <span>Severity <strong>{displayedAlert.severity || 'High'}</strong></span>
                      <span>Identity <strong>{facialIdentity}</strong></span>
                      <span>Role <strong>{facialRole}</strong></span>
                      <span>Classification <strong>{classificationLabel(displayedAlert)}</strong></span>
                      <span>Track ID <strong>{trackId}</strong></span>
                      <span>PIR <strong>{sensorLabel(pirState)}</strong></span>
                      <span>Ultrasonic <strong>{distanceLabel(ultrasonicDistance)}</strong></span>
                      <span>Distance Change <strong>{distanceLabel(ultrasonicChange)}</strong></span>
                      <span>Sensor Trigger <strong>{sensorTrigger || 'Awaiting edge metadata'}</strong></span>
                      <span>After Hours <strong>{sensorLabel(afterHoursState)}</strong></span>
                      {confidencePercent(displayedAlert.confidence) != null && (
                        <span>Confidence <strong>{confidencePercent(displayedAlert.confidence)}%</strong></span>
                      )}
                      {displayedAlert.device_id && (
                        <span>Device <strong>{displayedAlert.device_id}</strong></span>
                      )}
                      <span>Timestamp <strong>{alertTimestamp(displayedAlert)}</strong></span>
                      {displayedAlert.duration_seconds != null && (
                        <span>Duration <strong>{displayedAlert.duration_seconds}s</strong></span>
                      )}
                      <span>WhatsApp <strong className={whatsappStatusClass(whatsappStatusOf(displayedAlert))}>{whatsappStatusOf(displayedAlert)}</strong></span>
                    </div>
                    {activeSnapshotPreview.url ? (
                      <div className="od-snapshot-preview">
                        <img
                          src={activeSnapshotPreview.url}
                          alt={`${displayedAlert.object_class || 'Object'} detection snapshot`}
                          className="od-snapshot-img"
                        />
                        <a className="od-snapshot-link" href={activeSnapshotPreview.url} target="_blank" rel="noreferrer">
                          View edge snapshot
                        </a>
                      </div>
                    ) : activeSnapshotPreview.error ? (
                      <p className="od-snapshot-note">Snapshot upload found, but the image could not be loaded.</p>
                    ) : displayedAlert.snapshot_url ? (
                      <p className="od-snapshot-note">Snapshot captured on the edge device; remote upload unavailable.</p>
                    ) : null}
                  </div>

                  <div className="od-resolution-actions">
                    <button
                      type="button"
                      className="green"
                      onClick={() => handleAcknowledgeAlert(displayedAlert.id)}
                      disabled={alertActionBusy || displayedAlert.status !== 'Active'}
                    >
                      Acknowledge
                    </button>
                    <button
                      type="button"
                      className="dispatch"
                      onClick={() => handleInvestigateAlert(displayedAlert.id)}
                      disabled={alertActionBusy || displayedAlert.status === 'Investigating'}
                    >
                      Mark Investigating
                    </button>
                    <button
                      type="button"
                      className="escalate"
                      onClick={() => handleEscalateAlert(displayedAlert.id)}
                      disabled={alertActionBusy || displayedAlert.status === 'Escalated'}
                    >
                      Escalate
                    </button>
                    <button
                      type="button"
                      className="resolve"
                      onClick={() => handleClearAlert(displayedAlert.id)}
                      disabled={alertActionBusy}
                    >
                      Mark Resolved / Cleared
                    </button>
                  </div>
                  {workflowMessage && <p className="od-workflow-note">{workflowMessage}</p>}
                </>
              ) : (
                <div className="od-incident-empty">
                  <Icon name="check" />
                  <p>No active detection alerts from the backend.</p>
                </div>
              )}
            </div>

            <div className="od-alert-summary-card">
              <div className="od-card-heading">
                <div>
                  <span><Icon name="person" /> Sensor + Face Link</span>
                  <h2>Inspection Pipeline</h2>
                </div>
              </div>
              <div className="od-incident-body">
                <div className="od-incident-meta">
                  <span>Camera <strong>{monitoredCamera?.camera_code || 'No camera selected'}</strong></span>
                  <span>SecurePi <strong>{sourceMode === 'hardware' ? securePiConnection.message || 'Connected' : 'Standby'}</strong></span>
                  <span>PIR Motion <strong>{sensorLabel(pirState)}</strong></span>
                  <span>Ultrasonic <strong>{distanceLabel(ultrasonicDistance)}</strong></span>
                  <span>Inspection <strong>{inspectionCycleActiveState || detectionActive ? 'Active' : 'Standby'}</strong></span>
                  <span>People Count <strong>{peopleCount === null ? 'Not provided' : peopleCount}</strong></span>
                  <span>Facial Result <strong>{facialIdentity}</strong></span>
                  <span>Person Tracking <strong>{trackId}</strong></span>
                  <span>Re-ID Scope <strong>Active stream + face cache</strong></span>
                  <span>Classification <strong>{displayedAlert ? classificationLabel(displayedAlert) : (activePersonDet?.identity_status || 'Awaiting alert')}</strong></span>
                  <span>After Hours <strong>{sensorLabel(afterHoursState)}</strong></span>
                </div>
              </div>
              <div className="od-ops-actions">
                <Link className="od-btn-primary od-link-button" to="/facial-evaluation">Facial Evaluation</Link>
                <Link className="od-btn-cancel od-link-button" to="/detection-settings">Sensor Rules</Link>
              </div>
            </div>

            <div className="od-alert-summary-card">
              <div className="od-card-heading">
                <div>
                  <span><Icon name="alert" /> Active Alerts</span>
                  <h2>Latest Security Camera Alerts</h2>
                </div>
                <div className="od-alert-heading-actions">
                  <select
                    className="od-alert-filter"
                    aria-label="Filter by alert type"
                    value={alertTypeFilter}
                    onChange={(e) => setAlertTypeFilter(e.target.value)}
                  >
                    <option value="all">All types</option>
                    <option value="PEST_DETECTION">Pest</option>
                    <option value="RESTRICTED_MOTION">After-hours motion</option>
                    <option value="UNATTENDED_OBJECT">Unattended object</option>
                    <option value="FORGOTTEN_BELONGING">Forgotten belonging</option>
                    <option value="ITEM_MOVEMENT">Item movement</option>
                    <option value="OVERCROWDING">Overcrowding</option>
                  </select>
                  <select
                    className="od-alert-filter"
                    aria-label="Filter by severity"
                    value={alertSeverityFilter}
                    onChange={(e) => setAlertSeverityFilter(e.target.value)}
                  >
                    <option value="all">All severities</option>
                    <option value="Critical">Critical</option>
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                  <button
                    type="button"
                    className="od-refresh-btn"
                    onClick={handleRefreshAlerts}
                    disabled={alertsRefreshing}
                    title="Refresh alerts"
                  >
                    {alertsRefreshing ? 'Refreshing...' : 'Refresh'}
                  </button>
                  <button
                    type="button"
                    className="od-clear-all-btn"
                    onClick={handleClearAllAlerts}
                    disabled={alertActionBusy || activeAlertCount === 0}
                  >
                    Clear All
                  </button>
                </div>
              </div>
              <div className="od-live-alert-list">
                {alerts
                  .filter((alert) => OPEN_ALERT_STATUSES.includes(alert.status))
                  .filter((alert) => alertTypeFilter === 'all' || alertTypeKey(alert) === alertTypeFilter)
                  .filter((alert) => alertSeverityFilter === 'all' || alert.severity === alertSeverityFilter)
                  .map((alert) => (
                  <button
                    key={alert.id}
                    type="button"
                    className={`od-live-alert-item ${displayedAlert?.id === alert.id ? 'active' : ''}`}
                    onClick={() => setSelectedAlertId(alert.id)}
                  >
                    <span>{alertTitle(alert)}</span>
                    <strong>{alert.status}</strong>
                    <small>{alert.zone_name} - {alert.camera_location}</small>
                    <small>{alertSource(alert)}{alert.severity ? ` - ${alert.severity}` : ''}</small>
                    <small className={whatsappStatusClass(whatsappStatusOf(alert))}>WhatsApp: {whatsappStatusOf(alert)}</small>
                  </button>
                ))}
                {activeAlertCount === 0 && <p>No active security-camera alerts.</p>}
              </div>
              <div className="od-ops-actions">
                <Link className="od-btn-primary od-link-button" to="/detection-settings">Detection Setup</Link>
                <Link className="od-btn-cancel od-link-button" to="/camera-inventory">Camera Inventory</Link>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default SecurityCamera;
