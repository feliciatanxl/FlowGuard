import React, { useRef, useState, useEffect } from 'react';
import axios from 'axios';
import Sidebar from '../components/Sidebar';
import '../css/Dashboard.css';
import '../css/VPatrol.css'; // Reusing your high-tech tracking box and HUD dashboard styles

const GateScanner = () => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  
  const [scanStatus, setScanStatus] = useState("SYSTEM_ACTIVE"); 
  const [displayMessage, setDisplayMessage] = useState("PLACE FACE IN VIEWPORT");
  const [faceBox, setFaceBox] = useState(null); 
  const [scanProgress, setScanProgress] = useState(0); 
  
  const scanStatusRef = useRef("SYSTEM_ACTIVE");
  const lockTimerRef = useRef(null);
  const progressIntervalRef = useRef(null);
  const candidateUserRef = useRef(null); 

  const token = localStorage.getItem("accessToken");
  const ATTENDANCE_SCAN_URL = "http://localhost:5000/api/attendance/scan";

  const changeScanState = (nextState, message) => {
    setScanStatus(nextState);
    scanStatusRef.current = nextState;
    if (message) setDisplayMessage(message);
  };

  useEffect(() => {
    startGateCamera();
    const scanInterval = setInterval(() => performPerimeterScan(), 800); 

    return () => {
      stopGateCamera();
      clearInterval(scanInterval);
      if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    };
  }, []);

  const startGateCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" } 
      });
      if (videoRef.current) videoRef.current.srcObject = stream;
      changeScanState("SYSTEM_ACTIVE", "GATE TURNSTILE ONLINE // AWAITING TARGET");
    } catch (err) { 
      changeScanState("HARDWARE_ERR", "HARDWARE FAILURE: CAMERA NOT DETECTED"); 
    }
  };

  const stopGateCamera = () => {
    if (videoRef.current?.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(track => track.stop());
    }
  };

  const processAttendanceTransaction = async (verifiedName) => {
    changeScanState("SECURE_MATCH", "IDENTITY VERIFIED // PROCESSING TIMECARD");
    setScanProgress(100);

    try {
      // 🎯 Hit the Node.js automatic clock-in/out controller
      const res = await axios.post(ATTENDANCE_SCAN_URL, { name: verifiedName }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.data && res.data.action) {
        // Render the exact system response action directly onto the kiosk screen
        const actionMessage = res.data.action.replace(/_/g, " ");
        setDisplayMessage(`🔓 ${verifiedName}: ${actionMessage}`);
      }
    } catch (err) {
      console.error("Attendance Sync Failed:", err);
      setDisplayMessage("🚨 GATE TRANSACTION ROUTING FAULT");
    }

    setTimeout(() => { resetTurnstileKiosk(); }, 4000);
  };

  const performPerimeterScan = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    if (!video || !canvas || video.videoWidth === 0) return;
    if (scanStatusRef.current === "SECURE_MATCH" || scanStatusRef.current === "UNKNOWN_QUERY") return;

    const context = canvas.getContext('2d');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageBase64 = canvas.toDataURL('image/jpeg', 0.4);

    try {
      const res = await axios.post('/ai/user/recognize', { image: imageBase64 }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (scanStatusRef.current === "SECURE_MATCH" || scanStatusRef.current === "UNKNOWN_QUERY") return;

      if (res.data && res.data.box && res.data.box.length >= 4) {
        let rawX, rawY, boxWidth, boxHeight;
        const [v1, v2, v3, v4] = res.data.box;
        if (v2 > v4 && v3 > v1) { rawY = v1; rawX = v4; boxWidth = v2 - v4; boxHeight = v3 - v1; } 
        else { rawX = v1; rawY = v2; boxWidth = v3; boxHeight = v4; }
        
        const faceProximityPercentage = (boxWidth / video.videoWidth) * 100; 
        const livenessRatio = res.data.liveness_ratio || 0.5;

        const targetBox = {
          left: `${(rawX / video.videoWidth) * 100}%`, top: `${(rawY / video.videoHeight) * 100}%`,
          width: `${(boxWidth / video.videoWidth) * 100}%`, height: `${(boxHeight / video.videoHeight) * 100}%`
        };

        if (faceProximityPercentage < 8 && scanStatusRef.current !== "LIVENESS_CHECK") {
          changeScanState("PRESENCE_DETECTED", "TARGET DETECTED // MOVE CLOSER");
          setFaceBox(null); 
          return;
        }

        // 🎯 LIVENESS CHECK: Wait for head swing rotation
        if (scanStatusRef.current === "LIVENESS_CHECK") {
          setFaceBox(targetBox);
          if (livenessRatio < 0.35 || livenessRatio > 0.65) {
            await processAttendanceTransaction(candidateUserRef.current);
          }
          return;
        }

        // TARGET LOCKING SEQUENCE
        if (scanStatusRef.current === "SYSTEM_ACTIVE" || scanStatusRef.current === "PRESENCE_DETECTED") {
          changeScanState("TARGET_LOCKING", "LOCKING BIOMETRIC VECTORS...");
          setFaceBox(targetBox);
          setScanProgress(12);

          let progress = 12;
          progressIntervalRef.current = setInterval(() => {
            progress += Math.floor(Math.random() * 14) + 4;
            if (progress >= 96) { setScanProgress(96); clearInterval(progressIntervalRef.current); } 
            else { setScanProgress(progress); }
          }, 120);

          lockTimerRef.current = setTimeout(() => {
            clearInterval(progressIntervalRef.current);

            if (res.data.user && res.data.user.name !== "UNAUTHORIZED") {
              candidateUserRef.current = res.data.user.name;
              changeScanState("LIVENESS_CHECK", "VERIFYING LIVENESS: TURN HEAD SLIGHTLY");
            } else {
              changeScanState("UNKNOWN_QUERY", "🚨 PERIMETER BREACH: ACCESS DENIED");
              setScanProgress(0);
              setTimeout(() => { resetTurnstileKiosk(); }, 3500);
            }
          }, 1800);
        } else if (scanStatusRef.current === "TARGET_LOCKING") {
          setFaceBox(targetBox);
        }
      } else {
        if (scanStatusRef.current !== "LIVENESS_CHECK" && scanStatusRef.current !== "TARGET_LOCKING") {
          resetTurnstileKiosk();
        }
      }
    } catch (err) {
      console.error("Gate AI Link Fault:", err);
    }
  };

  const resetTurnstileKiosk = () => {
    setFaceBox(null);
    setScanProgress(0);
    candidateUserRef.current = null;
    changeScanState("SYSTEM_ACTIVE", "GATE TURNSTILE ONLINE // AWAITING TARGET");
  };

  return (
    <div className="dashboard-layout">
      <Sidebar />
      <main className="dashboard-main gate-main">
        <header className="dashboard-header">
          <div className="header-titles">
            <h1>Perimeter Gate Attendance Terminal</h1>
            <p>Main Facility Entrance Turnstile Facial Recognition Interface</p>
          </div>
        </header>

        <div className="vpatrol-grid" style={{ gridTemplateColumns: '1fr' }}>
          <div className="vpatrol-card monitor-section">
            <div className={`cctv-container state-theme-${scanStatus.toLowerCase()}`} style={{ width: '100%', height: '100%' }}>
              <video ref={videoRef} autoPlay playsInline muted className="video-feed" />
              <canvas ref={canvasRef} style={{ display: 'none' }} />
              
              {faceBox && (
                <div className={`face-tracking-box state-${scanStatus.toLowerCase()}`} style={{ top: faceBox.top, left: faceBox.left, width: faceBox.width, height: faceBox.height }}>
                  <div className="corner-bracket top-left"></div>
                  <div className="corner-bracket top-right"></div>
                  <div className="corner-bracket bottom-left"></div>
                  <div className="corner-bracket bottom-right"></div>
                  {scanStatus === "TARGET_LOCKING" && <div className="matrix-scan-line"></div>}
                  
                  <div className="box-identity-panel">
                    <span className="access-status-label">
                      {scanStatus === "TARGET_LOCKING" && `ANALYZING: ${scanProgress}%`}
                      {scanStatus === "LIVENESS_CHECK" && "⚠️ ANTI-SPOOF ACTIVE"}
                      {scanStatus === "SECURE_MATCH" && "✓ ACCESS GRANTED"}
                      {scanStatus === "UNKNOWN_QUERY" && "🚨 PERIMETER ALERT"}
                    </span>
                    <span className="person-name-label">{displayMessage}</span>
                  </div>
                </div>
              )}

              <div className="hud-overlay">
                <div className="hud-top">
                  <div className="hud-left-meta">
                    <span className="hud-node">PORTAL_NODE // SOUTH_ENTRANCE_TURNSTILE</span>
                  </div>
                  <span className={`hud-status-badge status-${scanStatus.toLowerCase()}`}>
                    {scanStatus === "SYSTEM_ACTIVE" && "● SYSTEM ARMED"}
                    {scanStatus === "LIVENESS_CHECK" && "🔄 PROCESSING 3D PROFILE"}
                    {scanStatus === "SECURE_MATCH" && "TURNSTILE UNLOCKED"}
                    {scanStatus === "UNKNOWN_QUERY" && "THREAT REJECTED"}
                  </span>
                </div>
                <div className="hud-bottom">
                  <p className="hud-engine-log" style={{ color: '#3b82f6' }}>TERMINAL STATE: {displayMessage}</p>
                </div>
              </div>

            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default GateScanner;