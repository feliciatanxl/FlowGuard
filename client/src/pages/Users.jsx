import React from 'react';
import { Link } from 'react-router-dom';
import LogoIcon from '../components/LogoIcon';
import '../css/Dashboard.css'; 
import '../css/Users.css'; 

const Users = () => {
  // Mock data for your security personnel
  const usersData = [
    { id: 1, name: "Marcus Tan", role: "Security Lead", access: "All Sectors", status: "Online", lastActive: "Just now" },
    { id: 2, name: "Sarah Jenkins", role: "Floor Manager", access: "Sector 1 & 2", status: "On Patrol", lastActive: "12 mins ago" },
    { id: 3, name: "David Lee", role: "IT Administrator", access: "Command Center", status: "Offline", lastActive: "2 hours ago" },
    { id: 4, name: "Aisha Patel", role: "AI Specialist", access: "Remote (V-Patrol)", status: "Online", lastActive: "Just now" },
    { id: 5, name: "Tommy Ng", role: "Guard", access: "Loading Bay", status: "Offline", lastActive: "1 day ago" },
  ];

  return (
    <div className="dashboard-layout">
      {/* --- SIDEBAR --- */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <LogoIcon size={28} />
          <h2 className="gradient-text" style={{ fontSize: '1.4rem', margin: 0 }}>FlowGuard</h2>
        </div>
        <nav className="sidebar-nav">
          <Link to="/dashboard">Dashboard</Link>
          <Link to="/cameras">Cameras</Link>
          <Link to="/innovation">V-Patrol</Link>
          <Link to="/reports">Reports</Link>
          <Link to="/users" className="active-nav-item">Users</Link>
          <Link to="/settings">Settings</Link>
        </nav>
        <div className="sidebar-bottom">
          <div className="user-profile">
            <span className="user-avatar">👤</span>
            <span className="user-name">admin</span>
          </div>
          <Link to="/" className="logout-btn">Log Out</Link>
        </div>
      </aside>

      {/* --- MAIN USERS CONTENT --- */}
      <main className="dashboard-main">
        
        {/* EVERYTHING is now wrapped inside the users-container to enforce the same width */}
        <div className="users-container">
          
          <header className="dashboard-header">
            <div className="header-titles">
              <h1>User Access Management</h1>
              <p>Manage personnel roles, camera access, and system permissions</p>
            </div>
            <button className="add-user-btn">+ Add New User</button>
          </header>

          <div className="table-wrapper">
            <table className="users-table">
              <thead>
                <tr>
                  <th>Personnel</th>
                  <th>System Role</th>
                  <th>Sector Access</th>
                  <th>Status</th>
                  <th>Last Active</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {usersData.map((user) => (
                  <tr key={user.id}>
                    <td className="user-name-cell">
                      <div className="user-avatar-small">
                        {user.name.charAt(0)}
                      </div>
                      <span className="user-name-text">{user.name}</span>
                    </td>
                    <td>
                      <span className={`role-badge role-${user.role.replace(/\s+/g, '-').toLowerCase()}`}>
                        {user.role}
                      </span>
                    </td>
                    <td className="access-cell">{user.access}</td>
                    <td>
                      <div className="status-indicator">
                        <span className={`status-dot dot-${user.status.replace(/\s+/g, '-').toLowerCase()}`}></span>
                        {user.status}
                      </div>
                    </td>
                    <td className="time-cell">{user.lastActive}</td>
                    <td className="actions-cell">
                      <button className="action-btn edit-btn">Edit</button>
                      <button className="action-btn revoke-btn">Revoke</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Users;