const LiveStatus = () => {
  const challenges = [
    "Manual identity and access checks",
    "Limited visibility across factory zones",
    "Unattended items and restricted-area activity",
    "Loading-bay scheduling and driver verification",
    "Fragmented alerts, incidents and support requests"
  ];

  return (
    <section id="mission" className="challenges-section section-shell">
      <div className="section-heading section-heading-left">
        <span className="eyebrow">The operational problem</span>
        <h2 className="section-title">Operational challenges FlowGuard addresses</h2>
        <p className="section-subtitle">
          Daily factory operations can span disconnected checkpoints, monitored areas and
          response workflows. FlowGuard brings those activities into a shared operational view.
        </p>
      </div>
      <ol className="challenge-grid">
        {challenges.map((challenge, index) => (
          <li key={challenge} className="challenge-card">
            <span className="challenge-number">{String(index + 1).padStart(2, "0")}</span>
            <h3>{challenge}</h3>
          </li>
        ))}
      </ol>
    </section>
  );
};

export default LiveStatus;
