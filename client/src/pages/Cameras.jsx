import React from 'react';
import Sidebar from '../components/Sidebar';
import '../css/Dashboard.css';

const Cameras = () => {
  // Mock data for your factory cameras
  const cameraFeeds = [
    { id: 'CAM-01', zone: 'Sector 1 - Loading Bay', status: 'Live', alert: false },
    { id: 'CAM-02', zone: 'Sector 2 - Assembly Line', status: 'Live', alert: false },
    { id: 'CAM-03', zone: 'Sector 3 - Chemical Storage', status: 'Warning', alert: true },
    { id: 'CAM-04', zone: 'Sector 4 - Command Center', status: 'Offline', alert: false },
    { id: 'CAM-05', zone: 'Sector 1 - Main Gate', status: 'Live', alert: false },
    { id: 'CAM-06', zone: 'Sector 2 - Packaging', status: 'Live', alert: false },
  ];

  return (
    <div className="dashboard-layout">
      <Sidebar />
      <main className="dashboard-main">
        <header className="dashboard-header">
          <div className="header-titles">
            <h1>Camera Network</h1>
            <p>Live node status and CCTV network overview</p>
          </div>
          <button className="action-btn edit-btn">Scan Network</button>
        </header>

        <div className="camera-grid">
          {cameraFeeds.map((cam) => (
            <div key={cam.id} className={`camera-card ${cam.alert ? 'camera-alert' : ''}`}>
              <div className="camera-feed-placeholder">
                {/* This is where a real video stream component would go */}
                {cam.status === 'Offline' ? (
                  <span className="feed-offline-text">NO SIGNAL</span>
                ) : (
                  <span className="feed-live-icon">⏺ REC</span>
                )}
              </div>
              <div className="camera-info">
                <div className="cam-title-row">
                  <h3>{cam.id}</h3>
                  <span className={`status-dot ${cam.status === 'Live' ? 'dot-online' : cam.status === 'Warning' ? 'dot-warning' : 'dot-offline'}`}></span>
                </div>
                <p>{cam.zone}</p>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
};

export default Cameras;