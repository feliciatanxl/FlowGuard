import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router';
import axios from 'axios';
import Sidebar from '../components/Sidebar';
import '../css/Dashboard.css';
import '../css/Management.css';
import '../css/Users.css';
import '../css/IncidentDashboard.css';
import { formatDetectionType, toTitleCase } from '../utils/incidentAnalytics';

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
    case 'False Positive':        return 'inc-badge inc-status-false-positive';
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

// Sentinel value for the "Other / Custom..." option — never sent to the server
// as-is; handleCreate substitutes createForm.customStatus in its place.
const CUSTOM_INCIDENT_TYPE = 'OTHER_CUSTOM';
const CUSTOM_TYPE_MAX_LENGTH = 35;

// Notes textarea auto-grow cap (px) — must match the max-height in
// .inc-notes-textarea-autogrow (IncidentDashboard.css). Beyond this the box
// stops growing and scrolls internally instead of running off-screen.
const NOTES_TEXTAREA_MAX_HEIGHT = 200;

// Break a location string into lines: max 2 words OR max 12 chars per line,
// whichever limit is hit first. Total display capped at 30 chars (word boundary).
const formatLocation = (str) => {
  if (!str) return '';
  let text = str;
  let ellipsis = false;
  if (str.length > 30) {
    const cut = str.slice(0, 30);
    const lastSpace = cut.lastIndexOf(' ');
    text = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
    ellipsis = true;
  }
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let lineWords = [];
  let lineLen = 0;
  for (const word of words) {
    if (lineWords.length === 0) {
      lineWords = [word];
      lineLen = word.length;
    } else {
      const tentativeLen = lineLen + 1 + word.length;
      if (tentativeLen > 15) {
        lines.push(lineWords.join(' '));
        lineWords = [word];
        lineLen = word.length;
      } else {
        lineWords.push(word);
        lineLen = tentativeLen;
      }
    }
  }
  if (lineWords.length > 0) lines.push(lineWords.join(' '));
  if (ellipsis && lines.length > 0) lines[lines.length - 1] += '…';
  return lines.join('\n');
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
const IncidentDashboard = () => {
  const navigate = useNavigate();

  // --- Data ---
  const [incidents, setIncidents]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [newRowIds, setNewRowIds]   = useState(new Set());
  const [deletingId, setDeletingId] = useState(null);

  // --- Filters ---
  const [search, setSearch]                 = useState('');
  const [severityFilter, setSeverityFilter] = useState('All');
  const [sourceFilter, setSourceFilter]     = useState('All');
  const [statusFilter, setStatusFilter]     = useState('All');

  // --- Detail / edit modal ---
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [editMode, setEditMode]                 = useState(false);
  const [editForm, setEditForm]                 = useState({ resolutionStatus: '', severity: '', notes: '' });
  const [editSaving, setEditSaving]             = useState(false);
  const editNotesRef = useRef(null);

  // --- Create modal ---
  const [showCreate, setShowCreate]     = useState(false);
  const [createForm, setCreateForm]     = useState({
    camera_location: '',
    status: 'UNAUTHORIZED_ACCESS',
    customStatus: '',
    severity: 'Medium',
    person_name: '',
    confidence_score: '',
    notes: '',
  });
  const [createSaving, setCreateSaving] = useState(false);
  const createNotesRef = useRef(null);

  // --- Delete confirm modal ---
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteSaving, setDeleteSaving] = useState(false);

  // --- Escalate to Ticket confirm modal (persists a real Support Ticket) ---
  const [escalateTarget, setEscalateTarget] = useState(null);
  const [escalateSaving, setEscalateSaving] = useState(false);

  // --- Toast stack (array, each has its own 3s timer) ---
  const [toasts, setToasts]     = useState([]);
  const toastCounterRef         = useRef(0);

  // --- Back to top ---
  const [showBackTop, setShowBackTop] = useState(false);
  const [backTopLeft, setBackTopLeft] = useState('50%');
  const mainRef = useRef(null);

  // --- Toast placement: in-flow above the table while its top edge is still
  // visible, floating top-right once the user has scrolled past it ---
  const [tableTopVisible, setTableTopVisible] = useState(true);
  const tableWrapRef = useRef(null);

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
  // Back-to-top + toast placement: scroll listener on dashboard-main (it owns
  // overflow-y: auto). The table's top edge is "in view" as long as it hasn't
  // scrolled above the container's own visible top — the same edge the in-flow
  // toast stack sits just above, so this is exactly the condition under which
  // that toast would otherwise be scrolled out of sight.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const handleScroll = () => {
      setShowBackTop(el.scrollTop > 300);
      const tableEl = tableWrapRef.current;
      if (tableEl) {
        setTableTopVisible(tableEl.getBoundingClientRect().top >= el.getBoundingClientRect().top);
      }
    };
    handleScroll();
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

  // Auto-grow the create form's Notes textarea to fit its content instead of
  // letting the user drag-resize it — re-measure whenever the text changes or
  // the modal (re)opens, since the ref is null while it's unmounted. Capped at
  // NOTES_TEXTAREA_MAX_HEIGHT so long notes scroll inside the box instead of
  // pushing the modal off-screen.
  useEffect(() => {
    const el = createNotesRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, NOTES_TEXTAREA_MAX_HEIGHT)}px`;
  }, [createForm.notes, showCreate]);

  // Same auto-grow/hardcap treatment for the detail modal's edit-mode Notes
  // textarea — re-measure whenever the text changes or edit mode toggles on,
  // since the ref is null while the textarea isn't rendered (view mode).
  useEffect(() => {
    const el = editNotesRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, NOTES_TEXTAREA_MAX_HEIGHT)}px`;
  }, [editForm.notes, editMode]);

  // ---------------------------------------------------------------------------
  // Fetch from API
  // ---------------------------------------------------------------------------
  const fetchIncidents = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await axios.get('/api/incident', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      setIncidents(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error('Failed to fetch incidents:', err);
      if (!silent) showToast('Failed to load incidents from server.', 'error');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [showToast]);

  // ---------------------------------------------------------------------------
  // Background poll — every 10s, silently diff for new AI-created incidents
  // Uses functional updater so prev is always current state (no stale closure)
  // ---------------------------------------------------------------------------
  const pollForNewIncidents = useCallback(async () => {
    try {
      const res = await axios.get('/api/incident', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const freshData = Array.isArray(res.data) ? res.data : [];

      setIncidents(prev => {
        const existingIds = new Set(prev.map(i => i.id));
        const brandNew = freshData.filter(i => !existingIds.has(i.id));

        if (brandNew.length === 0) return prev; // no change — skip re-render

        const newIdSet = new Set(brandNew.map(i => i.id));
        setNewRowIds(cur => new Set([...cur, ...newIdSet]));
        setTimeout(() => {
          setNewRowIds(cur => {
            const n = new Set(cur);
            newIdSet.forEach(id => n.delete(id));
            return n;
          });
        }, 700);

        return freshData;
      });
    } catch {
      // silent — polling errors are not surfaced to the user
    }
  }, []); // intentionally empty: functional updater pattern avoids stale closures

  // ---------------------------------------------------------------------------
  // On mount: fetch from DB (no seed — live AI data only)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    (async () => { await fetchIncidents(); })();
  }, [fetchIncidents]);

  // ---------------------------------------------------------------------------
  // Polling effect — 10s interval, cleaned up on unmount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const id = setInterval(pollForNewIncidents, 10_000);
    return () => clearInterval(id);
  }, [pollForNewIncidents]);

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

  // Manual and Facial Recognition are literal source values; Object Detection is
  // everything else (mirrors sourceClass()'s default-else bucketing above, since
  // real incidents also arrive with source values like 'Browser Webcam', 'Uploaded
  // Video', or 'SecurePi Edge Node' — not just the 3 literal strings). Computed this
  // way, the 3 segments always sum to filtered.length and always agree with the
  // table's own OD badge count.
  // Scoped to `filtered` (not the raw `incidents` list) so the split-bar reflects
  // whichever search/severity/source/status filters are currently applied — same
  // scope as the stats cards below, so both stay in agreement.
  const sourceCounts = useMemo(() => {
    const manual = filtered.filter(i => i.source === 'Manual').length;
    const fr = filtered.filter(i => i.source === 'Facial Recognition').length;
    return { manual, fr, od: filtered.length - manual - fr };
  }, [filtered]);

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
      severity: incident.severity || 'Medium',
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

  const handleEscalate = (incident) => setEscalateTarget(incident);

  // The server loads the incident itself and composes the ticket's title/
  // description (SupportTicket has no incidentId FK — it dedupes on a stable
  // title instead, serialized behind a Postgres advisory lock keyed on the
  // incident id), so the client only ever needs to pass sourceIncidentId.
  const confirmEscalate = async () => {
    if (!escalateTarget || escalateSaving) return;
    setEscalateSaving(true);
    try {
      const res = await axios.post('/api/support/tickets', {
        sourceIncidentId: escalateTarget.id
      }, { headers: { Authorization: `Bearer ${getToken()}` } });
      showToast(res.data?.duplicate
        ? `Incident #${escalateTarget.id} is already tracked in Support Tickets.`
        : `Incident #${escalateTarget.id} escalated to Support Tickets.`, 'success');
      setEscalateTarget(null);
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to escalate incident to Support Tickets.', 'error');
    } finally {
      setEscalateSaving(false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreateSaving(true);
    try {
      const resolvedStatus = createForm.status === CUSTOM_INCIDENT_TYPE
        ? toTitleCase(createForm.customStatus.trim().slice(0, CUSTOM_TYPE_MAX_LENGTH))
        : createForm.status;
      // Normalised once at creation (Location is never editable afterward), so
      // every downstream consumer — the table, the detail modal, an escalated
      // Support Ticket's description — always sees the same Title Case string.
      const resolvedLocation = toTitleCase(createForm.camera_location.trim());
      const res = await axios.post('/api/incident', {
        camera_location: resolvedLocation,
        status: resolvedStatus,
        source: 'Manual',
        severity: createForm.severity,
        person_name: createForm.person_name || undefined,
        confidence_score: createForm.confidence_score
          ? parseFloat(createForm.confidence_score)
          : undefined,
        notes: createForm.notes || '',
      }, { headers: { Authorization: `Bearer ${getToken()}` } });

      setIncidents(prev => [res.data, ...prev]);
      setNewRowIds(prev => new Set([...prev, res.data.id]));
      setTimeout(() => {
        setNewRowIds(prev => { const n = new Set(prev); n.delete(res.data.id); return n; });
      }, 700);

      setShowCreate(false);
      setCreateForm({
        camera_location: '',
        status: 'UNAUTHORIZED_ACCESS',
        customStatus: '',
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
            <h1>Incident Dashboard</h1>
            <p style={{ color: '#94a3b8', marginTop: '4px' }}>
              AI-generated and manually logged security incidents
            </p>
          </div>
          <div className="inc-header-actions">
            <button className="inc-create-btn" onClick={() => setShowCreate(true)}>
              + Log Incident
            </button>
            <button className="inc-analytics-btn" onClick={() => navigate('/incidents/analytics')}>
              View Deep Analytics →
            </button>
            <button className="inc-support-btn" onClick={() => navigate('/support-dashboard')}>
              Support Tickets →
            </button>
          </div>
        </header>

        {/* ---- Summary Cards ---- */}
        <div className="inc-stats-grid">
          <div className="inc-stat-card inc-stat-blue">
            <div className="inc-stat-value">{stats.total}</div>
            <div className="inc-stat-label">Total Incidents</div>
          </div>
          <div className="inc-stat-card inc-stat-red">
            <div className="inc-stat-value">{stats.critical}</div>
            <div className="inc-stat-label">Critical</div>
          </div>
          <div className="inc-stat-card inc-stat-orange">
            <div className="inc-stat-value">{stats.investigating}</div>
            <div className="inc-stat-label">Investigating</div>
          </div>
          <div className="inc-stat-card inc-stat-green">
            <div className="inc-stat-value">{stats.cleared}</div>
            <div className="inc-stat-label">Cleared</div>
          </div>
        </div>

        {/* ---- Source Split Bar ---- */}
        <div
          className="inc-source-splitbar-wrap"
          role="img"
          aria-label={`Incident source breakdown: ${sourceCounts.manual} manual, ${sourceCounts.fr} facial recognition, ${sourceCounts.od} object detection.`}
        >
          <div className="inc-source-splitbar">
            {filtered.length === 0 ? (
              <div className="inc-source-segment inc-source-seg-empty" style={{ width: '100%' }} />
            ) : (
              <>
                {sourceCounts.manual > 0 && (
                  <div
                    className="inc-source-segment inc-source-seg-manual"
                    style={{ width: `${(sourceCounts.manual / filtered.length) * 100}%` }}
                    tabIndex={0}
                    title={`Manual: ${sourceCounts.manual}`}
                  />
                )}
                {sourceCounts.fr > 0 && (
                  <div
                    className="inc-source-segment inc-source-seg-fr"
                    style={{ width: `${(sourceCounts.fr / filtered.length) * 100}%` }}
                    tabIndex={0}
                    title={`Facial Recognition: ${sourceCounts.fr}`}
                  />
                )}
                {sourceCounts.od > 0 && (
                  <div
                    className="inc-source-segment inc-source-seg-od"
                    style={{ width: `${(sourceCounts.od / filtered.length) * 100}%` }}
                    tabIndex={0}
                    title={`Object Detection: ${sourceCounts.od}`}
                  />
                )}
              </>
            )}
          </div>
          <div className="inc-source-legend">
            <span className="inc-source-legend-item">
              <span className="inc-source-legend-dot inc-source-legend-dot-manual" /> Manual ({sourceCounts.manual})
            </span>
            <span className="inc-source-legend-item">
              <span className="inc-source-legend-dot inc-source-legend-dot-fr" /> Facial Recognition ({sourceCounts.fr})
            </span>
            <span className="inc-source-legend-item">
              <span className="inc-source-legend-dot inc-source-legend-dot-od" /> Object Detection ({sourceCounts.od})
            </span>
          </div>
          <table className="sr-only">
            <caption>Incident source breakdown</caption>
            <thead><tr><th scope="col">Source</th><th scope="col">Count</th></tr></thead>
            <tbody>
              <tr><th scope="row">Manual</th><td>{sourceCounts.manual}</td></tr>
              <tr><th scope="row">Facial Recognition</th><td>{sourceCounts.fr}</td></tr>
              <tr><th scope="row">Object Detection</th><td>{sourceCounts.od}</td></tr>
            </tbody>
          </table>
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
            <option>False Positive</option>
          </select>
        </div>

        {/* ---- Toast Stack ----
            In-flow above the table while its top edge is visible; once scrolled
            past, the same stack floats top-right instead so status updates are
            never missed further down the list. Only one is ever rendered. */}
        {toasts.length > 0 && (
          <div className={`inc-toast-stack${tableTopVisible ? '' : ' inc-toast-stack-floating'}`}>
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
        <div className="table-container inc-table-wrap" ref={tableWrapRef}>
          <table className="management-table inc-table">
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
                    newRowIds.has(incident.id)   ? 'inc-row-new'      : '',
                    incident.id === deletingId   ? 'inc-row-deleting' : '',
                    incident.source === 'Manual' ? 'inc-row-manual'   : '',
                  ].filter(Boolean).join(' ');

                  return (
                    <tr key={incident.id} className={rowClass || undefined}>
                      <td data-label="Timestamp" style={{ fontFamily: 'monospace', color: '#cbd5e1', fontSize: '0.83rem' }}>
                        <div>{new Date(incident.createdAt).toLocaleDateString('en-SG')}</div>
                        <div>{new Date(incident.createdAt).toLocaleTimeString('en-SG')}</div>
                      </td>
                      <td data-label="Location" style={{ color: '#e2e8f0' }} title={incident.camera_location}>
                        <span style={{ whiteSpace: 'pre-line', lineHeight: '1.45', overflowWrap: 'anywhere', wordBreak: 'break-all' }}>
                          {formatLocation(incident.camera_location)}
                        </span>
                      </td>
                      <td data-label="Person">
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
                      <td data-label="Source">
                        <span className={sourceClass(incident.source)}>
                          {sourceLabel(incident.source)}
                        </span>
                      </td>
                      <td data-label="Confidence" style={{ fontFamily: 'monospace', color: '#94a3b8' }}>
                        {incident.confidence_score != null
                          ? `${(incident.confidence_score * 100).toFixed(1)}%`
                          : <em style={{ color: '#475569' }}>—</em>}
                      </td>
                      <td data-label="Severity">
                        <span className={severityClass(incident.severity)}>
                          {incident.severity}
                        </span>
                      </td>
                      <td data-label="Status">
                        <span className={statusClass(incident.resolutionStatus)}>
                          {incident.resolutionStatus}
                        </span>
                      </td>
                      <td className="actions-cell" data-label="Actions">
                        <div className="action-button-group">
                          <button
                            className="action-btn action-neutral"
                            onClick={() => openDetail(incident)}
                          >
                            View
                          </button>
                          <button
                            className="action-btn action-escalate"
                            onClick={() => handleEscalate(incident)}
                          >
                            Escalate to Ticket
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
                          severity: selectedIncident.severity || 'Medium',
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
                  <span className="inc-detail-value">{formatDetectionType(selectedIncident.status)}</span>
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
                  {editMode ? (
                    <select
                      className="inc-select"
                      value={editForm.severity}
                      onChange={(e) => setEditForm(f => ({ ...f, severity: e.target.value }))}
                      style={{ marginTop: '2px' }}
                    >
                      <option>Critical</option>
                      <option>High</option>
                      <option>Medium</option>
                      <option>Low</option>
                    </select>
                  ) : (
                    <span className={severityClass(selectedIncident.severity)} style={{ marginTop: '2px' }}>
                      {selectedIncident.severity}
                    </span>
                  )}
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
                      <option>False Positive</option>
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
                      ref={editNotesRef}
                      className="inc-notes-textarea inc-notes-textarea-autogrow"
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
                      {/* SecurePi / edge detection categories (see detectionAlertBridge.js) */}
                      <option value="PEST_DETECTION">Pest Detection</option>
                      <option value="RESTRICTED_MOTION">Restricted-Zone Motion</option>
                      <option value="FORGOTTEN_BELONGING">Forgotten Belonging</option>
                      <option value="ITEM_MOVEMENT">Item Movement</option>
                      <option value={CUSTOM_INCIDENT_TYPE}>Other / Custom...</option>
                    </select>
                    {createForm.status === CUSTOM_INCIDENT_TYPE && (
                      <div style={{ marginTop: '10px' }}>
                        <label className="inc-detail-label" htmlFor="inc-custom-status">Custom Incident Type</label>
                        <input
                          id="inc-custom-status"
                          type="text"
                          className="inc-search-input"
                          style={{ marginTop: '6px' }}
                          value={createForm.customStatus}
                          onChange={(e) => setCreateForm(f => ({ ...f, customStatus: e.target.value }))}
                          placeholder="e.g., Water Leakage"
                          maxLength={CUSTOM_TYPE_MAX_LENGTH}
                          required
                        />
                        <p style={{ color: '#64748b', fontSize: '0.75rem', margin: '6px 0 0' }}>
                          Max {CUSTOM_TYPE_MAX_LENGTH} characters.
                        </p>
                      </div>
                    )}
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
                      ref={createNotesRef}
                      className="inc-notes-textarea inc-notes-textarea-autogrow"
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

        {/* ---- Escalate to Ticket Confirm Modal ---- */}
        {escalateTarget && (
          <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Escalate incident to Support Tickets" onClick={() => { if (!escalateSaving) setEscalateTarget(null); }}>
            <div className="inc-detail-modal" onClick={(e) => e.stopPropagation()}>
              <div className="inc-modal-header">
                <div>
                  <h2>Escalate to Support Ticket?</h2>
                  <p style={{ color: '#64748b', margin: 0, fontSize: '0.85rem' }}>
                    Review the details below before escalating this incident to Support.
                  </p>
                </div>
                <button className="edit-btn" onClick={() => setEscalateTarget(null)} disabled={escalateSaving}>✕ Close</button>
              </div>

              <div className="inc-detail-grid">
                <div className="inc-detail-item">
                  <span className="inc-detail-label">Incident ID</span>
                  <span>#{escalateTarget.id}</span>
                </div>
                <div className="inc-detail-item">
                  <span className="inc-detail-label">Location</span>
                  <span>{escalateTarget.camera_location}</span>
                </div>
                <div className="inc-detail-item">
                  <span className="inc-detail-label">Source</span>
                  <span className={sourceClass(escalateTarget.source)}>{sourceLabel(escalateTarget.source)}</span>
                </div>
                <div className="inc-detail-item">
                  <span className="inc-detail-label">Severity</span>
                  <span className={severityClass(escalateTarget.severity)}>{escalateTarget.severity}</span>
                </div>
              </div>

              <div className="inc-form-group">
                <label className="inc-detail-label">Description</label>
                <p style={{ color: '#cbd5e1', lineHeight: 1.6, marginTop: '6px' }}>
                  {escalateTarget.notes?.trim() ? escalateTarget.notes : <em style={{ color: '#64748b' }}>No description provided.</em>}
                </p>
              </div>

              <p style={{ color: '#94a3b8', fontSize: '0.78rem', margin: '4px 0 20px' }}>
                Confirming creates one persisted Support Ticket. Repeated confirmation of this incident reuses the existing ticket.
              </p>

              <div className="modal-actions">
                <button className="cancel-btn" onClick={() => setEscalateTarget(null)} disabled={escalateSaving}>
                  Cancel
                </button>
                <button className="confirm-escalate-btn" onClick={confirmEscalate} disabled={escalateSaving}>
                  {escalateSaving ? 'Creating Ticket…' : 'Confirm Escalation'}
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
