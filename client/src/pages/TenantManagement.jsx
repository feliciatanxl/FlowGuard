import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import Sidebar from '../components/Sidebar';
import SafeMuiIcon from '../components/SafeMuiIcon';
import '../css/Management.css';
import { API_BASE_URL } from '../constants/api';
import { MINUTE_MS, formatRemainingDuration, deriveInviteStatus } from '../utils/inviteStatus';

const SG_TIME_ZONE = 'Asia/Singapore';

const formatSingaporeDateTime = (value) => new Intl.DateTimeFormat('en-SG', {
  timeZone: SG_TIME_ZONE,
  dateStyle: 'medium',
  timeStyle: 'short'
}).format(new Date(value));

const statusClass = (status) => status.toLowerCase();

const TenantManagement = () => {
  const [invites, setInvites] = useState([]);
  const [newCode, setNewCode] = useState(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Pull credentials from storage
  const token = localStorage.getItem("accessToken");
  const userName = localStorage.getItem("userName");

  const fetchInvites = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/user/tenant-invites`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setInvites(res.data);
    } catch {
      console.error("Failed to fetch invites");
    }
  }, [token]);

  useEffect(() => {
    (async () => { await fetchInvites(); })();
  }, [fetchInvites]);

  // Tick every minute so the remaining-duration text stays current.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), MINUTE_MS);
    return () => clearInterval(timer);
  }, []);

  // When a PENDING invite crosses its expiry, re-sync with the authoritative
  // server list (the badge already flipped to EXPIRED locally).
  useEffect(() => {
    const crossedExpiry = invites.some((invite) => {
      const serverStatus = invite.status || (invite.isUsed ? 'USED' : 'PENDING');
      return serverStatus === 'PENDING' && deriveInviteStatus(invite, now) === 'EXPIRED';
    });
    if (crossedExpiry) { (async () => { await fetchInvites(); })(); }
  }, [now, invites, fetchInvites]);

  const handleGenerateInvite = async () => {
    setLoading(true);
    try {
      const res = await axios.post(`${API_BASE_URL}/user/invite-tenant`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setNewCode(res.data.inviteCode);
      fetchInvites();
    } catch {
      alert("Error generating invitation");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dashboard-layout">
      <Sidebar />
      <main className="dashboard-main">
        {/* Header matches Staff Management Style */}
        <header className="dashboard-header">
          <div className="header-titles">
            <h1>Tenant Onboarding</h1>
            <p>Unit Controller: <strong>{userName}</strong></p>
          </div>
        </header>

        <div className="management-container">
          <div className="code-generator-card">
            <div className="code-header-row">
              <h3>Issue New Invitation</h3>
              <p className="code-header-hint">Generate secure invitation codes for new Unit Owners.</p>
            </div>

            <p className="code-subtext">
              Each code is one-time use and expires in 48 hours. New unit owners can self-register
              securely with this invite code — an alternative to adding them from User Management.
            </p>

            <div className="code-flex-row">
              <div className="code-display-box">
                {newCode || "---- ---- ----"}
              </div>
              <button
                onClick={handleGenerateInvite}
                className="edit-btn generate-invite-btn"
                disabled={loading}
              >
                {loading ? "Generating..." : "Generate Invite Code"}
              </button>
            </div>

            {newCode && (
              <p className="code-copy-note">
                Copy this code and send it to the new Tenant.
              </p>
            )}
          </div>

          <div className="table-container">
            <table className="management-table">
              <thead>
                <tr>
                  <th>INVITATION CODE</th>
                  <th>EXPIRATION</th>
                  <th>STATUS</th>
                  <th>CREATED ON</th>
                </tr>
              </thead>
              <tbody>
                {invites.length > 0 ? invites.map(invite => {
                  const status = deriveInviteStatus(invite, now);
                  const remaining = status === 'PENDING'
                    ? formatRemainingDuration(new Date(invite.expiresAt).getTime() - now)
                    : null;
                  return (
                  <tr key={invite.id}>
                    <td className="invite-code-cell">
                        {invite.code}
                    </td>
                    <td data-label="Expiration">
                      {status === 'PENDING' && remaining ? (
                        <div className="invite-expiry-block">
                          <span className="invite-expiry-remaining">
                            <SafeMuiIcon icon={AccessTimeIcon} fontSize="inherit" aria-hidden="true" />
                            Valid for {remaining}
                          </span>
                          <span className="invite-expiry-absolute">
                            Expires {formatSingaporeDateTime(invite.expiresAt)}
                          </span>
                        </div>
                      ) : (
                        formatSingaporeDateTime(invite.expiresAt)
                      )}
                    </td>
                    <td data-label="Status">
                      <span className={`status-badge ${statusClass(status)}`} role="status" aria-label={`Invitation status: ${status}`}>
                        {status}
                      </span>
                    </td>
                    <td data-label="Created">{formatSingaporeDateTime(invite.createdAt)}</td>
                  </tr>
                  );
                }) : (
                    <tr>
                        <td colSpan="4" className="table-empty-cell">
                            No active invitations found.
                        </td>
                    </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
};

export default TenantManagement;
