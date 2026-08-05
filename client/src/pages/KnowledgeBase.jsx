import { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import Sidebar from '../components/Sidebar';
import '../css/Dashboard.css';
import '../css/Management.css';
import '../css/SupportDashboard.css';

const TOKEN = () => localStorage.getItem('accessToken');

// Suggested categories — free text server-side, but a fixed list keeps the
// filter dropdown stable regardless of which categories currently have entries.
// Mirrors SupportDashboard.jsx's TICKET_CATEGORIES.
const KB_CATEGORIES = ['General', 'Access Control', 'Loading Bay', 'Visitor Parking', 'Security'];

// Split out of SupportDashboard.jsx's former "Knowledge Base" tab into its own
// sidebar-linked page — the tabber is gone, this is the whole page now.
const KnowledgeBase = () => {
  const [kbEntries, setKbEntries] = useState([]);
  const [kbCategoryFilter, setKbCategoryFilter] = useState('All');
  const [kbSearch, setKbSearch] = useState('');
  const [kbLoading, setKbLoading] = useState(true);
  const [kbForm, setKbForm] = useState({ category: 'General', question: '', answer: '', keywords: '' });
  const [kbEditId, setKbEditId] = useState(null);
  const [kbSaving, setKbSaving] = useState(false);
  const [kbDeleteConfirm, setKbDeleteConfirm] = useState(null);

  const [notification, setNotification] = useState({ text: '', type: 'success' });
  const toast = (text, type = 'success') => {
    setNotification({ text, type });
    setTimeout(() => setNotification({ text: '', type: 'success' }), 4000);
  };

  const fetchKB = useCallback(async () => {
    setKbLoading(true);
    try {
      const params = new URLSearchParams();
      if (kbCategoryFilter !== 'All') params.set('category', kbCategoryFilter);
      if (kbSearch.trim()) params.set('q', kbSearch.trim());

      const { data } = await axios.get(`/api/support/knowledge?${params.toString()}`, {
        headers: { Authorization: `Bearer ${TOKEN()}` }
      });
      setKbEntries(Array.isArray(data) ? data : []);
    } catch {
      toast('Could not load knowledge base.', 'error');
    } finally {
      setKbLoading(false);
    }
  }, [kbCategoryFilter, kbSearch]);

  useEffect(() => { (async () => { await fetchKB(); })(); }, [fetchKB]);

  const resetKbForm = () => {
    setKbForm({ category: 'General', question: '', answer: '', keywords: '' });
    setKbEditId(null);
  };

  const startKbEdit = (entry) => {
    setKbForm({
      category: entry.category,
      question: entry.question,
      answer: entry.answer,
      keywords: Array.isArray(entry.keywords) ? entry.keywords.join(', ') : ''
    });
    setKbEditId(entry.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const saveKbEntry = async (e) => {
    e.preventDefault();
    if (!kbForm.question.trim() || !kbForm.answer.trim()) {
      toast('Question and Answer are required.', 'error');
      return;
    }

    const payload = {
      category: kbForm.category.trim() || 'General',
      question: kbForm.question.trim(),
      answer: kbForm.answer.trim(),
      keywords: kbForm.keywords.split(',').map(k => k.trim()).filter(Boolean)
    };

    setKbSaving(true);
    try {
      if (kbEditId) {
        await axios.put(`/api/support/knowledge/${kbEditId}`, payload, {
          headers: { Authorization: `Bearer ${TOKEN()}` }
        });
        toast('Knowledge base entry updated.');
      } else {
        await axios.post('/api/support/knowledge', payload, {
          headers: { Authorization: `Bearer ${TOKEN()}` }
        });
        toast('FAQ added to knowledge base.');
      }
      resetKbForm();
      fetchKB();
    } catch {
      toast('Could not save knowledge base entry.', 'error');
    } finally {
      setKbSaving(false);
    }
  };

  const deleteKbEntry = async (id) => {
    try {
      await axios.delete(`/api/support/knowledge/${id}`, {
        headers: { Authorization: `Bearer ${TOKEN()}` }
      });
      toast('Knowledge base entry deleted.');
      setKbDeleteConfirm(null);
      fetchKB();
    } catch {
      toast('Could not delete entry.', 'error');
    }
  };

  return (
    <div className="dashboard-layout">
      <Sidebar />
      <main className="dashboard-main">
        <header className="dashboard-header">
          <div className="header-titles">
            <h1>Knowledge Base</h1>
            <p>Manage the FAQ entries the AI support assistant draws its answers from</p>
          </div>
        </header>

        {notification.text && (
          <div className={`toast-notification ${notification.type}`}>{notification.text}</div>
        )}

        {/* Add / Edit Form */}
        <div className="support-kb-form-card">
          <h3>{kbEditId ? 'Edit FAQ Entry' : 'Add New FAQ'}</h3>
          <form onSubmit={saveKbEntry}>
            <div className="support-form-row">
              <label>Category</label>
              <input
                type="text"
                value={kbForm.category}
                onChange={e => setKbForm(p => ({ ...p, category: e.target.value }))}
                placeholder="e.g. Access Control"
              />
            </div>
            <div className="support-form-row">
              <label>Question *</label>
              <input
                type="text"
                value={kbForm.question}
                onChange={e => setKbForm(p => ({ ...p, question: e.target.value }))}
                placeholder="e.g. Why does my face scan keep failing?"
                required
              />
            </div>
            <div className="support-form-row">
              <label>Answer *</label>
              <textarea
                rows={4}
                value={kbForm.answer}
                onChange={e => setKbForm(p => ({ ...p, answer: e.target.value }))}
                placeholder="Provide a clear, actionable response for the tenant..."
                required
              />
            </div>
            <div className="support-form-row">
              <label>Keywords <span style={{ color: '#64748b' }}>(comma-separated)</span></label>
              <input
                type="text"
                value={kbForm.keywords}
                onChange={e => setKbForm(p => ({ ...p, keywords: e.target.value }))}
                placeholder="e.g. face, scan, biometric, access, unit"
              />
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              <button type="submit" className="edit-btn support-save-btn" disabled={kbSaving}>
                {kbSaving ? 'Saving...' : kbEditId ? 'Update Entry' : 'Add Entry'}
              </button>
              {kbEditId && (
                <button type="button" className="cancel-btn" onClick={resetKbForm}>
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', margin: '1.5rem 0 0', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Search questions or answers..."
            value={kbSearch}
            onChange={e => setKbSearch(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: '6px', background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155', minWidth: '220px', flex: '1 1 220px' }}
          />
          <label style={{ color: '#94a3b8' }}>Category:</label>
          <select
            value={kbCategoryFilter}
            onChange={e => setKbCategoryFilter(e.target.value)}
            style={{ padding: '8px', borderRadius: '6px', background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155' }}
          >
            <option value="All">All</option>
            {KB_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* KB List */}
        <div className="table-container" style={{ marginTop: '1rem' }}>
          <table className="management-table">
            <thead>
              <tr>
                <th>CATEGORY</th>
                <th>QUESTION</th>
                <th>ANSWER</th>
                <th>KEYWORDS</th>
                <th>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {kbLoading ? (
                <tr><td colSpan="5" style={{ textAlign: 'center', padding: '40px' }}>Loading knowledge base...</td></tr>
              ) : kbEntries.length === 0 ? (
                <tr><td colSpan="5" style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
                  {kbCategoryFilter === 'All' && !kbSearch.trim()
                    ? 'No FAQ entries yet. Add the first one above.'
                    : 'No FAQ entries match your search/filter.'}
                </td></tr>
              ) : kbEntries.map(entry => (
                <tr key={entry.id}>
                  <td data-label="Category">
                    <span className="status-badge active" style={{ fontSize: '0.7rem' }}>{entry.category}</span>
                  </td>
                  <td data-label="Question" style={{ maxWidth: '200px' }}>
                    <strong>{entry.question}</strong>
                  </td>
                  <td data-label="Answer" style={{ maxWidth: '260px', color: '#94a3b8', fontSize: '0.85rem' }}>
                    {entry.answer.substring(0, 120)}{entry.answer.length > 120 ? '...' : ''}
                  </td>
                  <td data-label="Keywords">
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                      {(entry.keywords || []).map(k => (
                        <span key={k} className="support-keyword-tag">{k}</span>
                      ))}
                    </div>
                  </td>
                  <td data-label="Actions">
                    <button className="edit-btn" onClick={() => startKbEdit(entry)}>Edit</button>
                    <button className="revoke-btn" onClick={() => setKbDeleteConfirm(entry)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>

      {/* ── DELETE KB CONFIRM MODAL ───────────────────────────────────────── */}
      {kbDeleteConfirm && (
        <div className="modal-overlay">
          <div className="modal-content delete-variant">
            <span className="red-glow">⚠️</span>
            <h3>Remove FAQ?</h3>
            <p className="warning-subtext">
              "{kbDeleteConfirm.question}" will be removed from the AI knowledge base. Tenants will no longer get this automated answer.
            </p>
            <div className="modal-actions">
              <button className="cancel-btn" onClick={() => setKbDeleteConfirm(null)}>Cancel</button>
              <button className="confirm-delete-btn" onClick={() => deleteKbEntry(kbDeleteConfirm.id)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default KnowledgeBase;
