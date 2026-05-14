import React, { useEffect, useState } from 'react';
import Sidebar from '../components/Sidebar'; 
import '../css/Dashboard.css';

const Dashboard = () => {
  const [user, setUser] = useState({ name: 'Guest', role: 'Tenant' });
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const storedName = localStorage.getItem("userName");
    const storedRole = localStorage.getItem("userRole");

    if (storedName && storedRole) {
      setUser({ name: storedName, role: storedRole });
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date()); // Updates the time every second
    }, 1000);

    // Cleanup the timer if the user leaves the dashboard page
    return () => clearInterval(timer);
  }, []);

  const isFM = user.role === 'FM';

  return (
    <div className="dashboard-layout">
      <Sidebar />

      <main className="dashboard-main">
        {/* Header Section */}
        <header className="dashboard-header">
          <div className="header-titles">
            <h1>{isFM ? 'Master Command Center' : 'Tenant Portal'}</h1>
            <p>Welcome back, <strong>{user.name}</strong></p>
          </div>
          <div className="header-time">
              {/* 3. Swap the static date for the live state, and change timeStyle to 'medium' */}
              <p className="time-text">
                {currentTime.toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'medium' })}
              </p>
              <p className="timezone-text">Region: Singapore (JTC Factory)</p>
            </div>
        </header>

        {/* 1. Top Summary Cards (3-Column Grid) */}
        <section className="top-summary-row">
          <div className="summary-card">
            <div className="icon-wrapper blue-icon">📹</div>
            <div className="summary-info">
              <h2>{isFM ? '128' : '4'}</h2>
              <p>{isFM ? 'Total Factory Cameras' : 'Your Unit Cameras'}</p>
            </div>
          </div>
          
          <div className="summary-card">
            <div className="icon-wrapper purple-icon">🗂️</div>
            <div className="summary-info">
              <h2>{isFM ? '8,954' : '12'}</h2>
              <p>{isFM ? 'Global V-Patrol Logs' : 'Unit Safety Scans'}</p>
            </div>
          </div>

          <div className="summary-card">
            <div className="icon-wrapper red-icon">📄</div>
            <div className="summary-info">
              <h2>{isFM ? '20' : '2'}</h2>
              <p>{isFM ? 'Pending FM Reports' : 'Active Unit Reports'}</p>
            </div>
          </div>
        </section>

        {/* 2. Recent Activity (4-Column Grid to match Sleek Design) */}
        <section className="recent-activity-section">
          <h3>Recent Activity</h3>
          <div className="activity-cards-grid">
            <div className="activity-card">
              <span className="act-icon text-blue">📷</span>
              <h2 className="text-blue">{isFM ? '614' : '24'}</h2>
              <p>Today's V-Patrol</p>
            </div>
            
            <div className="activity-card">
              <span className="act-icon" style={{color: '#c084fc'}}>✔️</span>
              <h2 style={{color: '#c084fc'}}>{isFM ? '614' : '24'}</h2>
              <p>Analysis Done</p>
            </div>

            <div className="activity-card">
              <span className="act-icon text-green">✅</span>
              <h2 className="text-green">{isFM ? '608' : '24'}</h2>
              <p>NO Defect Zones</p>
            </div>
            
            <div className="activity-card">
              <span className="act-icon text-red">⚠️</span>
              <h2 className="text-red">{isFM ? '6' : '0'}</h2>
              <p>DEFECT Zones</p>
            </div>
          </div>
        </section>

        {/* 3. Charts Section (2-Column Grid) */}
        <section className="charts-section">
          <div className="chart-card">
            <h3>V-Patrol Activity (Last 7 Days)</h3>
            <div className="mock-bar-chart">
              <div className="bar-wrapper"><div className="bar" style={{height: '80%'}}></div><span>Sat</span></div>
              <div className="bar-wrapper"><div className="bar" style={{height: '90%'}}></div><span>Sun</span></div>
              <div className="bar-wrapper"><div className="bar" style={{height: '75%'}}></div><span>Mon</span></div>
              <div className="bar-wrapper"><div className="bar" style={{height: '85%'}}></div><span>Tue</span></div>
              <div className="bar-wrapper"><div className="bar" style={{height: '70%'}}></div><span>Wed</span></div>
              <div className="bar-wrapper"><div className="bar" style={{height: '95%'}}></div><span>Thu</span></div>
              <div className="bar-wrapper"><div className="bar" style={{height: '60%'}}></div><span>Fri</span></div>
            </div>
          </div>

          <div className="chart-card">
            <h3>Analysis Status Trend (Last 7 Days)</h3>
            <div className="mock-line-chart">
               <p>[ Line Chart Visualization Canvas ]</p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

export default Dashboard;