import React from 'react';

const Roadmap = () => {
  const milestones = [
    {
      date: "Q2 2026",
      title: "Systems Architecture",
      desc: "Finalizing the AI model training and FlowGuard core integration for proactive facility management."
    },
    {
      date: "Q4 2026",
      title: "IoT Node Deployment",
      desc: "Installation of environmental sensors and smart loading bay hardware across the factory floor."
    },
    {
      date: "2027",
      title: "Operational Launch",
      desc: "Full-scale deployment of FlowGuard at Harrison Food Factory for live monitoring."
    }
  ];

  return (
    <section id="roadmap" className="roadmap-section">
      <div className="section-header">
        <h2 className="section-title">Deployment Roadmap</h2>
        <p className="section-subtitle">
          Phased implementation at Harrison Food Factory.
        </p>
      </div>

      <div className="timeline-container">
        {milestones.map((item, i) => (
          <div key={i} className="timeline-item">
            <div className="timeline-dot"></div>
            <div className="timeline-content">
              <span className="timeline-date">{item.date}</span>
              <h3 className="timeline-title">{item.title}</h3>
              <p className="timeline-desc">{item.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

export default Roadmap;