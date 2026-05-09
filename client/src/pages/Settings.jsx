import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import LogoIcon from '../components/LogoIcon';
import '../css/Dashboard.css';
import '../css/Settings.css';

const Settings = () => {
  const [alertsEnabled, setAlertsEnabled] = useState(true);
  const [autoRecord, setAutoRecord] = useState(true);
  const [ppeStrictness, setPpeStrictness] = useState(85);

  return (
    <div className="dashboard-layout">
      {/* --- SIDEBAR (Exact match to your dashboard) --- */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <LogoIcon size={28} />
          <h2 className="gradient-text" style={{ fontSize: '1.4rem', margin: 0 }}>FlowGuard</h2>
        </div>
        <nav className="sidebar-nav">
          <Link to="/dashboard">Dashboard</Link>
          <Link to="/cameras">Cameras</Link>
          <Link to="/innovation">V-Patrol</Link>
          <Link to="/reports">Reports</Link>
          <Link to="/users">Users</Link>
          <Link to="/settings" className="active-nav-item">Settings</Link>
        </nav>
        <div className="sidebar-bottom">
          <div className="user-profile">
            <span className="user-avatar">👤</span>
            <span className="user-name">admin</span>
          </div>
          <Link to="/" className="logout-btn">Log Out</Link>
        </div>
      </aside>

      {/* --- MAIN SETTINGS CONTENT --- */}
      <main className="dashboard-main">
        <header className="dashboard-header settings-header">
          <div className="header-titles">
            <h1>System Configuration</h1>
            <p>Manage AI thresholds, camera networks, and alert routing</p>
          </div>
          {/* Button removed from here! */}
        </header>

        <div className="settings-grid">
          {/* AI Configuration Card */}
          <section className="settings-card">
            <div className="card-header">
              <h3>🧠 FlowGuard AI Engine</h3>
              <p>Adjust the machine learning detection parameters.</p>
            </div>
            
            <div className="setting-row">
              <div className="setting-info">
                <h4>PPE Detection Strictness</h4>
                <p>Minimum confidence required to flag an anomaly.</p>
              </div>
              <div className="setting-control slider-control">
                <span className="slider-value">{ppeStrictness}%</span>
                <input 
                  type="range" min="50" max="99" 
                  value={ppeStrictness} 
                  onChange={(e) => setPpeStrictness(e.target.value)} 
                />
              </div>
            </div>

            <div className="setting-row">
              <div className="setting-info">
                <h4>Auto-Record on Incident</h4>
                <p>Save 30 seconds of footage before and after a triggered alert.</p>
              </div>
              <div className="setting-control">
                <label className="toggle-switch">
                  <input type="checkbox" checked={autoRecord} onChange={() => setAutoRecord(!autoRecord)} />
                  <span className="toggle-slider"></span>
                </label>
              </div>
            </div>
          </section>

          {/* Network & Alerts Card */}
          <section className="settings-card">
            <div className="card-header">
              <h3>📡 Network & Notifications</h3>
              <p>Manage how FlowGuard communicates with the floor managers.</p>
            </div>

            <div className="setting-row">
              <div className="setting-info">
                <h4>Push Notifications to Mobile</h4>
                <p>Instantly alert floor supervisors of hygiene violations.</p>
              </div>
              <div className="setting-control">
                <label className="toggle-switch">
                  <input type="checkbox" checked={alertsEnabled} onChange={() => setAlertsEnabled(!alertsEnabled)} />
                  <span className="toggle-slider"></span>
                </label>
              </div>
            </div>

            <div className="setting-row">
              <div className="setting-info">
                <h4>Camera Feed Quality</h4>
                <p>Lower quality saves bandwidth but reduces AI accuracy.</p>
              </div>
              <div className="setting-control">
                <select className="dark-select">
                  <option>1080p (Standard)</option>
                  <option>4K (High AI Accuracy)</option>
                  <option>720p (Bandwidth Saver)</option>
                </select>
              </div>
            </div>
          </section>

          {/* Danger Zone Card */}
          <section className="settings-card danger-zone">
            <div className="card-header">
              <h3 className="text-red">⚠️ Danger Zone</h3>
            </div>
            <div className="setting-row">
              <div className="setting-info">
                <h4>Reboot Network Nodes</h4>
                <p>Force restart all 128 active CCTV cameras. Expect 3 minutes of downtime.</p>
              </div>
              <div className="setting-control">
                <button className="danger-btn">Initiate Reboot</button>
              </div>
            </div>
          </section>

          {/* SAVE BUTTON NOW LIVES AT THE BOTTOM */}
          <div className="settings-actions">
            <button className="save-btn">Save Changes</button>
          </div>

        </div>
      </main>
    </div>
  );
};

export default Settings;