import React, { useState, useMemo } from 'react';
import Sidebar from '../components/Sidebar';
import '../css/Dashboard.css';
import '../css/Management.css';
import '../css/Users.css';
import '../css/IncidentDashboard.css';

// ---------------------------------------------------------------------------
// Static test data — local state only, no API calls.
// Timestamps are computed once at module load; a page refresh restores all rows.
// ---------------------------------------------------------------------------
const T = (hoursAgo) =>
  new Date(Date.now() - hoursAgo * 3_600_000).toISOString();

const STATIC_INCIDENTS = [
  {
    id: 1,
    camera_location: 'Gate A – Main Entrance',
    person_name: null,
    confidence_score: null,
    status: 'UNAUTHORIZED_ACCESS',
    source: 'Facial Recognition',
    severity: 'Critical',
    resolutionStatus: 'Active',
    notes: '',
    createdAt: T(0.4),
  },
  {
    id: 2,
    camera_location: 'Loading Bay 3',
    person_name: null,
    confidence_score: null,
    status: 'UNATTENDED_OBJECT',
    source: 'Object Detection',
    severity: 'High',
    resolutionStatus: 'Investigating',
    notes: 'Unattended pallet detected for over 45 minutes. Staff dispatched to verify.',
    createdAt: T(1.2),
  },
  {
    id: 3,
    camera_location: 'Sector B – Cold Storage',
    person_name: 'Ahmad Faris',
    confidence_score: 0.9234,
    status: 'TAILGATING',
    source: 'Facial Recognition',
    severity: 'Critical',
    resolutionStatus: 'Escalated to Security',
    notes: 'Ahmad Faris followed an authorised worker through a secured door without badging in. Incident escalated to security team.',
    createdAt: T(2.5),
  },
  {
    id: 4,
    camera_location: 'Roof Stairwell',
    person_name: null,
    confidence_score: null,
    status: 'UNAUTHORIZED_ACCESS',
    source: 'Object Detection',
    severity: 'High',
    resolutionStatus: 'Active',
    notes: '',
    createdAt: T(3.8),
  },
  {
    id: 5,
    camera_location: 'Server Room Corridor',
    person_name: 'Priya Menon',
    confidence_score: 0.8812,
    status: 'UNAUTHORIZED_ACCESS',
    source: 'Facial Recognition',
    severity: 'Critical',
    resolutionStatus: 'Investigating',
    notes: '',
    createdAt: T(5.1),
  },
  {
    id: 6,
    camera_location: 'Loading Bay 1',
    person_name: null,
    confidence_score: null,
    status: 'UNATTENDED_OBJECT',
    source: 'Object Detection',
    severity: 'Medium',
    resolutionStatus: 'Cleared',
    notes: 'Pallet successfully relocated to Bay 2 by staff. Confirmed false alarm.',
    createdAt: T(7.3),
  },
  {
    id: 7,
    camera_location: 'Gate B – Staff Entrance',
    person_name: 'Jason Toh',
    confidence_score: 0.7621,
    status: 'AUTHORIZED_ACCESS',
    source: 'Facial Recognition',
    severity: 'Low',
    resolutionStatus: 'Cleared',
    notes: 'Low-confidence match flagged for manual review. Physically verified by on-site guard — authorised personnel confirmed.',
    createdAt: T(9.0),
  },
  {
    id: 8,
    camera_location: 'Sector C – Packaging',
    person_name: null,
    confidence_score: null,
    status: 'OVERCROWDING',
    source: 'Object Detection',
    severity: 'Medium',
    resolutionStatus: 'Cleared',
    notes: 'Zone headcount exceeded threshold. Supervisor redistributed staff across bays.',
    createdAt: T(12.4),
  },
  {
    id: 9,
    camera_location: 'Gate A – Main Entrance',
    person_name: 'Li Wei',
    confidence_score: 0.9712,
    status: 'TAILGATING',
    source: 'Facial Recognition',
    severity: 'High',
    resolutionStatus: 'Escalated to Security',
    notes: 'Second tailgating incident involving same individual within 24 hours. Security notified.',
    createdAt: T(15.6),
  },
  {
    id: 10,
    camera_location: 'Loading Bay 2',
    person_name: null,
    confidence_score: null,
    status: 'UNATTENDED_OBJECT',
    source: 'Object Detection',
    severity: 'Low',
    resolutionStatus: 'Investigating',
    notes: '',
    createdAt: T(20.1),
  },
  {
    id: 11,
    camera_location: 'Sector A – Freezer',
    person_name: 'Nur Hidayah',
    confidence_score: 0.8443,
    status: 'UNAUTHORIZED_ACCESS',
    source: 'Facial Recognition',
    severity: 'Critical',
    resolutionStatus: 'Active',
    notes: '',
    createdAt: T(30.5),
  },
  {
    id: 12,
    camera_location: 'Roof Stairwell',
    person_name: null,
    confidence_score: null,
    status: 'LOITERING',
    source: 'Object Detection',
    severity: 'Medium',
    resolutionStatus: 'Cleared',
    notes: 'Maintenance crew identified on site. FM confirmed authorised access.',
    createdAt: T(45.2),
  },
];

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

