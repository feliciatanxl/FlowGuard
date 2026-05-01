import React from 'react';

const FeatureCards = () => {
  const features = [
    {
      title: "AI CCTV & Monitoring",
      description: "Automated PPE detection and unauthorized access alerts to reduce manual security manpower.",
      icon: "🛡️"
    },
    {
      title: "Smart Loading Bays",
      description: "Real-time occupancy tracking for the 2 loading bays to solve peak-hour logistics congestion.",
      icon: "🚚"
    },
    {
      title: "Environmental IoT",
      description: "24/7 temperature and humidity monitoring with predictive alerts for HACCP compliance.",
      icon: "🌡️"
    }
  ];

  return (
    <section id="technology" className="features-section">
      {/* Unified Section Header */}
      <div className="section-header">
        <h2 className="section-title">Industrial Intelligence Solutions</h2>
        <p className="section-subtitle">
          Advanced IoT and AI for food manufacturing.
        </p>
      </div>

      <div className="features-grid">
        {features.map((f, i) => (
          <div key={i} className="feature-card">
            <div className="feature-icon">{f.icon}</div>
            <h3 className="feature-title">{f.title}</h3>
            <p className="feature-description">{f.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
};

export default FeatureCards;