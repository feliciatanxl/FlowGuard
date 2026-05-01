import React from 'react';

const NavBar = () => {
  return (
    <nav className="navbar-container">
      {/* Brand Logo */}
      <div className="nav-logo">
        <div className="logo-icon"></div>
        <span>FlowGuard</span>
      </div>
      
      {/* Menu & Actions */}
      <div className="nav-right-section">
        <div className="nav-links">
          <a href="#innovation">Innovation</a>
          <a href="#solutions">Solutions</a>
          <a href="#compliance">Compliance</a>
        </div>
        
        <button className="nav-login-btn">
          Client Login
        </button>
      </div>
    </nav>
  );
};

export default NavBar;