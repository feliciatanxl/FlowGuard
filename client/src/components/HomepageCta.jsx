import { Link } from 'react-router';

const HomepageCta = () => (
  <>
    <aside className="disclosure-panel section-shell" aria-label="Project disclosure">
      <span className="disclosure-icon" aria-hidden="true">i</span>
      <p>
        FlowGuard is an academic industry proof of concept developed for SCCCI Problem Statement 5B.
        Automated detections support, rather than replace, human operational and security decisions.
      </p>
    </aside>
    <section className="cta-section section-shell" aria-labelledby="cta-title">
      <div className="cta-copy">
        <span className="eyebrow">Explore FlowGuard</span>
        <h2 id="cta-title">See connected factory operations in action</h2>
        <p>Explore the public capability overview or enter the authenticated proof-of-concept platform.</p>
      </div>
      <div className="cta-actions">
        <Link to="/innovation" className="button button-primary">Launch Demo</Link>
        <Link to="/login" className="button button-secondary">Client Login</Link>
        <Link to="/#capabilities" className="button button-text">View Capabilities <span aria-hidden="true">→</span></Link>
      </div>
    </section>
  </>
);

export default HomepageCta;
