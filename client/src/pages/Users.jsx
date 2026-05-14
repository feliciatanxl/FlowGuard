import React, { useEffect, useState } from 'react';
import axios from 'axios';
import Sidebar from '../components/Sidebar';
import '../css/Dashboard.css'; 
import '../css/Users.css'; 

const Users = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUsers = async () => {
      // 1. Explicitly start loading
      setLoading(true); 
      
      try {
        const response = await axios.get('http://localhost:5000/user');
        
        // 2. Safety check: make sure the backend sent an array
        if (Array.isArray(response.data)) {
          setUsers(response.data);
        } else {
          console.error("Backend sent data, but it wasn't an array:", response.data);
          setUsers([]);
        }
      } catch (error) {
        console.error("Database sync failed:", error);
        setUsers([]); // Reset to empty on fail
      } finally {
        // 3. CRITICAL FIX: Turn off the loading text!
        setLoading(false); 
      }
    };
    
    fetchUsers();
  }, []);

  return (
    <div className="dashboard-layout">
      <Sidebar />

      <main className="dashboard-main">
        <div className="users-container">
          <header className="dashboard-header">
            <div className="header-titles">
              <h1>User Access Management</h1>
              <p>Manage personnel roles, camera access, and system permissions</p>
            </div>
            <button className="add-user-btn">+ Add New User</button>
          </header>

          <div className="table-wrapper">
            {loading ? (
              <p style={{ padding: '20px', color: '#94a3b8' }}>Syncing with FlowGuard Database...</p>
            ) : (
              <table className="users-table">
                <thead>
                  <tr>
                    <th>Personnel</th>
                    <th>System Role</th>
                    <th>Email Address</th> 
                    <th>Status</th>
                    <th>Joined Date</th> 
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 ? (
                    <tr>
                      <td colSpan="6" style={{ textAlign: 'center', padding: '20px' }}>No users found in database.</td>
                    </tr>
                  ) : (
                    users.map((u) => (
                      <tr key={u.id}>
                        <td className="user-name-cell">
                          <div className="user-avatar-small">
                            {u.name.charAt(0).toUpperCase()}
                          </div>
                          <span className="user-name-text">{u.name}</span>
                        </td>
                        <td>
                          <span className={`role-badge role-${u.role.toLowerCase()}`}>
                            {u.role === 'FM' ? 'Facilities Manager' : 'Tenant'}
                          </span>
                        </td>
                        <td className="access-cell">{u.email}</td>
                        <td>
                          <div className="status-indicator">
                            <span className="status-dot dot-online"></span>
                            Active
                          </div>
                        </td>
                        <td className="time-cell">
                          {new Date(u.createdAt).toLocaleDateString('en-SG')}
                        </td>
                        <td className="actions-cell">
                          <button className="action-btn edit-btn">Edit</button>
                          <button className="action-btn revoke-btn">Revoke</button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default Users;