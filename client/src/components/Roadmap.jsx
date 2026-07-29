const Roadmap = () => {
  const currentCapabilities = [
    "Facial access and attendance",
    "Object and unattended-item monitoring for supported classes",
    "Smart Logistics and gate verification",
    "Incident and support workflows",
    "Google Cloud deployment"
  ];
  const futureCapabilities = [
    "After-hours motion schedules",
    "Pest and animal detection",
    "Pick-up, set-down and push-in action recognition",
    "Multi-camera person re-identification",
    "Production hardware and physical-barrier integration"
  ];

  return (
    <section id="poc-status" className="roadmap-section section-shell">
      <div className="roadmap-header">
        <span className="eyebrow">Scope and direction</span>
        <h2 className="section-title">Current PoC and future roadmap</h2>
        <p className="section-subtitle">A transparent view of what the academic proof of concept includes today and what remains future work.</p>
      </div>
      <div className="roadmap-grid">
        <article className="roadmap-card roadmap-current">
          <span className="roadmap-label"><span aria-hidden="true" />Current proof of concept</span>
          <h3>Implemented PoC scope</h3>
          <ul>{currentCapabilities.map((item) => <li key={item}>{item}</li>)}</ul>
        </article>
        <article className="roadmap-card roadmap-future">
          <span className="roadmap-label">Future deployment and research</span>
          <h3>Not implemented in the current PoC</h3>
          <ul>{futureCapabilities.map((item) => <li key={item}>{item}</li>)}</ul>
        </article>
      </div>
    </section>
  );
};

export default Roadmap;
