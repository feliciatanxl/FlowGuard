import React from 'react';
import { useNavigate } from 'react-router-dom'; 

const ImpactStats = () => {
  const navigate = useNavigate();

  const handleStatusClick = () => {
    navigate('/system-health');
  };

  return (
    <section className="stats-container" id="mission">
      <div className="section-header">
        <h2 className="section-title">Our Strategic Mission</h2>
        <p className="section-subtitle">Optimizing Harrison Food Factory operations through AI-driven insights.</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">40%</div>
          <div className="stat-label">Manpower Reduction</div>
          <div className="stat-subtext">Target for shift work</div>
        </div>

        <div className="stat-card status-card" onClick={handleStatusClick}>
          <div className="status-indicator">
            <div className="pulse-dot"></div>
            <span className="status-text">SYSTEM ACTIVE</span>
          </div>
          <div className="stat-label">Node Network Health</div>
          <div className="stat-subtext">Click to view active sensors</div>
          <button className="more-info-btn">View Nodes →</button>
        </div>

        <div className="stat-card">
          <div className="stat-value">70%</div>
          <div className="stat-label">Monitoring Efficiency</div>
          <div className="stat-subtext">AI automation results</div>
        </div>
      </div>
    </section>
  );
};

export default ImpactStats;