import React from 'react';
import { Link } from 'react-router-dom';
import NavBar from '../components/NavBar';
import Footer from '../components/Footer';
import '../css/AIInnovation.css';

const AIInnovation = () => {
  return (
    <div className="ai-page-wrapper">
      <NavBar />
      
      <main className="ai-main-content">
        {/* Hero Section */}
        <header className="ai-hero">
          <h1 className="gradient-text">FlowGuard Virtual Patrol</h1>
          <p>
            Transforming Harrison Food Factory with enterprise-grade computer vision. 
            Automated, 24/7 facility monitoring without the manpower constraints.
          </p>
        </header>

        {/* Conceptual "AI Vision" Showcase */}
        <section className="vision-showcase">
          <div className="vision-container">
            <div className="camera-feed mock-feed-1">
              <div className="bounding-box hygiene-box">
                <span className="confidence-tag">PPE Compliant 98%</span>
              </div>
              <div className="feed-label">CAM-04: Production Line A</div>
            </div>
            
            <div className="camera-feed mock-feed-2">
              <div className="bounding-box alert-box">
                <span className="confidence-tag alert-tag">ANOMALY: Spill Detected 89%</span>
              </div>
              <div className="feed-label">CAM-12: Loading Bay (Sector 2)</div>
            </div>
          </div>
        </section>

        {/* Feature Grid */}
        <section className="ai-feature-grid">
          <div className="ai-feature-card">
            <div className="feature-icon">👁️</div>
            <h3>Always-On Virtual Patrol</h3>
            <p>Our computer vision models analyze 128+ camera feeds in real-time, identifying safety hazards and unauthorized access instantly.</p>
          </div>

          <div className="ai-feature-card">
            <div className="feature-icon">🦺</div>
            <h3>Hygiene & PPE Enforcement</h3>
            <p>Automatically detect if personnel are missing hairnets, gloves, or high-vis jackets before they enter sterile food processing zones.</p>
          </div>

          <div className="ai-feature-card">
            <div className="feature-icon">🚨</div>
            <h3>Predictive Incident Alerts</h3>
            <p>Instead of reviewing footage after an accident, FlowGuard sends push notifications to floor managers seconds after an anomaly is detected.</p>
          </div>
        </section>

        {/* Call to Action */}
        <section className="ai-cta-section">
          <h2>Ready to see it in action?</h2>
          <p>Access the live telemetry and Virtual Patrol feeds from the Command Center.</p>
          <Link to="/login" className="cta-button">
            Launch Client Portal →
          </Link>
        </section>
      </main>

      <Footer />
    </div>
  );
};

export default AIInnovation;