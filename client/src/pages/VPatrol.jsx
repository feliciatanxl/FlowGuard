import React, { useRef, useState, useEffect } from 'react';
import axios from 'axios';
import Sidebar from '../components/Sidebar';
import '../css/Dashboard.css';
import '../css/VPatrol.css'; 

const VPatrol = () => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  
  const [scanStatus, setScanStatus] = useState("INITIALIZING...");
  const [identifiedUser, setIdentifiedUser] = useState(null);
  const [lastScanTime, setLastScanTime] = useState(null);

  // --- STEP 1: ADD LIVE CLOCK STATE ---
  const [systemTime, setSystemTime] = useState(new Date().toLocaleTimeString('en-SG', { 
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true 
  }));

  const [incidentLogs, setIncidentLogs] = useState([
    { id: 'LOG-882', time: '10:24:05 PM', type: 'PPE Violation', desc: 'Missing hardhat in Sector 2.', severity: 'high', icon: '⚠️' },
    { id: 'LOG-881', time: '09:15:22 PM', type: 'Unauthorized Access', desc: 'Unknown personnel in Server Room.', severity: 'critical', icon: '🚨' },
    { id: 'LOG-880', time: '08:05:11 PM', type: 'Hygiene Check', desc: 'Routine scan successful.', severity: 'safe', icon: '✅' },
  ]);

  const token = localStorage.getItem("accessToken");

  // --- STEP 2: UPDATE THE USEEFFECT LOOP ---
  useEffect(() => {
    startCCTV();

    // LIVE CLOCK: Ticks every 1 second
    const clockInterval = setInterval(() => {
      setSystemTime(new Date().toLocaleTimeString('en-SG', { 
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true 
      }));
    }, 1000);

    // AI SCAN: Runs every 3 seconds
    const scanInterval = setInterval(() => { 
      performLiveScan(); 
    }, 3000);

    return () => {
      stopCCTV();
      clearInterval(clockInterval);
      clearInterval(scanInterval);
    };
  }, []);

  const startCCTV = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
      if (videoRef.current) videoRef.current.srcObject = stream;
      setScanStatus("SYSTEM_ACTIVE");
    } catch (err) { setScanStatus("HARDWARE_ERR"); }
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
    audio.play().catch(err => console.log("Audio waiting for interaction"));
  };

  const performLiveScan = async () => {
  const video = videoRef.current;
  const canvas = canvasRef.current;
  if (!video || !canvas) return;

  const context = canvas.getContext('2d');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  
  // High quality is good, but 0.6 keeps the Base64 string smaller for faster scans
  const imageBase64 = canvas.toDataURL('image/jpeg', 0.6);

  try {
    // FIX 1: Change port to 8000 to talk to the Python AI Service
    const res = await axios.post('http://localhost:8000/user/recognize', 
      { image: imageBase64 }, 
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const currentTime = new Date().toLocaleTimeString('en-SG', { 
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true 
    });
    
    // Always update the scan time to show the heartbeat is alive
    setLastScanTime(currentTime);

    // FIX 2: Handle the specific response from your AI Service
    // We check if res.data.user exists and that it's not the default "UNAUTHORIZED"
    if (res.data.user && res.data.user.name !== "UNAUTHORIZED") {
      setScanStatus("SECURE_MATCH");
      setIdentifiedUser(res.data.user.name);
      
      // Play "Access Granted" sound
      playFeedback('success'); 

      const newLog = {
        id: `ACC-${Math.floor(Math.random() * 900) + 100}`,
        time: currentTime,
        type: 'Gantry Access',
        desc: `Identity Verified: ${res.data.user.name}`,
        severity: 'safe',
        icon: '🔓'
      };
      
      setIncidentLogs(prev => [newLog, ...prev.slice(0, 5)]);

      // Optional: Post the log to your Node backend (Port 5000) for persistent audit
      await axios.post('http://localhost:5000/api/security/logs', newLog, {
        headers: { Authorization: `Bearer ${token}` }
      });

    } else {
      // Logic for Access Denied
      setScanStatus("UNKNOWN_QUERY");
      setIdentifiedUser("ACCESS_DENIED");
      
      // Play "Buzzer" sound
      playFeedback('denied');
    }
  } catch (err) {
    // If the Python server is off, this catch block triggers
    console.error("AI Service Offline:", err);
    setScanStatus("SCANNING...");
  }
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
            <div className="cctv-container">
              <video ref={videoRef} autoPlay playsInline muted className="video-feed" />
              <canvas ref={canvasRef} style={{ display: 'none' }} />
              
              <div className={`hud-overlay ${scanStatus.toLowerCase()}`}>
                <div className="hud-top">
                  <span className="hud-node">NODE_A1 // OS_V2.1</span>
                  <span className="hud-status">{scanStatus}</span>
                </div>
                
                {identifiedUser && (
                  <div className="identity-osd">
                    <div className="osd-scanner-line"></div>
                    <p>BIOMETRIC_ID</p>
                    <h2>{identifiedUser}</h2>
                  </div>
                )}

                <div className="hud-bottom">
                  <p>1.3521 N / 103.8198 E</p>
                  {/* --- STEP 3: USE SYSTEMTIME INSTEAD OF LASTSCANTIME --- */}
                  <p className="hud-clock">{systemTime}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="vpatrol-card timeline-section">
            <div className="section-header">
              <h2>Security Timeline</h2>
              <button className="export-csv-btn">Export_CSV</button>
            </div>
            
            <div className="vpatrol-list">
              {incidentLogs.length > 0 ? incidentLogs.map((log) => (
                <div key={log.id} className={`vpatrol-item ${log.severity}`}>
                  <div className="item-header">
                    <span className="item-id">#{log.id}</span>
                    <span className="item-time">{log.time}</span>
                  </div>
                  <div className="item-body">
                    <div className="item-icon">{log.icon}</div>
                    <div className="item-text">
                      <h4>{log.type}</h4>
                      <p>{log.desc}</p>
                    </div>
                  </div>
                  <button className="item-action-btn">Review Evidence</button>
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