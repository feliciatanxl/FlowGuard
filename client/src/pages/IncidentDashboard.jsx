import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import Sidebar from '../components/Sidebar';
import '../css/Dashboard.css';
import '../css/Management.css';
import '../css/Users.css';
import '../css/IncidentDashboard.css';

// ---------------------------------------------------------------------------
// Static seed data — used once on first load to populate the DB.
// ---------------------------------------------------------------------------
const T = (hoursAgo) =>
  new Date(Date.now() - hoursAgo * 3_600_000).toISOString();

const STATIC_INCIDENTS = [
  {
    camera_location: 'Gate A – Main Entrance',
    person_name: null,
    confidence_score: null,
    status: 'UNAUTHORIZED_ACCESS',
    source: 'Facial Recognition',
    severity: 'Critical',
    notes: '',
    createdAt: T(0.4),
  },
  {
    camera_location: 'Loading Bay 3',
    person_name: null,
    confidence_score: null,
    status: 'UNATTENDED_OBJECT',
    source: 'Object Detection',
    severity: 'High',
    notes: 'Unattended pallet detected for over 45 minutes. Staff dispatched to verify.',
    createdAt: T(1.2),
  },
  {
    camera_location: 'Sector B – Cold Storage',
    person_name: 'Ahmad Faris',
    confidence_score: 0.9234,
    status: 'TAILGATING',
    source: 'Facial Recognition',
    severity: 'Critical',
    notes: 'Ahmad Faris followed an authorised worker through a secured door without badging in. Incident escalated to security team.',
    createdAt: T(2.5),
  },
  {
    camera_location: 'Roof Stairwell',
    person_name: null,
    confidence_score: null,
    status: 'UNAUTHORIZED_ACCESS',
    source: 'Object Detection',
    severity: 'High',
    notes: '',
    createdAt: T(3.8),
  },
  {
    camera_location: 'Server Room Corridor',
    person_name: 'Priya Menon',
    confidence_score: 0.8812,
    status: 'UNAUTHORIZED_ACCESS',
    source: 'Facial Recognition',
    severity: 'Critical',
    notes: '',
    createdAt: T(5.1),
  },
  {
    camera_location: 'Loading Bay 1',
    person_name: null,
    confidence_score: null,
    status: 'UNATTENDED_OBJECT',
    source: 'Object Detection',
    severity: 'Medium',
    notes: 'Pallet successfully relocated to Bay 2 by staff. Confirmed false alarm.',
    createdAt: T(7.3),
  },
  {
    camera_location: 'Gate B – Staff Entrance',
    person_name: 'Jason Toh',
    confidence_score: 0.7621,
    status: 'AUTHORIZED_ACCESS',
    source: 'Facial Recognition',
    severity: 'Low',
    notes: 'Low-confidence match flagged for manual review. Physically verified by on-site guard — authorised personnel confirmed.',
    createdAt: T(9.0),
  },
  {
    camera_location: 'Sector C – Packaging',
    person_name: null,
    confidence_score: null,
    status: 'OVERCROWDING',
    source: 'Object Detection',
    severity: 'Medium',
    notes: 'Zone headcount exceeded threshold. Supervisor redistributed staff across bays.',
    createdAt: T(12.4),
  },
  {
    camera_location: 'Gate A – Main Entrance',
    person_name: 'Li Wei',
    confidence_score: 0.9712,
    status: 'TAILGATING',
    source: 'Facial Recognition',
    severity: 'High',
    notes: 'Second tailgating incident involving same individual within 24 hours. Security notified.',
    createdAt: T(15.6),
  },
  {
    camera_location: 'Loading Bay 2',
    person_name: null,
    confidence_score: null,
    status: 'UNATTENDED_OBJECT',
    source: 'Object Detection',
    severity: 'Low',
    notes: '',
    createdAt: T(20.1),
  },
  {
    camera_location: 'Sector A – Freezer',
    person_name: 'Nur Hidayah',
    confidence_score: 0.8443,
    status: 'UNAUTHORIZED_ACCESS',
    source: 'Facial Recognition',
    severity: 'Critical',
    notes: '',
    createdAt: T(30.5),
  },
  {
    camera_location: 'Roof Stairwell',
    person_name: null,
    confidence_score: null,
    status: 'LOITERING',
    source: 'Object Detection',
    severity: 'Medium',
    notes: 'Maintenance crew identified on site. FM confirmed authorised access.',
    createdAt: T(45.2),
  },
];

