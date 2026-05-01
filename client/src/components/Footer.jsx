import React from 'react';

const Footer = () => {
  return (
    <footer className="footer-container">
      <div className="footer-content">
        <div className="footer-column">
          <div className="footer-logo">
            <div className="logo-box"></div>
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
            <li><a href="#">AI Surveillance</a></li>
            <li><a href="#">Logistics Tracking</a></li>
            <li><a href="#">IoT Monitoring</a></li>
          </ul>
        </div>

        <div className="footer-column">
          <h4>Company</h4>
          <ul>
            <li><a href="#">Innovation</a></li>
            <li><a href="#">Compliance</a></li>
            <li><a href="#">Support</a></li>
          </ul>
        </div>
        <div className="footer-column">
          <h4>Contact</h4>
          <p className="contact-text">Harrison Food Factory</p>
          <p className="contact-text">Ang Mo Kio Industrial Park</p>
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