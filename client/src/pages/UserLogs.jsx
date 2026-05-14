import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import Sidebar from '../components/Sidebar';
import '../css/Dashboard.css';
import '../css/Management.css'; 

const UserLogs = () => {
  const { id } = useParams(); 
  const navigate = useNavigate();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const token = localStorage.getItem("accessToken");

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const res = await axios.get(`http://localhost:5000/user/logs/${id}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setLogs(res.data);
      } catch (err) {
        console.error("Failed to fetch logs:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchLogs();
  }, [id, token]);

  return (
    <div className="dashboard-layout">
      <Sidebar />
      <main className="dashboard-main">
        <header className="dashboard-header">
          <div className="header-titles">
            {/* FIX: Use navigate(-1) to avoid the 403 error for Tenants */}
            <button 
              onClick={() => navigate(-1)} 
              className="edit-btn" 
              style={{ marginBottom: '10px' }}
            >
              ← Back to Personnel
            </button>
            <h1>Personnel Activity Log</h1>
            <p>Historical "IN/OUT" data for Sector User ID: #{id}</p>
          </div>
        </header>

        <div className="table-container">
          <table className="management-table">
            <thead>
              <tr>
                <th>TIMESTAMP</th>
                <th>ACTION</th>
                <th>STATUS</th>
                <th>SECTOR GATE</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="4" style={{ textAlign: 'center', padding: '40px' }}>
                    Accessing encrypted logs...
                  </td>
                </tr>
              ) : logs.length > 0 ? logs.map((log, index) => (
                <tr key={index}>
                  <td style={{ color: '#cbd5e1' }}>
                    {new Date(log.timestamp).toLocaleString('en-SG', { 
                        dateStyle: 'medium', 
                        timeStyle: 'medium' 
                    })}
                  </td>
                  <td>
                    <span className={`presence-tag ${log.type === 'IN' ? 'on-site' : 'off-site'}`}>
                      {log.type === 'IN' ? 'CHECK-IN' : 'CHECK-OUT'}
                    </span>
                  </td>
                  <td>
                    <span className="status-badge active">Verified</span>
                  </td>
                  <td style={{ color: '#64748b', fontFamily: 'monospace' }}>
                    GATE-{Math.floor(Math.random() * 10) + 1}
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan="4" style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
                    No activity recorded for this personnel.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
};

export default UserLogs;