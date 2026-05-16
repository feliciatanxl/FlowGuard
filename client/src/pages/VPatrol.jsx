import React, { useRef, useState, useEffect } from 'react';
import axios from 'axios';
import Sidebar from '../components/Sidebar';
import '../css/Dashboard.css';
import '../css/VPatrol.css'; 

const VPatrol = () => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  
  // Staged States: SYSTEM_ACTIVE, PRESENCE_DETECTED, TARGET_LOCKING, LIVENESS_CHECK, SECURE_MATCH, UNKNOWN_QUERY
  const [scanStatus, setScanStatus] = useState("SYSTEM_ACTIVE"); 
  const [identifiedUser, setIdentifiedUser] = useState(null);
  const [faceBox, setFaceBox] = useState(null); 
  const [scanProgress, setScanProgress] = useState(0); 
  
  const scanStatusRef = useRef("SYSTEM_ACTIVE");
  const lockTimerRef = useRef(null);
  const progressIntervalRef = useRef(null);

  // LIVENESS MEMORY: Tracks the head-turn validation
  const candidateUserRef = useRef(null); 
  const lastLogRef = useRef({ name: null, timestamp: 0 });

  const [systemTime, setSystemTime] = useState(new Date().toLocaleTimeString('en-SG', { 
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true 
  }));

  const [incidentLogs, setIncidentLogs] = useState([]);

  const token = localStorage.getItem("accessToken");
  const NODE_SERVER_URL = "http://localhost:5000/api/security/logs"; 

  const changeScanState = (nextState) => {
    setScanStatus(nextState);
    scanStatusRef.current = nextState;
  };

  useEffect(() => {
    startCCTV();

    // FETCH PERMANENT LOGS ON LOAD
    axios.get(NODE_SERVER_URL, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => {
        if (res.data && res.data.length > 0) {
          setIncidentLogs(res.data);
        } else {
          setIncidentLogs([{ id: 'SYS-001', time: new Date().toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }), type: 'System Online', desc: 'Biometric sensors initialized.', severity: 'safe', icon: '✅' }]);
        }
      })
      .catch(err => {
        console.error("Database connection waiting...", err);
        setIncidentLogs([{ id: 'SYS-001', time: new Date().toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }), type: 'System Offline', desc: 'Cannot connect to security database.', severity: 'critical', icon: '⚠️' }]);
      });

    const clockInterval = setInterval(() => {
      setSystemTime(new Date().toLocaleTimeString('en-SG', { 
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true 
      }));
    }, 1000);

    const scanInterval = setInterval(() => { 
      performLiveScan(); 
    }, 800); 

    return () => {
      stopCCTV();
      clearInterval(clockInterval);
      clearInterval(scanInterval);
      if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    };
  }, []);

  const startCCTV = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" } 
      });
      if (videoRef.current) videoRef.current.srcObject = stream;
      changeScanState("SYSTEM_ACTIVE");
    } catch (err) { 
      changeScanState("HARDWARE_ERR"); 
    }
  };

  const stopCCTV = () => {
    if (videoRef.current?.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(track => track.stop());
    }
  };

  const playFeedback = (type) => {
    const audioPath = type === 'success' ? '/sounds/success.mp3' : '/sounds/denied.mp3';
    const audio = new Audio(audioPath);
    audio.volume = 0.4; 
    audio.play().catch(() => console.log("Audio waiting for user gesture"));
  };

  // 🎯 HELPER: Handles DB logging after Liveness is proven
  const grantFinalAccess = (detectedName) => {
    playFeedback('success');
    changeScanState("SECURE_MATCH");
    setIdentifiedUser(detectedName);
    setScanProgress(100);
    
    const currentTimestamp = Date.now();
    const logTimeStr = new Date().toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

    if (lastLogRef.current.name !== detectedName || (currentTimestamp - lastLogRef.current.timestamp > 30000)) {
      const newLog = {
        id: `ACC-${Math.floor(Math.random() * 900) + 100}`,
        time: logTimeStr,
        type: 'Gantry Access',
        desc: `Identity & Liveness Verified: ${detectedName}`,
        severity: 'safe',
        icon: '🔓',
        personnelName: detectedName // 🎯 NEW: Linked Directly to backend schemas column
      };
      
      setIncidentLogs(prev => [newLog, ...prev.slice(0, 14)]); 
      lastLogRef.current = { name: detectedName, timestamp: currentTimestamp };
      
      // BURN TO NODE.JS DATABASE
      axios.post(NODE_SERVER_URL, newLog, { headers: { Authorization: `Bearer ${token}` } })
        .catch(e => console.log("DB Save Failed", e));
    }

    setTimeout(() => { resetScanner(); }, 3500);
  };

  const performLiveScan = async () => {
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
      const res = await axios.post('/ai/user/recognize', 
        { image: imageBase64 }, 
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (scanStatusRef.current === "SECURE_MATCH" || scanStatusRef.current === "UNKNOWN_QUERY") return;

      if (res.data && res.data.box && res.data.box.length >= 4) {
        
        let rawX, rawY, boxWidth, boxHeight;
        const [v1, v2, v3, v4] = res.data.box;

        if (v2 > v4 && v3 > v1) {
            rawY = v1;           
            rawX = v4;           
            boxWidth = v2 - v4;  
            boxHeight = v3 - v1; 
        } else {
            rawX = v1;
            rawY = v2;
            boxWidth = v3;
            boxHeight = v4;
        }
        
        const faceProximityPercentage = (boxWidth / video.videoWidth) * 100; 
        const livenessRatio = res.data.liveness_ratio || 0.5; // 🎯 FIX: Changed from currentEAR to match Python math changes

        const targetBox = {
          left: `${(rawX / video.videoWidth) * 100}%`,
          top: `${(rawY / video.videoHeight) * 100}%`,
          width: `${(boxWidth / video.videoWidth) * 100}%`,
          height: `${(boxHeight / video.videoHeight) * 100}%`
        };

        if (faceProximityPercentage < 8 && scanStatusRef.current !== "LIVENESS_CHECK") {
          if (scanStatusRef.current === "SYSTEM_ACTIVE" || scanStatusRef.current === "PRESENCE_DETECTED") {
            changeScanState("PRESENCE_DETECTED");
            setFaceBox(null); 
            setScanProgress(0);
          }
          return;
        }

        // 🎯 STAGE 3: THE 3D HEAD-TURN LIVENESS CHECK
        if (scanStatusRef.current === "LIVENESS_CHECK") {
          setFaceBox(targetBox); 
          
          // If the profile calculation swings left or right out of center bounds, confirm human activity
          if (livenessRatio < 0.35 || livenessRatio > 0.65) {
            grantFinalAccess(candidateUserRef.current);
          }
          return; 
        }

        // STAGE 2: TARGET LOCKING
        if (scanStatusRef.current === "SYSTEM_ACTIVE" || scanStatusRef.current === "PRESENCE_DETECTED") {
          changeScanState("TARGET_LOCKING");
          setFaceBox(targetBox);
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
            
            const currentTimestamp = Date.now();
            const logTimeStr = new Date().toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

            if (res.data.user && res.data.user.name !== "UNAUTHORIZED") {
              candidateUserRef.current = res.data.user.name;
              changeScanState("LIVENESS_CHECK");
            } else {
              playFeedback('denied');
              changeScanState("UNKNOWN_QUERY");
              setIdentifiedUser("UNKNOWN PERSONNEL");
              setScanProgress(0);

              if (lastLogRef.current.name !== "UNKNOWN" || (currentTimestamp - lastLogRef.current.timestamp > 10000)) {
                const newLog = {
                  id: `SEC-${Math.floor(Math.random() * 900) + 100}`,
                  time: logTimeStr,
                  type: 'Intrusion Alert',
                  desc: 'Unregistered personnel detected at gantry.',
                  severity: 'critical',
                  icon: '🚨',
                  personnelName: null
                };

                setIncidentLogs(prev => [newLog, ...prev.slice(0, 14)]);
                lastLogRef.current = { name: "UNKNOWN", timestamp: currentTimestamp };
                
                axios.post(NODE_SERVER_URL, newLog, { headers: { Authorization: `Bearer ${token}` } })
                  .catch(e => console.log("DB Save Failed", e));
              }

              setTimeout(() => { resetScanner(); }, 3500);
            }
          }, 1800);

        } else if (scanStatusRef.current === "TARGET_LOCKING") {
          setFaceBox(targetBox);
        }

      } else {
        if (scanStatusRef.current !== "LIVENESS_CHECK" && scanStatusRef.current !== "TARGET_LOCKING") {
          resetScanner();
        }
      }
    } catch (err) {
      console.error("AI Command Loop Fault:", err);
    }
  };

  const resetScanner = () => {
    setIdentifiedUser(null);
    setFaceBox(null);
    setScanProgress(0);
    candidateUserRef.current = null;
    changeScanState("SYSTEM_ACTIVE");
  };

  return (
    <div className="dashboard-layout">
      <Sidebar />
      <main className="dashboard-main">
        <header className="dashboard-header">
          <div className="header-titles">
            <h1>V-Patrol AI Command Center</h1>
            <p>Real-time biometric gantry and anomaly detection timeline</p>
          </div>
        </header>

        <div className="vpatrol-grid">
          <div className="vpatrol-card monitor-section">
            <div className={`cctv-container state-theme-${scanStatus.toLowerCase()}`}>
              <video ref={videoRef} autoPlay playsInline muted className="video-feed" />
              <canvas ref={canvasRef} style={{ display: 'none' }} />
              
              {faceBox && (
                <div 
                  className={`face-tracking-box state-${scanStatus.toLowerCase()}`}
                  style={{
                    top: faceBox.top,
                    left: faceBox.left,
                    width: faceBox.width,
                    height: faceBox.height
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
                      {scanStatus === "LIVENESS_CHECK" && "⚠️ LIVENESS CHECK"}
                      {scanStatus === "SECURE_MATCH" && "✓ GRANT ACCESS"}
                      {scanStatus === "UNKNOWN_QUERY" && "🚨 ACCESS DENIED"}
                    </span>
                    <span className="person-name-label">
                      {scanStatus === "TARGET_LOCKING" && "LOCKING VECTORS..."}
                      {scanStatus === "LIVENESS_CHECK" && "TURN HEAD SLIGHTLY"}
                      {scanStatus === "SECURE_MATCH" && identifiedUser}
                      {scanStatus === "UNKNOWN_QUERY" && "SUSPICIOUS ACTIVITY"}
                    </span>
                  </div>
                </div>
              )}

              <div className="hud-overlay">
                <div className="hud-top">
                  <div className="hud-left-meta">
                    <span className="hud-node">SYS_MODE // BIOMETRIC_GANTRY</span>
                    {scanStatus === "PRESENCE_DETECTED" && (
                      <span className="hud-radar-alert">⚠️ PROXIMITY SIGNAL DETECTED</span>
                    )}
                  </div>
                  <span className={`hud-status-badge status-${scanStatus.toLowerCase()}`}>
                    {scanStatus === "SYSTEM_ACTIVE" && "● IDLE MONITORING"}
                    {scanStatus === "PRESENCE_DETECTED" && "⚡ MOTION ACQUIRED"}
                    {scanStatus === "TARGET_LOCKING" && "⏳ VECTOR LOCK ACTIVE"}
                    {scanStatus === "LIVENESS_CHECK" && "🔄 AWAITING MOVEMENT"}
                    {scanStatus === "SECURE_MATCH" && "SUCCESS MATCH"}
                    {scanStatus === "UNKNOWN_QUERY" && "ALERT WARNING"}
                  </span>
                </div>
                
                <div className="hud-bottom">
                  <div className="hud-coordinates-telemetry">
                    <p>LAT: 1.3521° N // LON: 103.8198° E</p>
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
            
            <div className="vpatrol-list">
              {incidentLogs.length > 0 ? incidentLogs.map((log) => (
                <div key={log.id} className={`vpatrol-item ${log.severity}`}>
                  <div className="item-header">
                    <span className="item-id">#{log.id}</span>
                    <span className="item-type-timestamp">{log.time}</span>
                  </div>
                  <div className="item-body">
                    <div className="item-icon">{log.icon}</div>
                    <div className="item-text">
                      <h4>{log.type}</h4>
                      <p>{log.desc}</p>
                    </div>
                  </div>
                </div>
              )) : <p>Initializing security sensors...</p>}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default VPatrol;