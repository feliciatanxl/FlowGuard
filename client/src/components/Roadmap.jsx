import React from 'react';

const Roadmap = () => {
  const milestones = [
    {
      date: "Q2 2026",
      title: "Systems Architecture",
      desc: "Finalizing the AI model training and EchoSync integration for proactive management."
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
    <section className="roadmap-section">
      <h2 className="roadmap-heading">Deployment Roadmap</h2>
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