const sourceClass = (s) =>
  s === 'Facial Recognition' ? 'inc-badge inc-source-fr' : 'inc-badge inc-source-od';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
const IncidentDashboard = () => {
  const [incidents, setIncidents]           = useState(STATIC_INCIDENTS);
  const [search, setSearch]                 = useState('');
  const [severityFilter, setSeverityFilter] = useState('All');
  const [sourceFilter, setSourceFilter]     = useState('All');
  const [statusFilter, setStatusFilter]     = useState('All');
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [toast, setToast]                   = useState('');

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  };

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
    total:        filtered.length,
    critical:     filtered.filter((i) => i.severity === 'Critical' && i.resolutionStatus === 'Active').length,
    investigating: filtered.filter((i) => ['Investigating', 'Escalated to Security'].includes(i.resolutionStatus)).length,
    cleared:      filtered.filter((i) => i.resolutionStatus === 'Cleared').length,
  }), [filtered]);

  const handleDelete = (id) => {
    setIncidents((prev) => prev.filter((i) => i.id !== id));
    if (selectedIncident?.id === id) setSelectedIncident(null);
    showToast(`Incident #${id} removed from view.`);
  };

  return (
    <div className="dashboard-layout">
      <Sidebar />

      <main className="dashboard-main">
        {/* ---- Header ---- */}
        <header className="dashboard-header">
          <div className="header-titles">
            <h1>Incident Command Center</h1>
            <p style={{ color: '#94a3b8', marginTop: '4px' }}>
              AI-generated and manually logged security incidents
            </p>
          </div>
        </header>

        {/* ---- Toast ---- */}
        {toast && (
          <div className="users-toast">{toast}</div>
        )}

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
            aria-label="Filter by AI source"
          >
            <option value="All">All Sources</option>
            <option>Facial Recognition</option>
            <option>Object Detection</option>
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

        {/* ---- Incidents Table ---- */}
        <div className="table-container">
          <table className="management-table">
            <thead>
              <tr>
                <th>TIMESTAMP</th>
                <th>LOCATION</th>
                <th>PERSON</th>
                <th>AI SOURCE</th>
                <th>CONFIDENCE</th>
                <th>SEVERITY</th>
                <th>STATUS</th>
                <th style={{ textAlign: 'center' }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan="8" style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
                    No incidents match the current filters.
                  </td>
                </tr>
              ) : (
                filtered.map((incident) => (
                  <tr key={incident.id}>
                    <td style={{ fontFamily: 'monospace', color: '#cbd5e1', fontSize: '0.83rem' }}>
                      {new Date(incident.createdAt).toLocaleString('en-SG')}
                    </td>
                    <td style={{ color: '#e2e8f0' }}>{incident.camera_location}</td>
                    <td>
                      {incident.person_name ? (
                        <div className="inc-person-cell">
                          <div className="inc-person-initial">
                            {incident.person_name[0].toUpperCase()}
                          </div>
                          <span>{incident.person_name}</span>
                        </div>
                      ) : (
                        <em style={{ color: '#64748b' }}>Unknown</em>
                      )}
                    </td>
                    <td>
                      <span className={sourceClass(incident.source)}>
                        {incident.source === 'Facial Recognition' ? 'Face ID' : 'Object Det.'}
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
                          onClick={() => setSelectedIncident(incident)}
                        >
                          View
                        </button>
                        <button
                          className="action-btn action-danger"
                          onClick={() => handleDelete(incident.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* ---- Detail Modal ---- */}
        {selectedIncident && (
          <div className="modal-overlay" onClick={() => setSelectedIncident(null)}>
            <div className="inc-detail-modal" onClick={(e) => e.stopPropagation()}>
              <div className="inc-modal-header">
                <div>
                  <h2>Incident Report</h2>
                  <p style={{ color: '#64748b', margin: 0, fontSize: '0.85rem' }}>
                    ID #{selectedIncident.id}
                  </p>
                </div>
                <button className="edit-btn" onClick={() => setSelectedIncident(null)}>
                  ✕ Close
                </button>
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
                  <span className="inc-detail-label">AI Source</span>
                  <span className={sourceClass(selectedIncident.source)} style={{ marginTop: '2px' }}>
                    {selectedIncident.source}
                  </span>
                </div>
                <div className="inc-detail-item">
                  <span className="inc-detail-label">AI Detection Type</span>
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
                  <span className={statusClass(selectedIncident.resolutionStatus)} style={{ marginTop: '2px' }}>
                    {selectedIncident.resolutionStatus}
                  </span>
                </div>
              </div>

              <div className="inc-notes-section">
                <span className="inc-detail-label">Resolution Notes</span>
                <div className="inc-notes-box">
                  {selectedIncident.notes
                    ? selectedIncident.notes
                    : <em style={{ color: '#475569' }}>No resolution notes recorded.</em>}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default IncidentDashboard;
