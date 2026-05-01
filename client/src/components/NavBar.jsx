import React from 'react';
import { Link } from 'react-router-dom';
import { HashLink } from 'react-router-hash-link'; 

const NavBar = () => {
  return (
    <nav className="navbar-container">
      <Link to="/" className="nav-logo">
        <div className="logo-icon"></div>
        <span>FlowGuard</span>
      </Link>
      
      <div className="nav-right-section">
        <div className="nav-links">
          <HashLink smooth to="/#mission">Mission</HashLink>
          <HashLink smooth to="/#technology">Technology</HashLink>
          <HashLink smooth to="/#roadmap">Roadmap</HashLink>
          <Link to="/contact">Contact</Link>
        </div>
        
        <Link to="/login" className="nav-login-btn">
          Client Login
        </Link>
      </div>
    </nav>
  );
};

export default NavBar;