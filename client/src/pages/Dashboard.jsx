import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import LogoIcon from '../components/LogoIcon'; 
import '../css/Dashboard.css';

const Dashboard = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState({ name: 'Guest', role: 'Tenant' });

  // 1. Fetch user info from localStorage on mount
  useEffect(() => {
    const storedName = localStorage.getItem("userName");
    const storedRole = localStorage.getItem("userRole");

    if (storedName && storedRole) {
      setUser({ name: storedName, role: storedRole });
    }
  }, []);

  // 2. Handle Logout (Clean up storage)
  const handleLogout = () => {
    localStorage.clear();
    navigate('/login');
  };

  const isFM = user.role === 'FM';

  return (
    <div className="dashboard-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <LogoIcon size={28} />
          <h2 className="gradient-text" style={{ fontSize: '1.4rem', margin: 0 }}>FlowGuard</h2>
        </div>
        <nav className="sidebar-nav">
          <Link to="/dashboard" className="active-nav-item">Dashboard</Link>
          <Link to="/cameras">Cameras</Link>
          <Link to="/innovation">V-Patrol</Link>
          
          {/* 3. Hide Reports and Users from Tenants */}
          {isFM && <Link to="/reports">Reports</Link>}
          {isFM && <Link to="/users">User Management</Link>}
          
          <Link to="/settings">Settings</Link>
        </nav>
        <div className="sidebar-bottom">
          <div className="user-profile">
            <span className="user-avatar">{isFM ? '🛠️' : '🏢'}</span>
            <div className="user-meta">
              <span className="user-name">{user.name}</span>
              <span className="user-role-tag">{isFM ? 'Facilities Manager' : 'Tenant'}</span>
            </div>
          </div>
          <button onClick={handleLogout} className="logout-btn">Log Out</button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="dashboard-main">
        <header className="dashboard-header">
          <div className="header-titles">
            <h1>{isFM ? 'Master Command Center' : 'Tenant Portal'}</h1>
            <p>Welcome back, <strong>{user.name}</strong></p>
          </div>
          <div className="header-time">
            <p className="time-text">{new Date().toLocaleString('en-SG')}</p>
            <p className="timezone-text">Region: Singapore (JTC Factory)</p>
          </div>
        </header>

        {/* 4. Role-Based Summary Cards */}
        <section className="top-summary-row">
          <div className="summary-card">
            <div className="icon-wrapper blue-icon">📹</div>
            <div className="summary-info">
              <h2>{isFM ? '128' : '4'}</h2>
              <p>{isFM ? 'Total Factory Cameras' : 'Your Unit Cameras'}</p>
            </div>
          </div>
          
          {/* Tenants don't see "Total Reports", maybe they see "Active Bookings" instead */}
          <div className="summary-card">
            <div className="icon-wrapper purple-icon">🗂️</div>
            <div className="summary-info">
              <h2>{isFM ? '8,954' : '12'}</h2>
              <p>{isFM ? 'Global V-Patrol Logs' : 'Unit Safety Scans'}</p>
            </div>
          </div>

          {isFM && (
            <div className="summary-card">
              <div className="icon-wrapper red-icon">📄</div>
              <div className="summary-info">
                <h2>20</h2>
                <p>Pending FM Reports</p>
              </div>
            </div>
          )}
        </section>

        {/* Recent Activity (Filtered by Role) */}
        <section className="recent-activity-section">
          <h3>{isFM ? 'Global Safety Status' : 'Your Unit Safety Status'}</h3>
          <div className="activity-cards-grid">
            <div className="activity-card bg-dark-blue">
              <span className="act-icon text-blue">📷</span>
              <h2 className="text-blue">{isFM ? '614' : '24'}</h2>
              <p className="text-blue">Today's Scans</p>
            </div>
            <div className="activity-card bg-dark-green">
              <span className="act-icon text-green">✅</span>
              <h2 className="text-green">{isFM ? '608' : '24'}</h2>
              <p className="text-green">Verified Safe</p>
            </div>
            
            {/* ALERT CARD: Always show red if there are defects */}
            <div className={`activity-card ${isFM ? 'bg-dark-red' : 'bg-dark-green'}`}>
              <span className="act-icon text-red">{isFM ? '⚠️' : '✔️'}</span>
              <h2 className="text-red">{isFM ? '6' : '0'}</h2>
              <p className="text-red">{isFM ? 'DEFECT Zones Found' : 'PPE Violations'}</p>
            </div>
          </div>
        </section>

        {/* Charts: Show Global Trends to FM, only show Unit Activity to Tenant */}
        <section className="charts-section">
          <div className="chart-card">
            <h3>{isFM ? 'Factory-Wide Activity' : 'Daily Unit Traffic'}</h3>
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
        </section>
      </main>
    </div>
  );
};

export default Dashboard;