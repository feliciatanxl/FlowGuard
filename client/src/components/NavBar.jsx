import React from 'react';
import { Link } from 'react-router';
import LogoIcon from './LogoIcon';

const NavBar = () => {
  return (
    <nav className="navbar-container">
      <Link to="/" className="nav-logo">
        <LogoIcon size={32} />
        <span>FlowGuard</span>
      </Link>
      <div className="nav-right-section">
        <div className="nav-links">
          <Link to="/#mission">Overview</Link>
          <Link to="/innovation">Capabilities</Link>
          <Link to="/#how-it-works">How It Works</Link>
          <Link to="/#technology">Technology</Link>
        </div>
        <Link to="/login" className="nav-login-btn">Client Login</Link>
      </div>
    </nav>
  );
};

export default NavBar;
