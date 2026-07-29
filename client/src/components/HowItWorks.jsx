const HowItWorks = () => {
  const steps = [
    { title: "Configure", text: "Set up users, cameras, zones, access rules and loading-bay operations." },
    { title: "Monitor", text: "Capture authorised events, object activity and operational updates." },
    { title: "Verify and Respond", text: "Validate identities and driver passes, then review alerts and incidents." },
    { title: "Review", text: "Use dashboards, logs and records for investigation and follow-up." }
  ];

  return (
    <section id="how-it-works" className="features-section how-section">
      <div className="features-header">
        <span className="eyebrow">Operational cycle</span>
        <h2 className="section-title">How FlowGuard works</h2>
        <p className="section-subtitle">A clear path from initial setup to day-to-day review.</p>
      </div>
      <div className="features-grid workflow-grid">
        {steps.map((step, index) => (
          <div key={step.title} className="workflow-card" data-testid="workflow-step">
            <div className="workflow-step-top">
              <span className="step-index">{String(index + 1).padStart(2, "0")}</span>
              {index < steps.length - 1 && <span className="workflow-arrow" aria-hidden="true">→</span>}
            </div>
            <h3 className="feature-title">{step.title}</h3>
            <p className="feature-description">{step.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
};

export default HowItWorks;
