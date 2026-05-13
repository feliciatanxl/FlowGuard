import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import LogoIcon from './LogoIcon';
import '../css/Dashboard.css';

const Sidebar = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState({ name: 'Guest', role: 'Tenant' });

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

  const isFM = user.role === 'FM';

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <LogoIcon size={28} />
        <h2 className="gradient-text" style={{ fontSize: '1.4rem', margin: 0 }}>FlowGuard</h2>
      </div>
      
      <nav className="sidebar-nav">
        {/* NavLink automatically adds an "active" class when the URL matches */}
        <NavLink to="/dashboard" className={({ isActive }) => isActive ? "active-nav-item" : ""}>Dashboard</NavLink>
        <NavLink to="/cameras" className={({ isActive }) => isActive ? "active-nav-item" : ""}>Cameras</NavLink>
        <NavLink to="/innovation" className={({ isActive }) => isActive ? "active-nav-item" : ""}>V-Patrol</NavLink>
        
        {isFM && <NavLink to="/reports" className={({ isActive }) => isActive ? "active-nav-item" : ""}>Reports</NavLink>}
        {isFM && <NavLink to="/users" className={({ isActive }) => isActive ? "active-nav-item" : ""}>User Management</NavLink>}
        
        <NavLink to="/settings" className={({ isActive }) => isActive ? "active-nav-item" : ""}>Settings</NavLink>
      </nav>

      <div className="sidebar-bottom">
        <div className="user-profile">
          <span className="user-avatar">{isFM ? '🛠️' : '🏢'}</span>
          <div className="user-meta">
            <span className="user-name">{user.name}</span>
            <span className="user-role-tag">{isFM ? 'Facilities Manager' : 'Tenant'}</span>
          </div>
        </div>
        <button onClick={handleLogout} className="logout-btn">Log Out</button>
      </div>
    </aside>
  );
};

export default Sidebar;