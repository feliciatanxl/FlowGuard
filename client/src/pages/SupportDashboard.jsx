import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router';
import axios from 'axios';
import Sidebar from '../components/Sidebar';
import '../css/Dashboard.css';
import '../css/Management.css';
import '../css/SupportDashboard.css';

const TOKEN = () => localStorage.getItem('accessToken');

const TICKET_STATUSES = ['Pending', 'In Progress', 'Resolved'];

// ─── SUPPORT DASHBOARD ────────────────────────────────────────────────────────
const SupportDashboard = () => {
  const navigate = useNavigate();

  // ── Tickets state ──
  const [tickets, setTickets] = useState([]);
  const [ticketFilter, setTicketFilter] = useState('All');
  const [ticketLoading, setTicketLoading] = useState(true);
  const [selectedTicket, setSelectedTicket] = useState(null); // for transcript modal
  const [statusDrafts, setStatusDrafts] = useState({});       // { [ticketId]: { status, resolutionNotes } }
  const [savingId, setSavingId] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);   // ticket to confirm-delete

  // ── Shared ──
  const [notification, setNotification] = useState({ text: '', type: 'success' });

  const toast = (text, type = 'success') => {
    setNotification({ text, type });
    setTimeout(() => setNotification({ text: '', type: 'success' }), 4000);
  };

  // ─── TICKETS ──────────────────────────────────────────────────────────────

  const fetchTickets = useCallback(async () => {
    setTicketLoading(true);
    try {
      const query = ticketFilter === 'All' ? '' : `?status=${encodeURIComponent(ticketFilter)}`;
      const { data } = await axios.get(`/api/support/tickets${query}`, {
        headers: { Authorization: `Bearer ${TOKEN()}` }
      });
      setTickets(Array.isArray(data) ? data : []);
    } catch {
      toast('Could not load support tickets.', 'error');
    } finally {
      setTicketLoading(false);
    }
  }, [ticketFilter]);

  useEffect(() => { (async () => { await fetchTickets(); })(); }, [fetchTickets]);

  const setDraft = (id, field, value) =>
    setStatusDrafts(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }));

  const saveStatus = async (ticket) => {
    const draft = statusDrafts[ticket.id] || {};
    const status = draft.status || ticket.status;
    const resolutionNotes = draft.resolutionNotes ?? ticket.resolutionNotes ?? '';

    setSavingId(ticket.id);
    try {
      await axios.patch(
        `/api/support/tickets/${ticket.id}/status`,
        { status, resolutionNotes },
        { headers: { Authorization: `Bearer ${TOKEN()}` } }
      );
      toast(`Ticket #${ticket.id.slice(0, 8).toUpperCase()} marked "${status}".`);
      fetchTickets();
    } catch {
      toast('Could not update ticket status.', 'error');
    } finally {
      setSavingId(null);
    }
  };

  const deleteTicket = async (id) => {
    try {
      await axios.delete(`/api/support/tickets/${id}`, {
        headers: { Authorization: `Bearer ${TOKEN()}` }
      });
      toast('Ticket and linked transcript deleted.');
      setDeleteConfirm(null);
      fetchTickets();
    } catch {
      toast('Could not delete ticket.', 'error');
    }
  };

  const statusBadge = (status) => {
    if (status === 'Resolved') return 'status-badge active';
    if (status === 'In Progress') return 'status-badge inprogress';
    return 'status-badge inactive';
  };

  const priorityBadge = (p) => {
    if (p === 'High') return 'status-badge expired';
    if (p === 'Medium') return 'status-badge medium';
    return 'status-badge active';
  };

  // ─── RENDER ────────────────────────────────────────────────────────────────

  return (
    <div className="dashboard-layout">
      <Sidebar />
      <main className="dashboard-main">
        <header className="dashboard-header">
          <div className="header-titles">
            <h1>Support Tickets</h1>
            <p>Manage escalated tenant support tickets</p>
          </div>
          <button className="sup-back-btn" onClick={() => navigate('/incidents')}>
            ← Incident Logs
          </button>
        </header>

        {/* Toast */}
        {notification.text && (
          <div className={`toast-notification ${notification.type}`}>{notification.text}</div>
        )}

        {/* Summary cards — placeholders until ticket stats are wired up */}
        <div className="sup-stats-grid">
          <div className="sup-stat-card sup-stat-blue">
            <div className="sup-stat-value">—</div>
            <div className="sup-stat-label">Total Tickets</div>
          </div>
          <div className="sup-stat-card sup-stat-red">
            <div className="sup-stat-value">—</div>
            <div className="sup-stat-label">High Priority</div>
          </div>
          <div className="sup-stat-card sup-stat-orange">
            <div className="sup-stat-value">—</div>
            <div className="sup-stat-label">In Progress</div>
          </div>
          <div className="sup-stat-card sup-stat-green">
            <div className="sup-stat-value">—</div>
            <div className="sup-stat-label">Resolved</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '1rem' }}>
          <label style={{ color: '#94a3b8' }}>Filter:</label>
          <select
            value={ticketFilter}
            onChange={e => setTicketFilter(e.target.value)}
            style={{ padding: '8px', borderRadius: '6px', background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155' }}
          >
            <option value="All">All</option>
            {TICKET_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div className="table-container">
          <table className="management-table">
            <thead>
              <tr>
                <th>TICKET ID</th>
                <th>TENANT / UNIT</th>
                <th>ISSUE</th>
                <th>PRIORITY</th>
                <th>STATUS</th>
                <th>DATE</th>
                <th>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {ticketLoading ? (
                <tr><td colSpan="7" style={{ textAlign: 'center', padding: '40px' }}>Loading tickets...</td></tr>
              ) : tickets.length === 0 ? (
                <tr><td colSpan="7" style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
                  No tickets found.
                </td></tr>
              ) : tickets.map(t => {
                const draft = statusDrafts[t.id] || {};
                return (
                  <tr key={t.id}>
                    <td data-label="ID">
                      <span style={{ fontFamily: 'monospace', color: '#60a5fa', fontSize: '0.85rem' }}>
                        #{t.id.slice(0, 8).toUpperCase()}
                      </span>
                    </td>
                    <td data-label="Tenant">
                      <strong>{t.tenantName || <em style={{ color: '#64748b' }}>Unknown</em>}</strong>
                      {t.unitNumber && <div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>Unit {t.unitNumber}</div>}
                    </td>
                    <td data-label="Issue" style={{ maxWidth: '220px' }}>
                      <div style={{ fontWeight: 600 }}>{t.issueTitle}</div>
                      <div style={{ color: '#94a3b8', fontSize: '0.8rem', marginTop: '2px' }}>
                        {t.issueDescription?.substring(0, 80)}...
                      </div>
                    </td>
                    <td data-label="Priority">
                      <span className={priorityBadge(t.priority)}>{t.priority}</span>
                    </td>
                    <td data-label="Status">
                      <select
                        value={draft.status ?? t.status}
                        onChange={e => setDraft(t.id, 'status', e.target.value)}
                        style={{ padding: '6px', borderRadius: '6px', background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155', marginBottom: '4px', display: 'block' }}
                      >
                        {TICKET_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <span className={statusBadge(t.status)}>{t.status}</span>
                    </td>
                    <td data-label="Date" style={{ color: '#94a3b8', fontFamily: 'monospace', fontSize: '0.8rem' }}>
                      {new Date(t.createdAt).toLocaleDateString('en-SG')}
                    </td>
                    <td data-label="Actions">
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <textarea
                          placeholder="Resolution notes..."
                          value={draft.resolutionNotes ?? t.resolutionNotes ?? ''}
                          onChange={e => setDraft(t.id, 'resolutionNotes', e.target.value)}
                          rows={2}
                          style={{ width: '160px', padding: '6px', borderRadius: '6px', background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', fontSize: '0.8rem' }}
                        />
                        <button
                          className="edit-btn"
                          disabled={savingId === t.id}
                          onClick={() => saveStatus(t)}
                        >
                          {savingId === t.id ? 'Saving...' : 'Save Status'}
                        </button>
                        {t.transcript && (
                          <button className="edit-btn" onClick={() => setSelectedTicket(t)}>
                            View Transcript
                          </button>
                        )}
                        <button className="revoke-btn" onClick={() => setDeleteConfirm(t)}>
                          Delete
                        </button>
                      </div>
                      {t.resolvedBy && (
                        <div style={{ color: '#64748b', fontSize: '0.72rem', marginTop: '4px' }}>
                          Resolved by {t.resolvedBy}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>

      {/* ── TRANSCRIPT MODAL ──────────────────────────────────────────────── */}
      {selectedTicket && (
        <div className="modal-overlay" onClick={() => setSelectedTicket(null)}>
          <div className="modal-content support-transcript-modal" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0 }}>
                Chat Transcript — #{selectedTicket.id.slice(0, 8).toUpperCase()}
              </h3>
              <button className="cancel-btn" onClick={() => setSelectedTicket(null)}>✕</button>
            </div>

            {selectedTicket.transcript?.tenantName && (
              <p style={{ color: '#94a3b8', margin: '0 0 12px', fontSize: '0.85rem' }}>
                Tenant: <strong style={{ color: '#e2e8f0' }}>{selectedTicket.transcript.tenantName}</strong>
                {selectedTicket.transcript.unitNumber && ` · Unit ${selectedTicket.transcript.unitNumber}`}
              </p>
            )}

            <div className="support-transcript-messages">
              {(selectedTicket.transcript?.messages || []).map((msg, i) => (
                <div key={i} className={`support-msg ${msg.role === 'user' ? 'support-msg-user' : 'support-msg-ai'}`}>
                  <div className="support-msg-label">{msg.role === 'user' ? 'Tenant' : 'AI'}</div>
                  <div className="support-msg-text">{msg.text}</div>
                  {msg.timestamp && (
                    <div className="support-msg-time">{new Date(msg.timestamp).toLocaleTimeString('en-SG')}</div>
                  )}
                </div>
              ))}
              {(!selectedTicket.transcript?.messages?.length) && (
                <p style={{ color: '#64748b', textAlign: 'center', padding: '20px' }}>No messages in transcript.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── DELETE TICKET CONFIRM MODAL ───────────────────────────────────── */}
      {deleteConfirm && (
        <div className="modal-overlay">
          <div className="modal-content delete-variant">
            <span className="red-glow">⚠️</span>
            <h3>Delete Ticket?</h3>
            <p className="warning-subtext">
              This will permanently delete Ticket #{deleteConfirm.id.slice(0, 8).toUpperCase()} and its linked chat transcript. This action cannot be undone.
            </p>
            <div className="modal-actions">
              <button className="cancel-btn" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className="confirm-delete-btn" onClick={() => deleteTicket(deleteConfirm.id)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SupportDashboard;
