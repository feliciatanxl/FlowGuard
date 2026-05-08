import React from 'react';
import { Link } from 'react-router-dom'; // Import Link for SPA navigation
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
          <p className="footer-desc">
            Defining the future of food manufacturing through AI-driven surveillance, 
            IoT monitoring, and smart logistics at Harrison Food Factory.
          </p>
        </div>

        <div className="footer-column">
          <h4>Solutions</h4>
          <ul>
            {/* Link to your new AI Innovation page */}
            <li><Link to="/innovation">AI Surveillance</Link></li>
            <li><Link to="/dashboard">Logistics Tracking</Link></li>
            <li><Link to="/dashboard">IoT Monitoring</Link></li>
          </ul>
        </div>

        <div className="footer-column">
          <h4>Company</h4>
          <ul>
            {/* Link to your new AI Innovation page */}
            <li><Link to="/innovation">Innovation</Link></li>
            <li><a href="#">Compliance</a></li>
            <li><a href="#">Support</a></li>
          </ul>
        </div>
        
        <div className="footer-column">
          <h4>Contact</h4>
          <p className="contact-text">Harrison Food Factory</p>
          <p className="contact-text">7 Harrison Rd</p>
          <p className="contact-text">Singapore 369650</p>
          <p className="contact-sub">Available TOL 2027</p>
        </div>
      </div>

      <div className="footer-bottom">
        <p>© 2026 FlowGuard. Built for the Next Generation of Manufacturing.</p>
      </div>
    </footer>
  );
};

export default Footer;