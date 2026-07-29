const ImpactStats = () => {
  const outcomes = [
    "Reduce repetitive manual checks",
    "Improve visibility across access points and monitored zones",
    "Create consistent and searchable audit records",
    "Coordinate logistics and security workflows",
    "Preserve human review for important security decisions"
  ];

  return (
    <section className="value-section section-shell">
      <div className="value-intro">
        <span className="eyebrow">Business value</span>
        <h2 className="section-title">Why FlowGuard</h2>
        <p className="section-subtitle">
          Bring key facility workflows together so operations and security teams can act on
          clearer, connected information without removing human judgement.
        </p>
      </div>
      <ul className="value-list">
        {outcomes.map((outcome) => <li key={outcome}><span aria-hidden="true">✓</span>{outcome}</li>)}
      </ul>
    </section>
  );
};

export default ImpactStats;
