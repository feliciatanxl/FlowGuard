import { useCallback, useRef, useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import axios from 'axios';
import '../css/Enrollment.css';
import { API_BASE_URL } from '../constants/api';
import {
  PI_CAMERA_STREAM_URL,
  CAMERA_SOURCES,
  CAMERA_STATUS_MESSAGES,
  isPiCameraReachable,
  fetchPiSnapshotBitmap,
} from '../constants/piCamera';
import { drawBitmapToCanvasAndClose } from '../utils/cameraSource';

const FaceEnrollment = () => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [enrollmentMode, setEnrollmentMode] = useState('camera'); // 'camera' | 'upload'
  const [stage, setStage] = useState('front'); // 'front', 'left', 'right', 'ready'
  const [photos, setPhotos] = useState({ front: null, left: null, right: null });
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  // Camera source: Raspberry Pi Camera Module 3 is primary; the laptop webcam
  // is the AUTOMATIC fallback when the Pi is unreachable. Same shared helpers
  // as Gate Scanner / V-Patrol. Enrolment photos exist only in memory.
  const [cameraSource, setCameraSource] = useState(CAMERA_SOURCES.PI);
  const [cameraStatusMsg, setCameraStatusMsg] = useState("Connecting to Raspberry Pi Camera Module 3…");
  const cameraSourceRef = useRef(CAMERA_SOURCES.PI);
  const piFailStreakRef = useRef(0);
  const cameraSessionRef = useRef(0);
  const piRequestControllersRef = useRef(new Set());
  const piPreviewRef = useRef(null);

  const token = localStorage.getItem("accessToken");
  const userName = localStorage.getItem("userName");
  const targetUserId = searchParams.get("userId");
  const targetUserName = searchParams.get("name");
  const returnTo = searchParams.get("returnTo") || "/dashboard";
  const isReEnrollment = Boolean(targetUserId);
  const displayName = targetUserName || userName || "FlowGuard user";

  const allUploaded = photos.front && photos.left && photos.right;

  const abortActivePiRequests = useCallback(() => {
    piRequestControllersRef.current.forEach((controller) => controller.abort());
    piRequestControllersRef.current.clear();
  }, []);

  const clearPiPreview = useCallback(() => {
    try { piPreviewRef.current?.removeAttribute('src'); } catch { /* ignore */ }
  }, []);

  const applyCameraSource = useCallback((source, statusMsg) => {
    if (source !== CAMERA_SOURCES.PI) {
      abortActivePiRequests();
      clearPiPreview();
    }
    cameraSourceRef.current = source;
    setCameraSource(source);
    setCameraStatusMsg(statusMsg);
    piFailStreakRef.current = 0;
  }, [abortActivePiRequests, clearPiPreview]);

  const stopWebcam = useCallback(() => {
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = videoRef.current.srcObject.getTracks();
      tracks.forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
  }, []);

  const startWebcam = useCallback(async (cameraSession = cameraSessionRef.current) => {
    // No camera API (insecure context / no webcam): steer the user to manual upload.
    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMessage("No webcam detected on this device. Use the “Upload Photos” option instead.");
      return;
    }
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
        cameraSession !== cameraSessionRef.current
        || cameraSourceRef.current !== CAMERA_SOURCES.WEBCAM
        || !videoRef.current
      ) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      videoRef.current.srcObject = stream;
    } catch (err) {
      if (cameraSession === cameraSessionRef.current) {
        console.error("Camera access denied", err);
        setErrorMessage("Camera access denied. Enable camera permissions, or use the “Upload Photos” option instead.");
      }
    }
  }, []);

  const probePiReachable = useCallback(async () => {
    const controller = new AbortController();
    piRequestControllersRef.current.add(controller);
    try {
      return await isPiCameraReachable(3500, { signal: controller.signal });
    } finally {
      piRequestControllersRef.current.delete(controller);
    }
  }, []);

  // Probe the Pi on page load (first-time enrolment AND re-enrolment). If the
  // Pi answers, show its MJPEG preview and capture via /snapshot; otherwise
  // fall back to the laptop webcam automatically. Node/FastAPI being offline
  // must NEVER trigger this fallback — only Pi reachability does.
  const initCameraSource = useCallback(async () => {
    const cameraSession = cameraSessionRef.current;
    const piReachable = await probePiReachable();
    if (cameraSession !== cameraSessionRef.current) return;
    if (piReachable) {
      stopWebcam();
      applyCameraSource(CAMERA_SOURCES.PI, CAMERA_STATUS_MESSAGES.PI_CONNECTED);
    } else {
      applyCameraSource(CAMERA_SOURCES.WEBCAM, CAMERA_STATUS_MESSAGES.PI_UNAVAILABLE);
      await startWebcam();
    }
  }, [applyCameraSource, probePiReachable, startWebcam, stopWebcam]);

  // Declared after the camera helpers above so the effect references no
  // later-declared value (React Compiler immutability rule).
  useEffect(() => {
    (async () => { await initCameraSource(); })();
    return () => {
      cameraSessionRef.current += 1;
      abortActivePiRequests();
      clearPiPreview();
      stopWebcam();
    };
  }, [abortActivePiRequests, clearPiPreview, initCameraSource, stopWebcam]);

  // Manual camera source switch (Pi Camera / Laptop Webcam)
  const selectCameraSource = async (source) => {
    if (source === cameraSourceRef.current) return;
    cameraSessionRef.current += 1;
    abortActivePiRequests();
    clearPiPreview();
    setErrorMessage(null);
    if (source === CAMERA_SOURCES.PI) {
      const cameraSession = cameraSessionRef.current;
      const piReachable = await probePiReachable();
      if (cameraSession !== cameraSessionRef.current) return;
      if (piReachable) {
        stopWebcam();
        applyCameraSource(CAMERA_SOURCES.PI, CAMERA_STATUS_MESSAGES.PI_CONNECTED);
      } else {
        applyCameraSource(CAMERA_SOURCES.WEBCAM, CAMERA_STATUS_MESSAGES.PI_UNAVAILABLE);
        await startWebcam();
      }
    } else {
      applyCameraSource(CAMERA_SOURCES.WEBCAM, CAMERA_STATUS_MESSAGES.WEBCAM_ACTIVE);
      await startWebcam();
    }
  };

  const advanceStage = () => {
    if (stage === 'front') setStage('left');
    else if (stage === 'left') setStage('right');
    else {
      setStage('ready');
      stopWebcam();
    }
  };

  // Capture the current angle from the active source onto the hidden canvas.
  // Pi source pulls one fresh frame from /snapshot; after three consecutive
  // snapshot failures the page switches to the laptop webcam automatically.
  const capturePhoto = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    const maxWidth = 640;

    if (cameraSourceRef.current === CAMERA_SOURCES.PI) {
      let bitmap;
      const cameraSession = cameraSessionRef.current;
      const controller = new AbortController();
      piRequestControllersRef.current.add(controller);
      try {
        bitmap = await fetchPiSnapshotBitmap({ signal: controller.signal });
        piFailStreakRef.current = 0;
      } catch (error) {
        if (error?.code === 'aborted' || cameraSession !== cameraSessionRef.current) return;
        piFailStreakRef.current += 1;
        if (piFailStreakRef.current >= 3) {
          applyCameraSource(CAMERA_SOURCES.WEBCAM, CAMERA_STATUS_MESSAGES.PI_UNAVAILABLE);
          await startWebcam();
          setErrorMessage("Pi Camera stopped responding — switched to the laptop webcam. Capture again.");
        } else {
          setErrorMessage("Pi Camera snapshot failed. Please try capturing again.");
        }
        return;
      } finally {
        piRequestControllersRef.current.delete(controller);
      }
      if (cameraSession !== cameraSessionRef.current || cameraSourceRef.current !== CAMERA_SOURCES.PI) {
        try { bitmap?.close?.(); } catch { /* ignore */ }
        return;
      }
      drawBitmapToCanvasAndClose(bitmap, canvas, { maxWidth });
    } else {
      const video = videoRef.current;
      if (!video || !video.videoWidth) return;
      const scale = Math.min(1, maxWidth / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
    }

    const imageDataUrl = canvas.toDataURL('image/jpeg', 0.75);
    setErrorMessage(null);
    setPhotos(prev => ({ ...prev, [stage]: imageDataUrl }));
    advanceStage();
  };

  const switchMode = (mode) => {
    if (mode === enrollmentMode) return;
    setEnrollmentMode(mode);
    setPhotos({ front: null, left: null, right: null });
    setErrorMessage(null);
    setStage('front');
    if (mode === 'camera') {
      initCameraSource();
    } else {
      cameraSessionRef.current += 1;
      abortActivePiRequests();
      clearPiPreview();
      stopWebcam();
    }
  };

  const handleFileUpload = (angle, file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErrorMessage("Please upload an image file for facial enrollment.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      setPhotos(prev => ({ ...prev, [angle]: e.target.result }));
      setErrorMessage(null);
    };
    reader.readAsDataURL(file);
  };

  const resetCapture = () => {
    setPhotos({ front: null, left: null, right: null });
    setErrorMessage(null);
    setStage('front');
    if (enrollmentMode === 'camera') initCameraSource();
  };

  const submitEnrollment = async () => {
    setLoading(true);
    setErrorMessage(null); // Clear any previous errors

    try {
      // Relative path uses the Vite proxy locally; VITE_API_BASE_URL targets the
      // deployed Node backend in production. Photos exist only in memory here —
      // the backend converts them to a protected biometric template and discards them.
      await axios.post(`${API_BASE_URL}/user/enroll-face`, {
        images: photos,
        targetUserId: targetUserId ? Number(targetUserId) : undefined
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      // Navigate to dashboard on success
      navigate(returnTo, {
        state: {
          notice: isReEnrollment
            ? `Face ID re-enrolled for ${displayName}.`
            : "Biometric enrollment successful."
        }
      });
    } catch (error) {
      console.error("Enrollment failed:", error);

      // Extract specific error from backend if available. A Node/FastAPI outage
      // surfaces here as an error banner — it must NOT switch the camera source.
      const backendError = error.response?.data?.error || "Facial vectoring failed. Ensure face is clearly visible.";
      setErrorMessage(backendError);
    } finally {
      setLoading(false);
    }
  };

  const getInstructions = () => {
    if (enrollmentMode === 'upload') {
      return allUploaded ? "All angles uploaded. Ready to submit." : "Upload a clear photo for each angle below.";
    }
    switch(stage) {
      case 'front': return "Look directly at the camera.";
      case 'left': return "Turn your head slightly to the left.";
      case 'right': return "Turn your head slightly to the right.";
      case 'ready': return "All angles captured successfully.";
      default: return "";
    }
  };

  const isPiPreview = enrollmentMode === 'camera' && cameraSource === CAMERA_SOURCES.PI;

  return (
    <div className="enrollment-layout">
      <div className="enrollment-card">
        <div className="enrollment-header">
          <span className="security-icon">🛡️</span>
          <h2>{isReEnrollment ? 'Re-enroll Face ID' : 'Mandatory Biometric Setup'}</h2>
          <p>
            {isReEnrollment
              ? `Updating biometric access for ${displayName}. Capture or upload 3 fresh angles.`
              : `Welcome, ${displayName}. We need 3 angles to build a robust factory access profile.`}
          </p>
        </div>

        {/* --- MODE TOGGLE --- */}
        <div className="mode-toggle">
          <button className={`mode-btn ${enrollmentMode === 'camera' ? 'active' : ''}`} onClick={() => switchMode('camera')}>
            📷 Use Camera
          </button>
          <button className={`mode-btn ${enrollmentMode === 'upload' ? 'active' : ''}`} onClick={() => switchMode('upload')}>
            ⬆ Upload Photos
          </button>
        </div>

        {/* --- CAMERA SOURCE (Pi primary / webcam fallback) --- */}
        {enrollmentMode === 'camera' && (
          <div className="camera-source-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', flexWrap: 'wrap', margin: '10px 0' }}>
            <button
              type="button"
              onClick={() => selectCameraSource(CAMERA_SOURCES.PI)}
              style={{
                padding: '5px 12px', borderRadius: 8, cursor: 'pointer', fontSize: '0.8rem',
                border: cameraSource === CAMERA_SOURCES.PI ? '1px solid #3b82f6' : '1px solid #334155',
                background: cameraSource === CAMERA_SOURCES.PI ? '#1d4ed8' : '#1e293b', color: '#e2e8f0'
              }}
            >
              Raspberry Pi Camera Module 3
            </button>
            <button
              type="button"
              onClick={() => selectCameraSource(CAMERA_SOURCES.WEBCAM)}
              style={{
                padding: '5px 12px', borderRadius: 8, cursor: 'pointer', fontSize: '0.8rem',
                border: cameraSource === CAMERA_SOURCES.WEBCAM ? '1px solid #3b82f6' : '1px solid #334155',
                background: cameraSource === CAMERA_SOURCES.WEBCAM ? '#1d4ed8' : '#1e293b', color: '#e2e8f0'
              }}
            >
              Laptop Webcam
            </button>
            <span style={{ color: '#38bdf8', fontSize: '0.78rem' }}>{cameraStatusMsg}</span>
          </div>
        )}

        <div className="progress-tracker">
            <span className={`tracker-badge ${photos.front ? 'done' : enrollmentMode === 'camera' && stage === 'front' ? 'active' : ''}`}>Front</span>
            <span className="tracker-line"></span>
            <span className={`tracker-badge ${photos.left ? 'done' : enrollmentMode === 'camera' && stage === 'left' ? 'active' : ''}`}>Left</span>
            <span className="tracker-line"></span>
            <span className={`tracker-badge ${photos.right ? 'done' : enrollmentMode === 'camera' && stage === 'right' ? 'active' : ''}`}>Right</span>
        </div>

        <div className="camera-container">
          <canvas ref={canvasRef} style={{ display: 'none' }} />

          {enrollmentMode === 'camera' ? (
            stage === 'ready' ? (
              <div className="preview-grid">
                <img src={photos.front} alt="Front" className="preview-thumb" />
                <img src={photos.left} alt="Left" className="preview-thumb" />
                <img src={photos.right} alt="Right" className="preview-thumb" />
              </div>
            ) : (
              <div className="video-wrapper">
                {isPiPreview && PI_CAMERA_STREAM_URL && (
                  <img
                    ref={piPreviewRef}
                    src={PI_CAMERA_STREAM_URL}
                    alt="Raspberry Pi camera live preview"
                    className="live-video"
                    style={{ transform: 'none' }} /* Pi view is not a mirror */
                  />
                )}
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="live-video"
                  style={isPiPreview ? { display: 'none' } : undefined}
                />
                <div className={`face-guide-overlay ${stage}`}></div>
              </div>
            )
          ) : (
            <div className="upload-grid">
              {['front', 'left', 'right'].map((angle) => (
                <label key={angle} className={`upload-zone ${photos[angle] ? 'uploaded' : ''}`}>
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={(e) => handleFileUpload(angle, e.target.files[0])}
                  />
                  {photos[angle] ? (
                    <>
                      <img src={photos[angle]} alt={angle} className="upload-preview" />
                      <span className="upload-label done-label">✓ {angle.charAt(0).toUpperCase() + angle.slice(1)}</span>
                    </>
                  ) : (
                    <>
                      <span className="upload-icon">+</span>
                      <span className="upload-label">{angle.charAt(0).toUpperCase() + angle.slice(1)}</span>
                    </>
                  )}
                </label>
              ))}
            </div>
          )}
        </div>

        {errorMessage && (
            <div className="error-banner">
                <span className="error-icon">⚠️</span>
                {errorMessage}
            </div>
        )}

        <h3 className="instruction-text">{getInstructions()}</h3>

        <div className="enrollment-actions">
          {enrollmentMode === 'camera' ? (
            stage !== 'ready' ? (
              <button className="capture-btn" onClick={capturePhoto}>
                Capture {stage.charAt(0).toUpperCase() + stage.slice(1)}
              </button>
            ) : (
              <>
                <button className="retake-btn" onClick={resetCapture} disabled={loading}>Start Over</button>
                <button className="submit-btn" onClick={submitEnrollment} disabled={loading}>
                  {loading ? "Vectoring..." : isReEnrollment ? "Save New Face ID" : "Confirm & Unlock System"}
                </button>
              </>
            )
          ) : (
            <>
              <button className="retake-btn" onClick={resetCapture} disabled={loading}>Clear All</button>
              <button className="submit-btn" onClick={submitEnrollment} disabled={!allUploaded || loading}>
                {loading ? "Vectoring..." : isReEnrollment ? "Save New Face ID" : "Confirm & Unlock System"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default FaceEnrollment;