const SEED_FLAG = 'flowguard_incidents_seeded';

// ---------------------------------------------------------------------------
// Badge helpers
// ---------------------------------------------------------------------------
const severityClass = (s) => {
  switch (s) {
    case 'Critical': return 'inc-badge inc-severity-critical';
    case 'High':     return 'inc-badge inc-severity-high';
    case 'Medium':   return 'inc-badge inc-severity-medium';
    case 'Low':      return 'inc-badge inc-severity-low';
    default:         return 'inc-badge';
  }
};

const statusClass = (s) => {
  switch (s) {
    case 'Active':                return 'inc-badge inc-status-active';
    case 'Investigating':         return 'inc-badge inc-status-investigating';
    case 'Escalated to Security': return 'inc-badge inc-status-escalated';
    case 'Cleared':               return 'inc-badge inc-status-cleared';
    default:                      return 'inc-badge';
  }
};

const sourceClass = (s) => {
  switch (s) {
    case 'Facial Recognition': return 'inc-badge inc-source-fr';
    case 'Manual':             return 'inc-badge inc-source-manual';
    default:                   return 'inc-badge inc-source-od';
  }
};

const sourceLabel = (s) => {
  switch (s) {
    case 'Facial Recognition': return 'Face ID';
    case 'Manual':             return 'Manual';
    default:                   return 'Object Det.';
  }
};

const truncate = (str, n = 30) =>
  str && str.length > n ? str.slice(0, n) + '…' : str;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
