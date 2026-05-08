import React from 'react';
import { Link } from 'react-router-dom';
import LogoIcon from '../components/LogoIcon'; // Bring in your official logo!
import '../css/Dashboard.css';

const Dashboard = () => {
  return (
    <div className="dashboard-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <LogoIcon size={28} />
          {/* Applying the same gradient text from your homepage */}
          <h2 className="gradient-text" style={{ fontSize: '1.4rem', margin: 0 }}>FlowGuard</h2>
        </div>
        <nav className="sidebar-nav">
          <Link to="/dashboard" className="active-nav-item">Dashboard</Link>
          <Link to="/cameras">Cameras</Link>
          <Link to="/innovation">V-Patrol</Link>
          <Link to="/reports">Reports</Link>
          <Link to="/users">Users</Link>
          <Link to="/settings">Settings</Link>
        </nav>
        <div className="sidebar-bottom">
          <div className="user-profile">
            <span className="user-avatar">👤</span>
            <span className="user-name">admin</span>
          </div>
          <Link to="/" className="logout-btn">Log Out</Link>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="dashboard-main">
        <header className="dashboard-header">
          <div className="header-titles">
            <h1>Dashboard</h1>
            <p>Welcome back, admin</p>
          </div>
          <div className="header-time">
            <p className="time-text">2026-05-09 12:37:53</p>
            <p className="timezone-text">Timezone: Asia/Singapore</p>
          </div>
        </header>

        {/* Top Summary Cards */}
        <section className="top-summary-row">
          <div className="summary-card">
            <div className="icon-wrapper blue-icon">📹</div>
            <div className="summary-info">
              <h2>128</h2>
              <p>Total Cameras</p>
            </div>
          </div>
          <div className="summary-card">
            <div className="icon-wrapper purple-icon">🗂️</div>
            <div className="summary-info">
              <h2>8954</h2>
              <p>Total V-Patrol</p>
            </div>
          </div>
          <div className="summary-card">
            <div className="icon-wrapper red-icon">📄</div>
            <div className="summary-info">
              <h2>20</h2>
              <p>Total Reports</p>
            </div>
          </div>
        </section>

        {/* Recent Activity Colored Cards */}
        <section className="recent-activity-section">
          <h3>Recent Activity</h3>
          <div className="activity-cards-grid">
            <div className="activity-card bg-dark-blue">
              <span className="act-icon text-blue">📷</span>
              <h2 className="text-blue">614</h2>
              <p className="text-blue">Today's V-Patrol</p>
            </div>
            <div className="activity-card bg-dark-green">
              <span className="act-icon text-green">✔️</span>
              <h2 className="text-green">614</h2>
              <p className="text-green">Analysis Done</p>
            </div>
            <div className="activity-card bg-dark-green">
              <span className="act-icon text-green">✅</span>
              <h2 className="text-green">608</h2>
              <p className="text-green">NO Defect Zones</p>
            </div>
            <div className="activity-card bg-dark-red">
              <span className="act-icon text-red">⚠️</span>
              <h2 className="text-red">6</h2>
              <p className="text-red">DEFECT Zones</p>
            </div>
          </div>
        </section>

        {/* Charts Section */}
        <section className="charts-section">
          <div className="chart-card">
            <h3>V-Patrol Activity (Last 7 Days)</h3>
            <div className="mock-bar-chart">
              <div className="bar-wrapper"><div className="bar" style={{height: '90%'}}></div><span>Sat</span></div>
              <div className="bar-wrapper"><div className="bar" style={{height: '95%'}}></div><span>Sun</span></div>
              <div className="bar-wrapper"><div className="bar" style={{height: '85%'}}></div><span>Mon</span></div>
              <div className="bar-wrapper"><div className="bar" style={{height: '92%'}}></div><span>Tue</span></div>
              <div className="bar-wrapper"><div className="bar" style={{height: '88%'}}></div><span>Wed</span></div>
              <div className="bar-wrapper"><div className="bar" style={{height: '90%'}}></div><span>Thu</span></div>
              <div className="bar-wrapper"><div className="bar" style={{height: '60%'}}></div><span>Fri</span></div>
            </div>
          </div>
          
          <div className="chart-card">
            <h3>Analysis Status Trend (Last 7 Days)</h3>
            <div className="mock-line-chart">
               <p className="chart-placeholder">[ Line Chart Visualization Canvas ]</p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

export default Dashboard;