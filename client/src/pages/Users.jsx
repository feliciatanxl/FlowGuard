import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import Sidebar from '../components/Sidebar';
import '../css/Dashboard.css'; 
import '../css/Users.css'; 

const Users = () => {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ isOpen: false, user: null });

  const token = localStorage.getItem("accessToken");
  
  // 1. Retrieve the current logged-in user's ID
  const currentUserId = localStorage.getItem("userId"); 

  const fetchUsers = async () => {
    setLoading(true); 
    try {
      const response = await axios.get('http://localhost:5000/user', {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (Array.isArray(response.data)) {
        setUsers(response.data);
      } else {
        setUsers([]);
      }
    } catch (error) {
      console.error("Database sync failed:", error);
      setUsers([]); 
    } finally {
      setLoading(false); 
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const openModal = (user) => {
    setModal({ isOpen: true, user });
  };

  const closeModal = () => {
    setModal({ isOpen: false, user: null });
  };

  const handleConfirmAction = async () => {
    const { id, isActive, name } = modal.user;

    try {
      await axios.put(`http://localhost:5000/user/suspend/${id}`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      setUsers(prevUsers => 
        prevUsers.map(u => u.id === id ? { ...u, isActive: !isActive } : u)
      );
      
      closeModal();
    } catch (error) {
      alert(`Failed to update access for ${name}.`);
      console.error(error);
      closeModal();
    }
  };

  return (
    <div className="dashboard-layout">
      <Sidebar />

      <main className="dashboard-main">
        {modal.isOpen && (
          <div className="modal-overlay">
            <div className="modal-content security-modal">
              <div className="modal-header">
                <span className="modal-icon">{modal.user.isActive ? '⚠️' : '🔓'}</span>
                <h3>Security Confirmation</h3>
              </div>
              <p>
                Are you sure you want to <strong>{modal.user.isActive ? 'Suspend' : 'Reactivate'}</strong> access for <strong>{modal.user.name}</strong>?
              </p>
              <div className="modal-actions">
                <button className="cancel-btn" onClick={closeModal}>Cancel</button>
                <button 
                  className={`confirm-btn ${modal.user.isActive ? 'suspend-btn' : 'reactivate-btn'}`}
                  onClick={handleConfirmAction}
                >
                  Confirm {modal.user.isActive ? 'Suspension' : 'Reactivation'}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="users-container">
          <header className="dashboard-header">
            <div className="header-titles">
              <h1>User Access Management</h1>
              <p>Security oversight for personnel roles and factory presence</p>
            </div>
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
                    <th>Physical Presence</th>
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
                    users.map((u) => {
                      // 2. Determine if the current row is the logged-in user
                      const isSelf = String(u.id) === String(currentUserId);

                      return (
                        <tr key={u.id} className={u.isActive === false ? 'row-suspended' : ''}>
                          <td className="user-name-cell">
                            <div className="user-avatar-small">
                              {u.name.charAt(0).toUpperCase()}
                            </div>
                            <span className="user-name-text">
                              {u.name} {isSelf && <span className="self-tag">(You)</span>}
                            </span>
                          </td>
                          <td>
                            <span className={`role-badge role-${u.role.toLowerCase()}`}>
                              {u.role === 'FM' ? 'Facilities Manager' : u.role === 'Tenant' ? 'Tenant' : 'Staff'}
                            </span>
                          </td>
                          <td className="access-cell">{u.email}</td>
                          <td>
                            <div className={`presence-tag ${u.locationStatus === 'On-Site' ? 'on-site' : 'off-site'}`}>
                              {u.locationStatus === 'On-Site' ? (
                                <><span>📍</span> On-Site</>
                              ) : (
                                <><span>🏠</span> Off-Site</>
                              )}
                            </div>
                          </td>
                          <td className="time-cell">
                            {new Date(u.createdAt).toLocaleDateString('en-SG')}
                          </td>
                          <td className="actions-cell">
                            <button 
                              className="action-btn edit-btn"
                              onClick={() => navigate(`/user-logs/${u.id}`)}
                            >
                              View Logs
                            </button>
                            
                            {/* 3. Conditional rendering for the Suspend button */}
                            <button 
                              className="action-btn revoke-btn"
                              onClick={() => !isSelf && openModal(u)}
                              disabled={isSelf}
                              style={{ 
                                color: isSelf ? '#475569' : (u.isActive === false ? '#10b981' : '#f87171'),
                                cursor: isSelf ? 'not-allowed' : 'pointer',
                                opacity: isSelf ? 0.5 : 1
                              }}
                              title={isSelf ? "Self-suspension restricted" : ""}
                            >
                              {u.isActive === false ? 'Reactivate' : 'Suspend'}
                            </button>
                          </td>
                        </tr>
                      );
                    })
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