const IncidentDashboard = () => {
  // --- Data ---
  const [incidents, setIncidents]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [newRowId, setNewRowId]     = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  // --- Filters ---
  const [search, setSearch]                 = useState('');
  const [severityFilter, setSeverityFilter] = useState('All');
  const [sourceFilter, setSourceFilter]     = useState('All');
  const [statusFilter, setStatusFilter]     = useState('All');

  // --- Detail / edit modal ---
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [editMode, setEditMode]                 = useState(false);
  const [editForm, setEditForm]                 = useState({ resolutionStatus: '', notes: '' });
  const [editSaving, setEditSaving]             = useState(false);

  // --- Create modal ---
  const [showCreate, setShowCreate]     = useState(false);
  const [createForm, setCreateForm]     = useState({
    camera_location: '',
    status: 'UNAUTHORIZED_ACCESS',
    severity: 'Medium',
    person_name: '',
    confidence_score: '',
    notes: '',
  });
  const [createSaving, setCreateSaving] = useState(false);

  // --- Delete confirm modal ---
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteSaving, setDeleteSaving] = useState(false);

  // --- Toast stack (array, each has its own 3s timer) ---
  const [toasts, setToasts]     = useState([]);
  const toastCounterRef         = useRef(0);

  // --- Back to top ---
  const [showBackTop, setShowBackTop] = useState(false);
  const [backTopLeft, setBackTopLeft] = useState('50%');
  const mainRef = useRef(null);

  // ---------------------------------------------------------------------------
  // Toast (stacking, non-overwriting, typed)
  // ---------------------------------------------------------------------------
  const showToast = useCallback((msg, type = 'success') => {
    const id = ++toastCounterRef.current;
    setToasts(prev => [...prev, { id, message: msg, type, removing: false }]);
    // After 3s start exit animation, then remove from DOM after animation
    setTimeout(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, removing: true } : t));
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 400);
    }, 3000);
  }, []);

  const getToken = () => localStorage.getItem('accessToken');

  // ---------------------------------------------------------------------------
  // Back-to-top: scroll listener on dashboard-main (it owns overflow-y: auto)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const handleScroll = () => setShowBackTop(el.scrollTop > 300);
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  // Track dashboard-main position for accurate horizontal centering
  useEffect(() => {
    const updatePos = () => {
      if (mainRef.current) {
        const rect = mainRef.current.getBoundingClientRect();
        setBackTopLeft(`${rect.left + rect.width / 2}px`);
      }
    };
    updatePos();
    window.addEventListener('resize', updatePos);
    return () => window.removeEventListener('resize', updatePos);
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch from API
  // ---------------------------------------------------------------------------
  const fetchIncidents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/incident', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      setIncidents(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error('Failed to fetch incidents:', err);
      showToast('Failed to load incidents from server.', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  // ---------------------------------------------------------------------------
  // On mount: one-time seed, then fetch
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const seedAndFetch = async () => {
      if (!localStorage.getItem(SEED_FLAG)) {
        try {
          const token = getToken();
          for (const inc of STATIC_INCIDENTS) {
            await axios.post('/api/incident', {
              camera_location: inc.camera_location,
              status: inc.status,
              source: inc.source,
              severity: inc.severity,
              person_name: inc.person_name || undefined,
              confidence_score: inc.confidence_score || undefined,
              notes: inc.notes || '',
            }, { headers: { Authorization: `Bearer ${token}` } });
          }
          localStorage.setItem(SEED_FLAG, 'true');
        } catch (err) {
          console.warn('Seed partial/failed — will retry next load:', err.message);
        }
      }
      await fetchIncidents();
    };
    seedAndFetch();
  }, [fetchIncidents]);

  // ---------------------------------------------------------------------------
  // Filter + stats
  // ---------------------------------------------------------------------------
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return incidents.filter((i) => {
      const matchSearch =
        !q ||
        (i.person_name || '').toLowerCase().includes(q) ||
        i.camera_location.toLowerCase().includes(q);
      const matchSeverity = severityFilter === 'All' || i.severity === severityFilter;
      const matchSource   = sourceFilter   === 'All' || i.source === sourceFilter;
      const matchStatus   = statusFilter   === 'All' || i.resolutionStatus === statusFilter;
      return matchSearch && matchSeverity && matchSource && matchStatus;
    });
  }, [incidents, search, severityFilter, sourceFilter, statusFilter]);

  const stats = useMemo(() => ({
    total:         filtered.length,
    critical:      filtered.filter((i) => i.severity === 'Critical' && i.resolutionStatus === 'Active').length,
    investigating: filtered.filter((i) => ['Investigating', 'Escalated to Security'].includes(i.resolutionStatus)).length,
    cleared:       filtered.filter((i) => i.resolutionStatus === 'Cleared').length,
  }), [filtered]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------
  const openDetail = (incident) => {
    setSelectedIncident(incident);
    setEditMode(false);
    setEditForm({
      resolutionStatus: incident.resolutionStatus || 'Active',
      notes: incident.notes || '',
    });
  };

  const closeDetail = () => {
    setSelectedIncident(null);
    setEditMode(false);
  };

  const handleDelete = (incident) => setDeleteTarget(incident);

  const confirmDelete = async () => {
    const targetId       = deleteTarget.id;
    const targetLocation = deleteTarget.camera_location;
    setDeleteTarget(null);  // close confirm modal right away
    setDeleteSaving(true);
    try {
      await axios.delete(`/api/incident/${targetId}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (selectedIncident?.id === targetId) closeDetail();
      // Play exit animation then remove from state
      setDeletingId(targetId);
      setTimeout(() => {
        setIncidents(prev => prev.filter(i => i.id !== targetId));
        setDeletingId(null);
      }, 400);
      showToast(`Incident #${targetId} at ${targetLocation} deleted.`, 'delete');
    } catch (err) {
      console.error('Delete failed:', err);
      showToast('Failed to delete incident. Please try again.', 'error');
    } finally {
      setDeleteSaving(false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreateSaving(true);
    try {
      const res = await axios.post('/api/incident', {
        camera_location: createForm.camera_location,
        status: createForm.status,
        source: 'Manual',
        severity: createForm.severity,
        person_name: createForm.person_name || undefined,
        confidence_score: createForm.confidence_score
          ? parseFloat(createForm.confidence_score)
          : undefined,
        notes: createForm.notes || '',
      }, { headers: { Authorization: `Bearer ${getToken()}` } });

      setIncidents(prev => [res.data, ...prev]);
      setNewRowId(res.data.id);
      setTimeout(() => setNewRowId(null), 700);

      setShowCreate(false);
      setCreateForm({
        camera_location: '',
        status: 'UNAUTHORIZED_ACCESS',
        severity: 'Medium',
        person_name: '',
        confidence_score: '',
        notes: '',
      });
      showToast('Incident logged successfully.', 'success');
    } catch (err) {
      console.error('Create failed:', err);
      showToast('Failed to create incident. Please check required fields.', 'error');
    } finally {
      setCreateSaving(false);
    }
  };

  const handleSaveEdit = async () => {
    setEditSaving(true);
    try {
      const res = await axios.patch(`/api/incident/${selectedIncident.id}`, editForm, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      setIncidents(prev => prev.map(i => i.id === selectedIncident.id ? res.data : i));
      setSelectedIncident(res.data);
      setEditMode(false);
      showToast('Incident updated.', 'success');
    } catch (err) {
      console.error('Update failed:', err);
      showToast('Failed to save changes. Please try again.', 'error');
    } finally {
      setEditSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="dashboard-layout">
      <Sidebar />

      <main className="dashboard-main" ref={mainRef}>
        {/* ---- Header ---- */}
        <header className="dashboard-header">
          <div className="header-titles">
            <h1>Incident Command Center</h1>
            <p style={{ color: '#94a3b8', marginTop: '4px' }}>
              AI-generated and manually logged security incidents
            </p>
          </div>
          <button className="inc-create-btn" onClick={() => setShowCreate(true)}>
            + Log Incident
          </button>
        </header>

        {/* ---- Summary Cards ---- */}
        <div className="inc-stats-grid">
          <div className="inc-stat-card inc-stat-blue">
            <div className="inc-stat-value">{stats.total}</div>
            <div className="inc-stat-label">Total Incidents</div>
          </div>
          <div className="inc-stat-card inc-stat-red">
            <div className="inc-stat-value">{stats.critical}</div>
            <div className="inc-stat-label">Critical / Active</div>
          </div>
          <div className="inc-stat-card inc-stat-orange">
            <div className="inc-stat-value">{stats.investigating}</div>
            <div className="inc-stat-label">Under Investigation</div>
          </div>
          <div className="inc-stat-card inc-stat-green">
            <div className="inc-stat-value">{stats.cleared}</div>
            <div className="inc-stat-label">Cleared</div>
          </div>
        </div>

        {/* ---- Loading bar ---- */}
        {loading && <div className="inc-loading-bar">Loading incidents...</div>}

        {/* ---- Filter Bar ---- */}
        <div className="inc-filter-bar">
          <input
            type="text"
            className="inc-search-input"
            placeholder="Search by person or location..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="inc-select"
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            aria-label="Filter by severity"
          >
            <option value="All">All Severities</option>
            <option>Critical</option>
            <option>High</option>
            <option>Medium</option>
            <option>Low</option>
          </select>
          <select
            className="inc-select"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            aria-label="Filter by source"
          >
            <option value="All">All Sources</option>
            <option>Facial Recognition</option>
            <option>Object Detection</option>
            <option value="Manual">Manual</option>
          </select>
          <select
            className="inc-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by resolution status"
          >
            <option value="All">All Statuses</option>
            <option>Active</option>
            <option>Investigating</option>
            <option>Escalated to Security</option>
            <option>Cleared</option>
          </select>
        </div>

        {/* ---- Toast Stack (between filter bar and table) ---- */}
        {toasts.length > 0 && (
          <div className="inc-toast-stack">
            {toasts.map(t => (
              <div
                key={t.id}
                className={`inc-toast-item inc-toast-${t.type}${t.removing ? ' removing' : ''}`}
              >
                {t.message}
              </div>
            ))}
          </div>
        )}

        {/* ---- Incidents Table ---- */}
        <div className="table-container">
          <table className="management-table">
            <thead>
              <tr>
                <th>TIMESTAMP</th>
                <th>LOCATION</th>
                <th>PERSON</th>
                <th>SOURCE</th>
                <th>CONFIDENCE</th>
                <th>SEVERITY</th>
                <th>STATUS</th>
                <th style={{ textAlign: 'center' }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {!loading && filtered.length === 0 ? (
                <tr>
                  <td colSpan="8" style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
                    No incidents match the current filters.
                  </td>
                </tr>
              ) : (
                filtered.map((incident) => {
                  const rowClass = [
                    incident.id === newRowId    ? 'inc-row-new'      : '',
                    incident.id === deletingId  ? 'inc-row-deleting' : '',
                    incident.source === 'Manual' ? 'inc-row-manual'  : '',
                  ].filter(Boolean).join(' ');

                  return (
                    <tr key={incident.id} className={rowClass || undefined}>
                      <td style={{ fontFamily: 'monospace', color: '#cbd5e1', fontSize: '0.83rem' }}>
                        {new Date(incident.createdAt).toLocaleString('en-SG')}
                      </td>
                      <td style={{ color: '#e2e8f0' }} title={incident.camera_location}>{truncate(incident.camera_location)}</td>
                      <td>
                        {incident.person_name ? (
                          <div className="inc-person-cell" title={incident.person_name}>
                            <div className="inc-person-initial">
                              {incident.person_name[0].toUpperCase()}
                            </div>
                            <span>{truncate(incident.person_name)}</span>
                          </div>
                        ) : (
                          <em style={{ color: '#64748b' }}>Unknown</em>
                        )}
                      </td>
                      <td>
                        <span className={sourceClass(incident.source)}>
                          {sourceLabel(incident.source)}
                        </span>
                      </td>
                      <td style={{ fontFamily: 'monospace', color: '#94a3b8' }}>
                        {incident.confidence_score != null
                          ? `${(incident.confidence_score * 100).toFixed(1)}%`
                          : <em style={{ color: '#475569' }}>—</em>}
                      </td>
                      <td>
                        <span className={severityClass(incident.severity)}>
                          {incident.severity}
                        </span>
                      </td>
                      <td>
                        <span className={statusClass(incident.resolutionStatus)}>
                          {incident.resolutionStatus}
                        </span>
                      </td>
                      <td className="actions-cell">
                        <div className="action-button-group">
                          <button
                            className="action-btn action-neutral"
                            onClick={() => openDetail(incident)}
                          >
                            View
                          </button>
                          <button
                            className="action-btn action-danger"
                            onClick={() => handleDelete(incident)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ---- Detail / Edit Modal ---- */}
        {selectedIncident && (
          <div className="modal-overlay" onClick={closeDetail}>
            <div className="inc-detail-modal" onClick={(e) => e.stopPropagation()}>
              <div className="inc-modal-header">
                <div>
                  <h2>Incident Report</h2>
                  <p style={{ color: '#64748b', margin: 0, fontSize: '0.85rem' }}>
                    ID #{selectedIncident.id}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {editMode ? (
                    <button className="edit-btn" onClick={() => setEditMode(false)}>
                      Cancel
                    </button>
                  ) : (
                    <button
                      className="edit-btn"
                      onClick={() => {
                        setEditMode(true);
                        setEditForm({
                          resolutionStatus: selectedIncident.resolutionStatus || 'Active',
                          notes: selectedIncident.notes || '',
                        });
                      }}
                    >
                      Edit
                    </button>
                  )}
                  <button className="edit-btn" onClick={closeDetail}>
                    ✕ Close
                  </button>
                </div>
              </div>

              <div className="inc-detail-grid">
                <div className="inc-detail-item">
                  <span className="inc-detail-label">Timestamp</span>
                  <span className="inc-detail-value" style={{ fontFamily: 'monospace' }}>
                    {new Date(selectedIncident.createdAt).toLocaleString('en-SG')}
                  </span>
                </div>
                <div className="inc-detail-item">
                  <span className="inc-detail-label">Location</span>
                  <span className="inc-detail-value">{selectedIncident.camera_location}</span>
                </div>
                <div className="inc-detail-item">
                  <span className="inc-detail-label">Person</span>
                  <span className="inc-detail-value">
                    {selectedIncident.person_name || <em style={{ color: '#64748b' }}>Unknown</em>}
                  </span>
                </div>
                <div className="inc-detail-item">
                  <span className="inc-detail-label">Source</span>
                  <span className={sourceClass(selectedIncident.source)} style={{ marginTop: '2px' }}>
                    {selectedIncident.source}
                  </span>
                </div>
                <div className="inc-detail-item">
                  <span className="inc-detail-label">Detection Type</span>
                  <span className="inc-detail-value">{selectedIncident.status.replace(/_/g, ' ')}</span>
                </div>
                <div className="inc-detail-item">
                  <span className="inc-detail-label">Confidence Score</span>
                  <span className="inc-detail-value" style={{ fontFamily: 'monospace' }}>
                    {selectedIncident.confidence_score != null
                      ? `${(selectedIncident.confidence_score * 100).toFixed(1)}%`
                      : '—'}
                  </span>
                </div>
                <div className="inc-detail-item">
                  <span className="inc-detail-label">Severity</span>
                  <span className={severityClass(selectedIncident.severity)} style={{ marginTop: '2px' }}>
                    {selectedIncident.severity}
                  </span>
                </div>
                <div className="inc-detail-item">
                  <span className="inc-detail-label">Resolution Status</span>
                  {editMode ? (
                    <select
                      className="inc-select"
                      value={editForm.resolutionStatus}
                      onChange={(e) => setEditForm(f => ({ ...f, resolutionStatus: e.target.value }))}
                      style={{ marginTop: '2px' }}
                    >
                      <option>Active</option>
                      <option>Investigating</option>
                      <option>Escalated to Security</option>
                      <option>Cleared</option>
                    </select>
                  ) : (
                    <span className={statusClass(selectedIncident.resolutionStatus)} style={{ marginTop: '2px' }}>
                      {selectedIncident.resolutionStatus}
                    </span>
                  )}
                </div>
              </div>

              <div className="inc-notes-section">
                <span className="inc-detail-label">Notes</span>
                {editMode ? (
                  <>
                    <textarea
                      className="inc-notes-textarea"
                      rows={4}
                      value={editForm.notes}
                      onChange={(e) => setEditForm(f => ({ ...f, notes: e.target.value }))}
                      placeholder="Add notes..."
                    />
                    <div className="modal-actions" style={{ justifyContent: 'flex-start', marginTop: '12px' }}>
                      <button
                        className="cancel-btn"
                        onClick={() => setEditMode(false)}
                        disabled={editSaving}
                      >
                        Cancel
                      </button>
                      <button
                        className="inc-save-btn"
                        onClick={handleSaveEdit}
                        disabled={editSaving}
                      >
                        {editSaving ? 'Saving...' : 'Save Changes'}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="inc-notes-box">
                    {selectedIncident.notes
                      ? selectedIncident.notes
                      : <em style={{ color: '#475569' }}>No notes recorded.</em>}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ---- Create Modal ---- */}
        {showCreate && (
          <div className="modal-overlay" onClick={() => setShowCreate(false)}>
            <div className="inc-create-modal" onClick={(e) => e.stopPropagation()}>
              <div className="inc-modal-header">
                <div>
                  <h2>Log New Incident</h2>
                  <p style={{ color: '#64748b', margin: 0, fontSize: '0.85rem' }}>
                    Manually record a security incident
                  </p>
                </div>
                <button className="edit-btn" onClick={() => setShowCreate(false)}>
                  ✕ Close
                </button>
              </div>

              <form onSubmit={handleCreate} className="inc-form">
                <div className="inc-form-grid">
                  <div className="inc-form-group inc-form-full">
                    <label className="inc-detail-label">Camera Location *</label>
                    <input
                      type="text"
                      className="inc-search-input"
                      placeholder="e.g. Gate A – Main Entrance"
                      value={createForm.camera_location}
                      onChange={(e) => setCreateForm(f => ({ ...f, camera_location: e.target.value }))}
                      required
                    />
                  </div>

                  <div className="inc-form-group">
                    <label className="inc-detail-label">Incident Type *</label>
                    <select
                      className="inc-select"
                      value={createForm.status}
                      onChange={(e) => setCreateForm(f => ({ ...f, status: e.target.value }))}
                      required
                    >
                      <option value="UNAUTHORIZED_ACCESS">Unauthorized Access</option>
                      <option value="TAILGATING">Tailgating</option>
                      <option value="UNATTENDED_OBJECT">Unattended Object</option>
                      <option value="OVERCROWDING">Overcrowding</option>
                      <option value="LOITERING">Loitering</option>
                      <option value="AUTHORIZED_ACCESS">Authorized Access (Flagged)</option>
                    </select>
                  </div>

                  <div className="inc-form-group">
                    <label className="inc-detail-label">Source</label>
                    <div className="inc-source-locked">
                      <span className={sourceClass('Manual')}>Manual Entry</span>
                      <span className="inc-source-locked-note">Auto-set for manual logs</span>
                    </div>
                  </div>

                  <div className="inc-form-group">
                    <label className="inc-detail-label">Severity *</label>
                    <select
                      className="inc-select"
                      value={createForm.severity}
                      onChange={(e) => setCreateForm(f => ({ ...f, severity: e.target.value }))}
                      required
                    >
                      <option>Critical</option>
                      <option>High</option>
                      <option>Medium</option>
                      <option>Low</option>
                    </select>
                  </div>

                  <div className="inc-form-group">
                    <label className="inc-detail-label">Person Name (optional)</label>
                    <input
                      type="text"
                      className="inc-search-input"
                      placeholder="e.g. Ahmad Faris"
                      value={createForm.person_name}
                      onChange={(e) => setCreateForm(f => ({ ...f, person_name: e.target.value }))}
                    />
                  </div>

                  <div className="inc-form-group">
                    <label className="inc-detail-label">Confidence Score (optional, 0–1)</label>
                    <input
                      type="number"
                      className="inc-search-input"
                      placeholder="e.g. 0.92"
                      min="0"
                      max="1"
                      step="0.0001"
                      value={createForm.confidence_score}
                      onChange={(e) => setCreateForm(f => ({ ...f, confidence_score: e.target.value }))}
                    />
                  </div>

                  <div className="inc-form-group inc-form-full">
                    <label className="inc-detail-label">Notes (optional)</label>
                    <textarea
                      className="inc-notes-textarea"
                      rows={3}
                      placeholder="Describe the incident..."
                      value={createForm.notes}
                      onChange={(e) => setCreateForm(f => ({ ...f, notes: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="modal-actions" style={{ justifyContent: 'flex-end', marginTop: '20px' }}>
                  <button
                    type="button"
                    className="cancel-btn"
                    onClick={() => setShowCreate(false)}
                    disabled={createSaving}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="inc-save-btn" disabled={createSaving}>
                    {createSaving ? 'Logging...' : 'Log Incident'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ---- Delete Confirm Modal ---- */}
        {deleteTarget && (
          <div
            className="modal-overlay"
            onClick={() => { if (!deleteSaving) setDeleteTarget(null); }}
          >
            <div className="modal-content delete-variant" onClick={(e) => e.stopPropagation()}>
              <span className="red-glow">⚠</span>
              <h3 style={{ color: '#f8fafc', marginBottom: '12px' }}>Delete Incident?</h3>
              <p style={{ color: '#94a3b8', lineHeight: 1.6, marginBottom: '8px' }}>
                Permanently delete incident{' '}
                <strong style={{ color: '#e2e8f0' }}>#{deleteTarget.id}</strong> at{' '}
                <strong style={{ color: '#e2e8f0' }}>{deleteTarget.camera_location}</strong>?
              </p>
              <p style={{ color: '#64748b', fontSize: '0.82rem', marginBottom: '24px' }}>
                This action is irreversible.
              </p>
              <div className="modal-actions">
                <button
                  className="cancel-btn"
                  onClick={() => setDeleteTarget(null)}
                  disabled={deleteSaving}
                >
                  Cancel
                </button>
                <button
                  className="confirm-delete-btn"
                  onClick={confirmDelete}
                  disabled={deleteSaving}
                >
                  {deleteSaving ? 'Deleting...' : 'Confirm Delete'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ---- Back to Top (fixed, centered on dashboard-main) ---- */}
      <button
        className={`inc-back-top${showBackTop ? ' visible' : ''}`}
        style={{ left: backTopLeft }}
        onClick={() => mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
        aria-label="Back to top"
      >
        ↑
      </button>
    </div>
  );
};

export default IncidentDashboard;
