import { Link } from 'react-router';

const FeatureCards = () => {
  const features = [
    {
      number: "01",
      title: "Secure Access Management",
      description: "Support checkpoint verification and maintain consistent access records for authorised review.",
      items: ["Facial enrolment", "Gate verification", "Attendance", "Security logs"]
    },
    {
      number: "02",
      title: "Asset and Space Monitoring",
      description: "Use configured cameras and zones to surface supported events that need human attention.",
      items: ["Camera zones", "People counting", "Unattended-item alerts", "AI-linked incidents"],
      link: { label: "Explore AI Monitoring", to: "/innovation" }
    },
    {
      number: "03",
      title: "Smart Logistics",
      description: "Coordinate loading-bay activity from booking through verified arrival and departure records.",
      items: ["Loading-bay bookings", "Driver Pass QR verification", "PoC plate OCR", "Entry and exit auditing"]
    },
    {
      number: "04",
      title: "Operational Support",
      description: "Connect alerts, incidents and support knowledge to authorised investigation and measurable follow-up.",
      items: ["AI Helpdesk", "Knowledge Base", "Support-ticket lifecycle", "Incident Analytics"]
    }
  ];

  return (
    <section id="capabilities" className="features-section">
      <span id="technology" className="legacy-hash-anchor" aria-hidden="true" />
      <div className="features-header">
        <span className="eyebrow">Platform capabilities</span>
        <h2 className="section-title">One platform for factory access, monitoring and response</h2>
        <p className="section-subtitle">Four connected capability areas support the current FlowGuard proof of concept.</p>
      </div>
      <div className="features-grid module-grid">
        {features.map((f) => (
          <div key={f.title} className="feature-card module-card" data-testid="module-card">
            <span className="feature-number">{f.number}</span>
            <h3 className="feature-title">{f.title}</h3>
            <p className="feature-description">{f.description}</p>
            <ul className="feature-list">
              {f.items.map((item) => <li key={item}>{item}</li>)}
            </ul>
            {f.link && <Link className="feature-link" to={f.link.to}>{f.link.label} <span aria-hidden="true">→</span></Link>}
          </div>
        ))}
      </div>
    </section>
  );
};

export default FeatureCards;
