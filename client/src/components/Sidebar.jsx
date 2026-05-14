import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import LogoIcon from './LogoIcon';

const Sidebar = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState({ name: 'Guest', role: 'Tenant' });
  const [isOpen, setIsOpen] = useState(false); 

  useEffect(() => {
    const storedName = localStorage.getItem("userName");
    const storedRole = localStorage.getItem("userRole");
    if (storedName && storedRole) {
      setUser({ name: storedName, role: storedRole });
    }
  }, []);

  const handleLogout = () => {
    localStorage.clear();
    navigate('/login');
  };

  return (
    <>
      {/* 1. Hamburger Button (Visible only on Mobile) */}
      <button className="mobile-menu-btn" onClick={() => setIsOpen(!isOpen)}>
        {isOpen ? '✕' : '☰'}
      </button>

      {/* 2. Sidebar with dynamic "open" class */}
      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="sidebar-logo">
          <LogoIcon size={28} />
          <h2 className="gradient-text">FlowGuard</h2>
        </div>
        
        <nav className="sidebar-nav">
          <NavLink to="/dashboard" onClick={() => setIsOpen(false)}>Dashboard</NavLink>
          <NavLink to="/cameras" onClick={() => setIsOpen(false)}>Cameras</NavLink>
          <NavLink to="/vpatrol" onClick={() => setIsOpen(false)}>V-Patrol</NavLink>
          <NavLink to="/logistics" onClick={() => setIsOpen(false)}>Logistics & Bays</NavLink>

          {/* 1. Visible ONLY to the Boss (Tenant) */}
          {user.role === 'Tenant' && (
            <NavLink to="/staff" onClick={() => setIsOpen(false)}>My Staff</NavLink>
          )}

          {/* 2. Visible ONLY to the Admin (FM) */}
          {user.role === 'FM' && (
            <NavLink to="/users" onClick={() => setIsOpen(false)}>Users</NavLink>
          )}

          <NavLink to="/settings" onClick={() => setIsOpen(false)}>Settings</NavLink>
        </nav>

        <div className="sidebar-bottom">
          <div className="user-profile">
            <span className="user-avatar">👤</span>
            <div className="user-meta">
              <span className="user-name">{user.name}</span>
              <span className="user-role-tag">
                {/* 3. Updated role display logic */}
                {user.role === 'FM' ? 'Manager' : user.role === 'Tenant' ? 'Tenant' : 'Staff'}
              </span>
            </div>
          </div>
          <button onClick={handleLogout} className="logout-btn">Log Out</button>
        </div>
      </aside>

      {/* 3. Overlay to close menu when clicking outside */}
      {isOpen && <div className="sidebar-overlay" onClick={() => setIsOpen(false)}></div>}
    </>
  );
};

export default Sidebar;