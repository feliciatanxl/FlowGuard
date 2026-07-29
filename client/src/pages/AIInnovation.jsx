import { Link } from 'react-router';
import NavBar from '../components/NavBar';
import Footer from '../components/Footer';
import facialAccessCheckpoint from '../assets/facial-access-checkpoint.png';
import unattendedObjectZone from '../assets/unattended-object-zone.png';
import logisticsQrGantryVerification from '../assets/logistics-qr-gantry-verification.png';
import commandCentreMonitoring from '../assets/command-centre-monitoring.png';
import '../css/AIInnovation.css';

const monitoringViews = [
  {
    image: facialAccessCheckpoint,
    alt: 'Illustrative facial access checkpoint with a worker approaching a camera-assisted gate scanner',
    title: 'Facial access checkpoint',
    description: 'Illustrative checkpoint view for enrolled-person verification and human-reviewed access outcomes.',
  },
  {
    image: unattendedObjectZone,
    alt: 'Illustrative configured factory zone highlighting a supported unattended object',
    title: 'Unattended-object zone',
    description: 'Illustrative monitoring view for supported-object alerts inside a configured zone.',
  },
];

const capabilities = [
  {
    number: '01',
    title: 'Secure Access & Facial Recognition',
    summary: 'AI-assisted facial recognition at configured checkpoints with human-reviewed access outcomes.',
    items: [
      'Three-angle enrolment',
      'Raspberry Pi Camera Module 3 and laptop webcam',
      'Gate Scanner and V-Patrol',
      'Liveness/head-turn verification',
      'Unknown, suspended and multiple-face rejection',
      'Attendance and security logs',
    ],
    links: [
      { label: 'Launch Facial Recognition Demo', to: '/facial-evaluation', protected: true },
    ],
  },
  {
    number: '02',
    title: 'Object & Zone Monitoring',
    summary: 'Configure camera-linked zones and review AI-assisted activity for supported object classes.',
    items: [
      'Camera and monitoring-zone configuration',
      'Webcam, uploaded video and SecurePi/IMX500 input',
      'People counting',
      'Supported unattended-object alerts',
      'Configurable thresholds',
      'Linked DetectionAlert and IncidentLog records',
    ],
    links: [
      { label: 'Launch Object Detection Demo', to: '/object-detection', protected: true },
    ],
  },
  {
    number: '03',
    title: 'Smart Logistics',
    summary: 'Coordinate loading-bay activity from booking and driver verification through audited entry and exit.',
    items: [
      'Loading-bay bookings',
      'Driver Pass QR verification',
      'Pi and laptop-camera sources',
      'Browser and cloud QR fallback',
      'PoC plate OCR and manual correction',
      'Entry/exit auditing',
      'Audited FM override',
      'Simulated barrier workflow',
    ],
    links: [
      { label: 'Open Driver Pass Portal', to: '/driver-portal', protected: false },
      { label: 'Launch Gate Verification Demo', to: '/logistics/gate-verification', protected: true },
    ],
  },
  {
    number: '04',
    title: 'Operational Response',
    summary: 'Bring security, access and service records together for authorised investigation and follow-up.',
    items: [
      'Security Command Centre',
      'Linked alerts and incidents',
      'Attendance/access records',
      'Support tickets',
      'Resolution notes and status tracking',
    ],
    links: [
      { label: 'Launch Incident Dashboard', to: '/incidents', protected: true },
    ],
  },
];

const interfaces = [
  {
    title: 'Face Enrolment & Gate Scanner',
    description: 'Illustrative checkpoint example paired with the existing three-angle enrolment and Gate Scanner flows.',
    image: facialAccessCheckpoint,
    imageAlt: 'Illustrative facial access checkpoint and camera-assisted gate scanner',
    links: [
      { label: 'Open Face Enrollment', to: '/enrollment', protected: true },
      { label: 'Open Gate Scanner', to: '/gate-scanner', protected: true },
    ],
  },
  {
    title: 'Object Detection & Zone Review',
    description: 'Illustrative supported-object condition paired with the existing zone, people-count and alert-review interface.',
    image: unattendedObjectZone,
    imageAlt: 'Illustrative unattended-object condition inside a configured monitoring zone',
    links: [
      { label: 'Open Object Detection', to: '/object-detection', protected: true },
    ],
  },
  {
    title: 'Driver Pass & Gate Verification',
    description: 'Illustrative QR and PoC plate-verification sequence using the existing pass workflow and a simulated barrier.',
    image: logisticsQrGantryVerification,
    imageAlt: 'Illustrative QR and PoC plate-verification workflow at a simulated loading-bay barrier',
    links: [
      { label: 'Open Driver Pass Portal', to: '/driver-portal', protected: false },
      { label: 'Open Gate Verification', to: '/logistics/gate-verification', protected: true },
    ],
  },
  {
    title: 'Incident Dashboard & Command Centre',
    description: 'Illustrative operational view paired with existing linked-alert, incident and resolution-tracking workflows.',
    image: commandCentreMonitoring,
    imageAlt: 'Illustrative factory command centre reviewing operational alerts and incidents',
    links: [
      { label: 'Open Incident Dashboard', to: '/incidents', protected: true },
    ],
  },
];

const workflowSteps = [
  {
    number: '01',
    title: 'Configure',
    description: 'Enrol identities, define camera zones, set thresholds and schedule loading-bay bookings.',
  },
  {
    number: '02',
    title: 'Observe',
    description: 'Collect checkpoint, zone and logistics events from the configured camera and browser sources.',
  },
  {
    number: '03',
    title: 'Verify & Respond',
    description: 'Review identities, supported-object alerts and driver-pass checks before an authorised response.',
  },
  {
    number: '04',
    title: 'Record & Review',
    description: 'Link attendance, access, DetectionAlert, IncidentLog and support records for follow-up.',
  },
];

