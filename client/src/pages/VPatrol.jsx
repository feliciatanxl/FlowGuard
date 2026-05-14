import React from 'react';
import Sidebar from '../components/Sidebar';
import '../css/Dashboard.css';
import '../css/VPatrol.css'; // Add this specific CSS file

const VPatrol = () => {
  const incidentLogs = [
    { id: '#LOG-882', time: '10:24 AM', type: 'PPE Violation', desc: 'Missing hardhat detected in Sector 2.', severity: 'high', icon: '⚠️' },
    { id: '#LOG-881', time: '09:15 AM', type: 'Unauthorized Access', desc: 'Unknown personnel in Server Room.', severity: 'critical', icon: '🚨' },
    { id: '#LOG-880', time: '08:05 AM', type: 'Hygiene Check', desc: 'Routine scan completed successfully.', severity: 'safe', icon: '✅' },
    { id: '#LOG-879', time: 'Yesterday', type: 'Crowd Anomaly', desc: 'Congestion detected at Shift Change point.', severity: 'medium', icon: '👥' },
  ];

  return (
    <div className="dashboard-layout">
      <Sidebar />
      <main className="dashboard-main">
        <header className="dashboard-header">
          <div className="header-titles">
            <h1>V-Patrol AI Log</h1>
            <p>Automated anomaly detection and safety incident timeline</p>
          </div>
          <button className="export-pdf-btn">Export PDF</button>
        </header>

        <div className="vpatrol-container">
          <div className="incident-feed">
            {incidentLogs.map((log) => (
              <div key={log.id} className={`incident-row severity-${log.severity}`}>
                <div className="incident-time">
                  <strong>{log.time}</strong>
                  <span>{log.id}</span>
                </div>
                <div className="incident-details">
                  <div className="type-group">
                    <span className="log-icon">{log.icon}</span>
                    <h3>{log.type}</h3>
                  </div>
                  <p>{log.desc}</p>
                </div>
                <div className="incident-action">
                  <button className="review-btn">Review Footage</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
};

export default VPatrol;