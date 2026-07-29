import { Link } from 'react-router';

const Hero = () => {
  return (
    <section className="hero-container" data-testid="homepage-hero">
      <div className="hero-content">
        <span className="hero-badge">Academic Industry Proof of Concept</span>
        <h1 className="hero-title">Safer, smarter factory operations from one command platform</h1>
        <p className="hero-description">
          FlowGuard combines secure access, AI-assisted asset monitoring, loading-bay
          coordination and incident response to help facilities teams oversee daily
          operations more efficiently.
        </p>
        <div className="hero-actions">
          <Link to="/#technology" className="button button-primary">
            Explore the Platform
            <svg className="button-icon" aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </Link>
          <Link to="/login" className="button button-secondary">Client Login</Link>
        </div>
        <p className="hero-context">Designed for food-manufacturing facilities with multiple access points, restricted zones and loading-bay operations.</p>
      </div>

      <div className="hero-platform" role="img" aria-label="FlowGuard facility operations overview">
        <div className="platform-header">
          <div>
            <span className="eyebrow">Unified oversight</span>
            <strong>Command platform</strong>
          </div>
          <span className="platform-status"><span aria-hidden="true" />Human-reviewed</span>
        </div>
        <div className="platform-flow" aria-hidden="true">
          <div className="platform-sources">
            <div className="platform-node"><span className="node-icon">01</span><span><strong>Main gate</strong><small>Identity &amp; access</small></span></div>
            <div className="platform-node"><span className="node-icon">02</span><span><strong>Loading bay</strong><small>Bookings &amp; passes</small></span></div>
            <div className="platform-node"><span className="node-icon">03</span><span><strong>Factory zones</strong><small>AI-assisted monitoring</small></span></div>
          </div>
          <div className="platform-connector"><span /><span /><span /></div>
          <div className="command-node">
            <span className="command-mark"><i /><i /><i /></span>
            <strong>Command Centre</strong>
            <small>Alerts · incidents · records</small>
          </div>
        </div>
        <div className="platform-footer"><span>ACCESS</span><span>LOGISTICS</span><span>MONITORING</span><span>RESPONSE</span></div>
      </div>
    </section>
  );
};

export default Hero;
