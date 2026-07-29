import { Link } from 'react-router';
import LogoIcon from './LogoIcon';

const Footer = () => {
  return (
    <footer className="footer-container">
      <div className="footer-content">
        <div className="footer-column">
          <div className="footer-logo">
            <LogoIcon size={32} />
            <span>FlowGuard</span>
          </div>
          <p className="footer-desc">AI-assisted access, monitoring and response for connected factory operations.</p>
        </div>
        <nav className="footer-column footer-nav" aria-label="Footer navigation">
          <ul>
            <li><Link to="/#mission">Solutions</Link></li>
            <li><Link to="/#technology">Capabilities</Link></li>
            <li><Link to="/#how-it-works">How It Works</Link></li>
            <li><Link to="/login">Client Login</Link></li>
          </ul>
        </nav>
        <div className="footer-column">
          <Link className="footer-status" to="/#poc-status"><span aria-hidden="true" />Academic PoC status</Link>
        </div>
      </div>
      <div className="footer-bottom">
        <p>© 2026 FlowGuard · Academic industry proof of concept</p>
      </div>
    </footer>
  );
};

export default Footer;