const currentScope = [
  'Facial checkpoint recognition',
  'Object and zone monitoring',
  'Unattended-item detection for supported classes',
  'Smart Logistics',
  'Linked incident/support workflows',
  'Google Cloud deployment',
];

const futureScope = [
  'Pest and animal detection',
  'After-hours motion schedules',
  'Pick-up/set-down action recognition',
  'Multi-camera person re-identification',
  'Physical gate integration',
];

const InterfaceLink = ({ link, className = 'ai-text-link' }) => (
  <Link
    to={link.to}
    className={className}
    aria-label={`${link.label}${link.protected ? ' (protected)' : ''}`}
  >
    {link.label}
    <span aria-hidden="true">→</span>
  </Link>
);

const AIInnovation = () => {
  return (
    <div className="ai-page-wrapper">
      <NavBar />
      <main className="ai-main-content">
        <header className="ai-hero">
          <span className="ai-eyebrow">Integrated academic proof of concept</span>
          <h1 className="gradient-text">FlowGuard AI &amp; Operations Innovation</h1>
          <p>
            FlowGuard connects secure access, intelligent space monitoring, smart logistics
            and operational response in one factory-management platform.
          </p>
        </header>

        <section className="vision-showcase" aria-labelledby="illustrative-views-title">
          <div className="ai-section-heading">
            <span className="ai-eyebrow">Illustrative monitoring views</span>
            <h2 id="illustrative-views-title">AI-assisted checkpoints and configured monitoring zones</h2>
            <p>These images illustrate current PoC workflows; final access and operational decisions remain subject to human review.</p>
          </div>
          <div className="vision-container">
            {monitoringViews.map((view) => (
              <figure key={view.title} className="camera-feed">
                <img src={view.image} alt={view.alt} />
                <span className="feed-label">Illustrative PoC View</span>
                <figcaption className="vision-caption">
                  <strong>{view.title}</strong>
                  <span>{view.description}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section id="solutions" className="ai-capabilities-section" aria-labelledby="innovation-capabilities-title">
          <div className="ai-section-heading">
            <span className="ai-eyebrow">Connected capabilities</span>
            <h2 id="innovation-capabilities-title">Four operational areas, one FlowGuard platform</h2>
            <p>Each area reflects current application workflows and uses existing protected routes for operational demos.</p>
          </div>
          <div className="ai-feature-grid">
            {capabilities.map((capability) => (
              <article key={capability.title} className="ai-feature-card">
                <span className="ai-card-number">{capability.number}</span>
                <h3>{capability.title}</h3>
                <p>{capability.summary}</p>
                <ul>
                  {capability.items.map((item) => <li key={item}>{item}</li>)}
                </ul>
                <div className="ai-card-actions">
                  {capability.links.map((link) => (
                    <div key={link.label} className="ai-action-group">
                      {link.protected && <span className="ai-access-label">Protected demo</span>}
                      <InterfaceLink link={link} className="cta-button" />
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="how-it-works" className="ai-workflow-section" aria-labelledby="innovation-workflow-title">
          <div className="ai-section-heading">
            <span className="ai-eyebrow">Connected operations</span>
            <h2 id="innovation-workflow-title">From configuration to reviewed operational records</h2>
            <p>FlowGuard connects implemented workflows without removing authorised human review from security and operational decisions.</p>
          </div>
          <ol className="ai-workflow-grid">
            {workflowSteps.map((step) => (
              <li key={step.number} className="ai-workflow-step">
                <span className="ai-workflow-number">{step.number}</span>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="capabilities" className="ai-interfaces-section" aria-labelledby="actual-interfaces-title">
          <div className="ai-section-heading">
            <span className="ai-eyebrow">Visual workflow guide</span>
            <h2 id="actual-interfaces-title">Actual FlowGuard Interfaces</h2>
            <p>Illustrative PoC examples are paired with the application&apos;s real routes below. They are not live UI screenshots; protected pages retain login and role checks.</p>
          </div>
          <div className="ai-interface-grid">
            {interfaces.map((item) => (
              <article key={item.title} className="ai-interface-card">
                <div className="ai-interface-visual">
                  <img src={item.image} alt={item.imageAlt} loading="lazy" />
                  <span>Illustrative PoC View</span>
                </div>
                <div className="ai-interface-content">
                  <div className="ai-interface-topline"><span aria-hidden="true" /><span>Implemented workflow</span></div>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                  <div className="ai-interface-links">
                    {item.links.map((link) => (
                      <div key={link.label}>
                        <InterfaceLink link={link} />
                        <span className={`ai-route-status ${link.protected ? 'is-protected' : ''}`}>
                          {link.protected ? 'Protected - login and role checks apply' : 'Public reference workflow'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="poc-status" className="ai-scope-section" aria-labelledby="innovation-scope-title">
          <div className="ai-section-heading">
            <span className="ai-eyebrow">Scope transparency</span>
            <h2 id="innovation-scope-title">Current PoC and future deployment</h2>
            <p>Future deployment items are research directions and are not implemented in the current proof of concept.</p>
          </div>
          <div className="ai-scope-grid">
            <article className="ai-scope-card is-current">
              <span className="ai-scope-label">Current PoC</span>
              <h3>Implemented proof-of-concept scope</h3>
              <ul>{currentScope.map((item) => <li key={item}>{item}</li>)}</ul>
            </article>
            <article className="ai-scope-card is-future">
              <span className="ai-scope-label">Future deployment</span>
              <h3>Not implemented in the current PoC</h3>
              <ul>{futureScope.map((item) => <li key={item}>{item}</li>)}</ul>
            </article>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default AIInnovation;
