import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router';
import axios from 'axios';
import Sidebar from '../components/Sidebar';
import '../css/Dashboard.css';
import '../css/Management.css';
import '../css/SupportDashboard.css';

const TOKEN = () => localStorage.getItem('accessToken');

const TICKET_STATUSES = ['Pending', 'Investigating', 'Resolved', 'Closed'];
// Suggested categories — free text server-side, but a fixed list keeps the
// filter dropdown stable regardless of which categories currently have tickets.
const TICKET_CATEGORIES = ['General', 'Access Control', 'Loading Bay', 'Visitor Parking', 'Security'];
const TICKET_PAGE_SIZE = 10;

// ─── SUPPORT DASHBOARD ────────────────────────────────────────────────────────
const SupportDashboard = () => {
  const navigate = useNavigate();

  // ── Tickets state ──
  const [tickets, setTickets] = useState([]);
  const [ticketFilter, setTicketFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [ticketSearch, setTicketSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [ticketPage, setTicketPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: TICKET_PAGE_SIZE, total: 0, totalPages: 1 });
  const [ticketLoading, setTicketLoading] = useState(true);
  const [selectedTicket, setSelectedTicket] = useState(null); // for transcript modal
  const [statusDrafts, setStatusDrafts] = useState({});       // { [ticketId]: { status, resolutionNotes } }
  const [savingId, setSavingId] = useState(null);
  const [archivingId, setArchivingId] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);   // ticket to confirm-delete

  // ── Stats state ──
  const [stats, setStats] = useState({ total: 0, highPriority: 0, investigating: 0, resolved: 0 });

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
      const params = new URLSearchParams();
      if (ticketFilter !== 'All') params.set('status', ticketFilter);
      if (categoryFilter !== 'All') params.set('category', categoryFilter);
      if (ticketSearch.trim()) params.set('q', ticketSearch.trim());
      if (showArchived) params.set('archived', 'true');
      params.set('page', String(ticketPage));
      params.set('limit', String(TICKET_PAGE_SIZE));

      const { data } = await axios.get(`/api/support/tickets?${params.toString()}`, {
        headers: { Authorization: `Bearer ${TOKEN()}` }
      });
      setTickets(Array.isArray(data.tickets) ? data.tickets : []);
      setPagination(data.pagination || { page: 1, limit: TICKET_PAGE_SIZE, total: 0, totalPages: 1 });
    } catch {
      toast('Could not load support tickets.', 'error');
    } finally {
      setTicketLoading(false);
    }
  }, [ticketFilter, categoryFilter, ticketSearch, showArchived, ticketPage]);

  const fetchStats = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/support/tickets/stats', {
        headers: { Authorization: `Bearer ${TOKEN()}` }
      });
      setStats(data || { total: 0, highPriority: 0, investigating: 0, resolved: 0 });
    } catch {
      // Stat cards silently keep their last known values — not worth a toast.
    }
  }, []);

  useEffect(() => { (async () => { await fetchTickets(); })(); }, [fetchTickets]);
  useEffect(() => { (async () => { await fetchStats(); })(); }, [fetchStats]);

  // Filter/search setters that also reset to page 1 (batched into the same
  // render as the filter change, so only one fetch fires with the final params
  // instead of one at the old page and a second correcting it to page 1).
  const updateTicketSearch = (value) => { setTicketSearch(value); setTicketPage(1); };
  const updateTicketFilter = (value) => { setTicketFilter(value); setTicketPage(1); };
  const updateCategoryFilter = (value) => { setCategoryFilter(value); setTicketPage(1); };
  const toggleShowArchived = () => { setShowArchived(v => !v); setTicketPage(1); };

  const setDraft = (id, field, value) =>
    setStatusDrafts(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }));

  const saveStatus = async (ticket) => {
    const draft = statusDrafts[ticket.id] || {};
    const status = draft.status || ticket.status;
    const resolutionNotes = draft.resolutionNotes ?? ticket.resolutionNotes ?? '';
    const category = draft.category ?? ticket.category;

    setSavingId(ticket.id);
    try {
      await axios.patch(
        `/api/support/tickets/${ticket.id}/status`,
        { status, resolutionNotes, category },
        { headers: { Authorization: `Bearer ${TOKEN()}` } }
      );
      toast(`Ticket #${ticket.id.slice(0, 8).toUpperCase()} marked "${status}".`);
      fetchTickets();
      fetchStats();
    } catch {
      toast('Could not update ticket status.', 'error');
    } finally {
      setSavingId(null);
    }
  };

  const setArchived = async (ticket, archived) => {
    setArchivingId(ticket.id);
    try {
      await axios.patch(
        `/api/support/tickets/${ticket.id}/archive`,
        { archived },
        { headers: { Authorization: `Bearer ${TOKEN()}` } }
      );
      toast(archived ? 'Ticket archived.' : 'Ticket restored from archive.');
      fetchTickets();
      fetchStats();
    } catch {
      toast('Could not update archive status.', 'error');
    } finally {
      setArchivingId(null);
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
      fetchStats();
    } catch {
      toast('Could not delete ticket.', 'error');
    }
  };

  const statusBadge = (status) => {
    if (status === 'Resolved') return 'status-badge active';
    if (status === 'Closed') return 'status-badge inactive';
    if (status === 'Investigating') return 'status-badge inprogress';
    return 'status-badge pending'; // distinct from priority "Medium", which reuses amber
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
            ← Incident Dashboard
          </button>
        </header>

        {/* Toast */}
        {notification.text && (
          <div className={`toast-notification ${notification.type}`}>{notification.text}</div>
        )}

        <div className="sup-stats-grid">
          <div className="sup-stat-card sup-stat-blue">
            <div className="sup-stat-value">{stats.total}</div>
            <div className="sup-stat-label">Total Tickets</div>
          </div>
          <div className="sup-stat-card sup-stat-red">
            <div className="sup-stat-value">{stats.highPriority}</div>
            <div className="sup-stat-label">High Priority</div>
          </div>
          <div className="sup-stat-card sup-stat-orange">
            <div className="sup-stat-value">{stats.investigating}</div>
            <div className="sup-stat-label">Investigating</div>
          </div>
          <div className="sup-stat-card sup-stat-green">
            <div className="sup-stat-value">{stats.resolved}</div>
            <div className="sup-stat-label">Resolved</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Search tenant, unit, or issue..."
            value={ticketSearch}
            onChange={e => updateTicketSearch(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: '6px', background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155', minWidth: '220px', flex: '1 1 220px' }}
          />

          <label style={{ color: '#94a3b8' }}>Status:</label>
          <select
            value={ticketFilter}
            onChange={e => updateTicketFilter(e.target.value)}
            style={{ padding: '8px', borderRadius: '6px', background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155' }}
          >
            <option value="All">All</option>
            {TICKET_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <label style={{ color: '#94a3b8' }}>Category:</label>
          <select
            value={categoryFilter}
            onChange={e => updateCategoryFilter(e.target.value)}
            style={{ padding: '8px', borderRadius: '6px', background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155' }}
          >
            <option value="All">All</option>
            {TICKET_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          <button
            className={showArchived ? 'edit-btn' : 'cancel-btn'}
            onClick={toggleShowArchived}
            title={showArchived ? 'Showing archived tickets' : 'Showing active tickets'}
          >
            {showArchived ? 'Viewing Archive' : 'View Archive'}
          </button>
        </div>

        <div className="table-container">
          <table className="management-table">
            <thead>
              <tr>
                <th>TICKET ID</th>
                <th>TENANT / UNIT</th>
                <th>ISSUE</th>
                <th>CATEGORY</th>
                <th>PRIORITY</th>
                <th>STATUS</th>
                <th>DATE</th>
                <th>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {ticketLoading ? (
                <tr><td colSpan="8" style={{ textAlign: 'center', padding: '40px' }}>Loading tickets...</td></tr>
              ) : tickets.length === 0 ? (
                <tr><td colSpan="8" style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
                  {showArchived ? 'No archived tickets.' : 'No tickets found.'}
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
                    <td data-label="Category">
                      <select
                        value={draft.category ?? t.category ?? 'General'}
                        onChange={e => setDraft(t.id, 'category', e.target.value)}
                        style={{ padding: '6px', borderRadius: '6px', background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155', fontSize: '0.78rem' }}
                      >
                        {TICKET_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
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
                        <button
                          className="cancel-btn"
                          disabled={archivingId === t.id}
                          onClick={() => setArchived(t, !t.isArchived)}
                        >
                          {archivingId === t.id ? 'Saving...' : t.isArchived ? 'Restore' : 'Archive'}
                        </button>
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

        {!ticketLoading && tickets.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', marginTop: '1rem' }}>
            <button
              className="cancel-btn"
              disabled={pagination.page <= 1}
              onClick={() => setTicketPage(p => Math.max(1, p - 1))}
            >
              ← Previous
            </button>
            <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>
              Page {pagination.page} of {pagination.totalPages} · {pagination.total} ticket{pagination.total === 1 ? '' : 's'}
            </span>
            <button
              className="cancel-btn"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => setTicketPage(p => Math.min(pagination.totalPages, p + 1))}
            >
              Next →
            </button>
          </div>
        )}
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
