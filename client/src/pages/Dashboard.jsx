import React from 'react';
import { Link } from 'react-router-dom';
import '../css/Dashboard.css';

const Dashboard = () => {
  return (
    <div className="dashboard-layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-icon-small"></div>
          <h2>FlowGuard</h2>
        </div>
        <nav className="sidebar-nav">
          <Link to="/dashboard" className="active-nav-item">Overview</Link>
          <Link to="/nodes">Node Network</Link>
          <Link to="/alerts">Security Alerts</Link>
          <Link to="/logistics">Logistics</Link>
        </nav>
        <div className="sidebar-bottom">
          <Link to="/" className="logout-btn">Log Out</Link>
        </div>
      </aside>

      <main className="dashboard-main">
        <header className="dashboard-header">
          <div>
            <h1>Command Center</h1>
            <p>Harrison Food Factory • Sector 4 Active</p>
          </div>
          <button className="report-btn">+ Export Report</button>
        </header>

        <section className="metrics-grid">
          <div className="metric-card">
            <h3>EchoSync AI</h3>
            <div className="metric-value status-good">Online</div>
            <p className="metric-sub">99.98% Uptime</p>
          </div>
          <div className="metric-card">
            <h3>Cold Storage Temp</h3>
            <div className="metric-value">-18.2°C</div>
            <p className="metric-sub">Optimal Range</p>
          </div>
          <div className="metric-card">
            <h3>Active Sensors</h3>
            <div className="metric-value">1,042</div>
            <p className="metric-sub">4 offline</p>
          </div>
          <div className="metric-card">
            <h3>Security Anomalies</h3>
            <div className="metric-value status-warning">2</div>
            <p className="metric-sub">Pending Review</p>
          </div>
        </section>

        <section className="dashboard-details">
          <div className="detail-panel chart-panel">
            <div className="panel-header">
              <h3>System Health & Throughput</h3>
              <select className="time-filter"><option>Last 24 Hours</option></select>
            </div>
            <div className="chart-placeholder">
              <p>[ Data Visualization Canvas ]</p>
            </div>
          </div>

          <div className="detail-panel feed-panel">
            <div className="panel-header">
              <h3>Recent Activity</h3>
            </div>
            <ul className="activity-list">
              <li>
                <span className="time">10:42 AM</span>
                <p>Logistics truck #402 cleared for departure.</p>
              </li>
              <li>
                <span className="time">09:15 AM</span>
                <p>Routine diagnostic passed on Conveyor Belt B.</p>
              </li>
              <li className="alert-item">
                <span className="time">08:03 AM</span>
                <p>Warning: Unrecognized badge scan at Sector 2.</p>
              </li>
              <li>
                <span className="time">07:00 AM</span>
                <p>Morning shift supervisor logged in.</p>
              </li>
            </ul>
          </div>
        </section>
      </main>
    </div>
  );
};

export default Dashboard;