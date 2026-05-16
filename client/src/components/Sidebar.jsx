// client/src/components/Sidebar.jsx
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
      {/* 1. Hamburger Button (Hidden when sidebar is open) */}
      {!isOpen && (
        <button className="mobile-menu-btn" onClick={() => setIsOpen(true)}>
          ☰
        </button>
      )}

      {/* 2. Sidebar with dynamic "open" class */}
      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="sidebar-logo">
          <div className="logo-title">
            <LogoIcon size={28} />
            <h2 className="gradient-text">FlowGuard</h2>
          </div>
          
          <button className="close-sidebar-btn" onClick={() => setIsOpen(false)}>
            ✕
          </button>
        </div>
        
        <nav className="sidebar-nav">
          <NavLink to="/dashboard" onClick={() => setIsOpen(false)}>Dashboard</NavLink>
          <NavLink to="/cameras" onClick={() => setIsOpen(false)}>Cameras</NavLink>
          <NavLink to="/vpatrol" onClick={() => setIsOpen(false)}>V-Patrol</NavLink>
          
          {/* 🎯 NEW: Dynamic Workforce Attendance Tab (Hidden from raw staff accounts) */}
          {(user.role === 'FM' || user.role === 'Tenant') && (
            <NavLink to="/attendance" onClick={() => setIsOpen(false)}>Daily Attendance</NavLink>
          )}

          <NavLink to="/logistics" onClick={() => setIsOpen(false)}>Logistics & Bays</NavLink>

          {user.role === 'Tenant' && (
            <NavLink to="/staff" onClick={() => setIsOpen(false)}>My Staff</NavLink>
          )}

          {user.role === 'FM' && (
            <>
              <NavLink to="/users" onClick={() => setIsOpen(false)}>User Management</NavLink>
              <NavLink to="/tenant-management" onClick={() => setIsOpen(false)}>Tenant Onboarding</NavLink>
            </>
          )}

          <NavLink to="/settings" onClick={() => setIsOpen(false)}>Settings</NavLink>
        </nav>

        <div className="sidebar-bottom">
          <div className="user-profile">
            <span className="user-avatar">👤</span>
            <div className="user-meta">
              <span className="user-name">{user.name}</span>
              <span className="user-role-tag">
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