import React, { useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import '../css/Enrollment.css'; 

const FaceEnrollment = () => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const navigate = useNavigate();

  // State to track which angle we are capturing
  const [stage, setStage] = useState('front'); // 'front', 'left', 'right', 'ready'
  const [photos, setPhotos] = useState({ front: null, left: null, right: null });
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null); // New state for custom UI error

  const token = localStorage.getItem("accessToken");
  const userName = localStorage.getItem("userName");

  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, []);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: 720, height: 720, facingMode: "user" } 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Camera access denied", err);
      setErrorMessage("Camera access denied. Please enable permissions to continue.");
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = videoRef.current.srcObject.getTracks();
      tracks.forEach(track => track.stop());
    }
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    if (video && canvas) {
      const context = canvas.getContext('2d');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      const imageDataUrl = canvas.toDataURL('image/jpeg', 0.9);
      
      setPhotos(prev => ({ ...prev, [stage]: imageDataUrl }));
      
      if (stage === 'front') setStage('left');
      else if (stage === 'left') setStage('right');
      else {
        setStage('ready');
        stopCamera();
      }
    }
  };

  const resetCapture = () => {
    setPhotos({ front: null, left: null, right: null });
    setErrorMessage(null);
    setStage('front');
    startCamera();
  };

  const submitEnrollment = async () => {
    setLoading(true);
    setErrorMessage(null); // Clear any previous errors

    try {
      await axios.post('http://localhost:5000/user/enroll-face', {
        images: photos 
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      // Navigate to dashboard on success
      navigate('/dashboard'); 
    } catch (error) {
      console.error("Enrollment failed:", error);
      
      // Extract specific error from backend if available
      const backendError = error.response?.data?.error || "Facial vectoring failed. Ensure face is clearly visible.";
      setErrorMessage(backendError);
    } finally {
      setLoading(false);
    }
  };

  const getInstructions = () => {
    switch(stage) {
      case 'front': return "Look directly at the camera.";
      case 'left': return "Turn your head slightly to the left.";
      case 'right': return "Turn your head slightly to the right.";
      case 'ready': return "All angles captured successfully.";
      default: return "";
    }
  };

  return (
    <div className="enrollment-layout">
      <div className="enrollment-card">
        <div className="enrollment-header">
          <span className="security-icon">🛡️</span>
          <h2>Mandatory Biometric Setup</h2>
          <p>Welcome, {userName}. We need 3 angles to build a robust factory access profile.</p>
        </div>

        <div className="progress-tracker">
            <span className={`tracker-badge ${photos.front ? 'done' : stage === 'front' ? 'active' : ''}`}>Front</span>
            <span className="tracker-line"></span>
            <span className={`tracker-badge ${photos.left ? 'done' : stage === 'left' ? 'active' : ''}`}>Left</span>
            <span className="tracker-line"></span>
            <span className={`tracker-badge ${photos.right ? 'done' : stage === 'right' ? 'active' : ''}`}>Right</span>
        </div>

        <div className="camera-container">
          <canvas ref={canvasRef} style={{ display: 'none' }} />
          
          {stage === 'ready' ? (
            <div className="preview-grid">
                <img src={photos.front} alt="Front" className="preview-thumb" />
                <img src={photos.left} alt="Left" className="preview-thumb" />
                <img src={photos.right} alt="Right" className="preview-thumb" />
            </div>
          ) : (
            <div className="video-wrapper">
              <video ref={videoRef} autoPlay playsInline muted className="live-video" />
              <div className={`face-guide-overlay ${stage}`}></div> 
            </div>
          )}
        </div>

        {/* --- CUSTOM ERROR BANNER --- */}
        {errorMessage && (
            <div className="error-banner">
                <span className="error-icon">⚠️</span>
                {errorMessage}
            </div>
        )}

        <h3 className="instruction-text">{getInstructions()}</h3>

        <div className="enrollment-actions">
          {stage !== 'ready' ? (
            <button className="capture-btn" onClick={capturePhoto}>
              Capture {stage.charAt(0).toUpperCase() + stage.slice(1)}
            </button>
          ) : (
            <>
              <button className="retake-btn" onClick={resetCapture} disabled={loading}>
                Start Over
              </button>
              <button className="submit-btn" onClick={submitEnrollment} disabled={loading}>
                {loading ? "Vectoring..." : "Confirm & Unlock System"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default FaceEnrollment;