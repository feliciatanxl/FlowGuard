import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import axios from 'axios';
import Sidebar from '../components/Sidebar';
import '../css/Dashboard.css';
import '../css/Management.css';
import { API_BASE_URL } from '../constants/api';
import { formatSingaporeDate } from '../constants/datetime';

const SG_TIME_ZONE = 'Asia/Singapore';

// The authoritative persisted instant for a log row: occurredAt (when present and
// valid) → createdAt. Returns null when neither is a usable date, so callers fall
// back to the legacy time-only string rather than inventing a timestamp.
const resolveLogInstant = (log) => {
  for (const candidate of [log?.occurredAt, log?.createdAt]) {
    if (!candidate) continue;
    const date = new Date(candidate);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
};

// Exact Singapore wall-clock time, e.g. "07:47:40 am" — matches the format the
// server already stores in SecurityLog.time, so date and time never disagree.
const formatSingaporeClock = (date) =>
  date.toLocaleTimeString('en-SG', {
    timeZone: SG_TIME_ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  });

// DATE + TIME for one activity-log row. Prefers the authoritative persisted
// instant (occurredAt → createdAt); only if neither exists does it keep the
// legacy time-only string, and it NEVER concatenates today's date onto a
// historical time.
const activityLogDateTime = (log) => {
  const instant = resolveLogInstant(log);
  if (instant) {
    return { date: formatSingaporeDate(instant, 'Not recorded'), time: formatSingaporeClock(instant) };
  }
  return { date: 'Not recorded', time: log?.time || 'Not recorded' };
};

const UserLogs = () => {
  const { id } = useParams(); 
  const navigate = useNavigate();
  const [logs, setLogs] = useState([]);
  const [employeeName, setEmployeeName] = useState("");
  const [loading, setLoading] = useState(true);
  const token = localStorage.getItem("accessToken");

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        // 🎯 Connected directly to our new server-side user bridge endpoint
        const res = await axios.get(`${API_BASE_URL}/api/security/logs/user/${id}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        
        if (res.data) {
          setLogs(res.data.logs || []);
          setEmployeeName(res.data.personnelName || "Verified User");
        }
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
            <button 
              onClick={() => navigate(-1)} 
              className="edit-btn" 
              style={{ marginBottom: '10px' }}
            >
              ← Back to Personnel
            </button>
            {/* 🎯 Displays their actual registered identity dynamically! */}
            <h1>Activity Log // {loading ? "Loading..." : employeeName}</h1>
            <p>Historical biometric scan dataset for System ID: #{id}</p>
          </div>
        </header>

        <div className="table-container">
          <table className="management-table">
            <thead>
              <tr>
                <th>DATE</th>
                <th>TIME</th>
                <th>ACCESS EVENT</th>
                <th>SECURITY THREAT STATUS</th>
                <th>SECTOR GATE</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', padding: '40px' }}>
                    Accessing encrypted logs...
                  </td>
                </tr>
              ) : logs.length > 0 ? logs.map((log, index) => {
                const { date, time } = activityLogDateTime(log);
                return (
                <tr key={log.id || index}>
                  <td style={{ color: '#cbd5e1', fontFamily: 'monospace' }}>
                    {/* Singapore calendar date of the authoritative persisted timestamp */}
                    {date}
                  </td>
                  <td style={{ color: '#cbd5e1', fontFamily: 'monospace' }}>
                    {/* Singapore wall-clock time (kept, never a fabricated current time) */}
                    {time}
                  </td>
                  <td>
                    {/* Displays the specific biometric transaction tag */}
                    <span className="presence-tag on-site">
                      {log.type ? log.type.toUpperCase() : "GANTRY SCAN"}
                    </span>
                  </td>
                  <td>
                    {/* Dynamically flags entries if an unauthorized manipulation occurred */}
                    <span className={`status-badge ${log.severity === 'safe' ? 'active' : 'inactive'}`}>
                      {log.severity === 'safe' ? 'Liveness Verified' : 'Threat Flagged'}
                    </span>
                  </td>
                  <td style={{ color: '#64748b', fontFamily: 'monospace' }}>
                    {/* Extracts the random or preset ID assigned to the gantry instance */}
                    {log.id ? `GATE-${log.id.split('-')[1] || '01'}` : 'MAIN_GANTRY'}
                  </td>
                </tr>
                );
              }) : (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
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