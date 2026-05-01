import React from 'react';

const ImpactStats = () => {
  const stats = [
    { label: "Manpower Reduction", value: "40%", sub: "Target for shift work" },
    { label: "Man-hour Savings", value: "50%", sub: "Manual check reduction" },
    { label: "Monitoring Efficiency", value: "70%", sub: "AI automation" }
  ];

  return (
    <section className="stats-container">
      <div className="stats-grid">
        {stats.map((stat, i) => (
          <div key={i} className="stat-card">
            <div className="stat-value">{stat.value}</div>
            <div className="stat-label">{stat.label}</div>
            <div className="stat-subtext">{stat.sub}</div>
          </div>
        ))}
      </div>
    </section>
  );
};

export default ImpactStats;