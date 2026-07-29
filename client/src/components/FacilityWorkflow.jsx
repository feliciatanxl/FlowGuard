const FacilityWorkflow = () => {
  const locations = [
    { title: "Main Gate", description: "Verify enrolled personnel and record access activity." },
    { title: "Loading Bay", description: "Coordinate bookings, validate driver passes and audit entry or exit." },
    { title: "Production Zones", description: "Monitor configured areas for people, supported objects and unattended-item conditions." },
    { title: "Command Centre", description: "Review alerts, linked incidents, attendance and operational support requests." }
  ];

  return (
    <section id="facility-workflow" className="facility-section section-shell">
      <div className="section-heading">
        <span className="eyebrow">Connected operations</span>
        <h2 className="section-title">FlowGuard across the facility</h2>
        <p className="section-subtitle">A connected journey from the first checkpoint to operational review.</p>
      </div>
      <ol className="facility-journey">
        {locations.map((location, index) => (
          <li key={location.title} className="facility-stop">
            <div className="facility-marker"><span>{String(index + 1).padStart(2, "0")}</span></div>
            <div className="facility-copy">
              <h3>{location.title}</h3>
              <p>{location.description}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
};

export default FacilityWorkflow;
