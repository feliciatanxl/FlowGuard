import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import Sidebar from '../components/Sidebar';
import '../css/Dashboard.css';
import '../css/ObjectDetection.css';

const ZONES_URL = '/api/zones';
const ALERTS_URL = '/api/detection-alerts';
const PEOPLE_URL = '/ai/api/yolo/people-count';
const STREAM_URL = '/ai/api/yolo/stream';

const emptyForm = { zone_name: '', location: '', time_threshold: '' };

const ObjectDetection = () => {
  const [zones, setZones] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [peopleCount, setPeopleCount] = useState(0);
  const [detectionActive, setDetectionActive] = useState(false);

  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState(emptyForm);

  const [streamError, setStreamError] = useState(false);
  const [aiOffline, setAiOffline] = useState(false);
  const [nodeOffline, setNodeOffline] = useState(false);

  const token = localStorage.getItem('accessToken');
  const headers = { Authorization: `Bearer ${token}` };

  // ---- Data fetching ----

  const fetchZones = useCallback(() => {
    axios.get(ZONES_URL, { headers })
      .then(res => { setZones(res.data); setNodeOffline(false); })
      .catch(() => setNodeOffline(true));
  }, []);

  const fetchAlerts = useCallback(() => {
    axios.get(ALERTS_URL, { headers })
      .then(res => { setAlerts(res.data); setNodeOffline(false); })
      .catch(() => setNodeOffline(true));
  }, []);

  const fetchPeopleCount = useCallback(() => {
    axios.get(PEOPLE_URL, { timeout: 3000 })
      .then(res => {
        setPeopleCount(res.data.count ?? 0);
        setDetectionActive(res.data.detection_active ?? false);
        setAiOffline(false);
      })
      .catch(() => {
        setPeopleCount(0);
        setDetectionActive(false);
        setAiOffline(true);
      });
  }, []);

  useEffect(() => {
    fetchZones();
    fetchAlerts();
    fetchPeopleCount();

    // 5s people-count poll — reduced from 2s to cut ECONNREFUSED noise when AI is down
    const peopleInterval = setInterval(fetchPeopleCount, 5000);
    const alertsInterval = setInterval(fetchAlerts, 15000);

    return () => {
      clearInterval(peopleInterval);
      clearInterval(alertsInterval);
    };
  }, []);

  // ---- Zone CRUD ----

  const handleCreateZone = async (e) => {
    e.preventDefault();
    setFormError('');
    const { zone_name, location, time_threshold } = form;
    if (!zone_name.trim() || !location.trim() || !time_threshold) {
      setFormError('All fields are required.');
      return;
    }
    if (parseInt(time_threshold) < 1) {
      setFormError('Threshold must be at least 1 minute.');
      return;
    }
    setSubmitting(true);
    try {
      await axios.post(ZONES_URL, {
        zone_name: zone_name.trim(),
        location: location.trim(),
        time_threshold: parseInt(time_threshold)
      }, { headers });
      setForm(emptyForm);
      fetchZones();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to create zone.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteZone = async (id) => {
    try {
      await axios.delete(`${ZONES_URL}/${id}`, { headers });
      setZones(prev => prev.filter(z => z.id !== id));
      if (editId === id) setEditId(null);
    } catch (err) {
      console.error('Delete zone error:', err);
    }
  };

  const startEdit = (zone) => {
    setEditId(zone.id);
    setEditForm({
      zone_name: zone.zone_name,
      location: zone.location,
      time_threshold: String(zone.time_threshold)
    });
  };

  const handleUpdateZone = async (id) => {
    try {
      const res = await axios.put(`${ZONES_URL}/${id}`, {
        zone_name: editForm.zone_name.trim(),
        location: editForm.location.trim(),
        time_threshold: parseInt(editForm.time_threshold)
      }, { headers });
      setZones(prev => prev.map(z => z.id === id ? res.data : z));
      setEditId(null);
    } catch (err) {
      console.error('Update zone error:', err);
    }
  };

  // ---- Alert management ----

  const handleClearAlert = async (id) => {
    try {
      const res = await axios.put(`${ALERTS_URL}/${id}`, { status: 'Cleared' }, { headers });
      setAlerts(prev => prev.map(a => a.id === id ? res.data : a));
    } catch (err) {
      console.error('Clear alert error:', err);
    }
  };

  // ---- Derived counts ----
  const activeAlertCount = alerts.filter(a => a.status === 'Active').length;

  // ---- Render ----

  return (
    <div className="dashboard-layout">
      <Sidebar />
      <main className="dashboard-main">
        <header className="dashboard-header">
          <div className="header-titles">
            <h1>Object Detection &amp; Space Management</h1>
            <p>Live YOLO feed, zone configuration, and unattended item alerts</p>
          </div>
          <div
            className="od-people-badge"
            style={{ fontSize: '0.95rem', padding: '8px 18px' }}
          >
            <span className="od-people-dot" />
            {peopleCount} {peopleCount === 1 ? 'Person' : 'People'} Detected
          </div>
        </header>

        {nodeOffline && (
          <div style={{
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: '10px', padding: '10px 16px', marginBottom: '14px',
            color: '#f87171', fontSize: '0.8rem', fontFamily: 'monospace'
          }}>
            Node.js server offline — run <strong>node index.js</strong> in /server (port 5001)
          </div>
        )}
        {aiOffline && (
          <div style={{
            background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
            borderRadius: '10px', padding: '10px 16px', marginBottom: '14px',
            color: '#fbbf24', fontSize: '0.8rem', fontFamily: 'monospace'
          }}>
            Python AI service offline — run <strong>uvicorn main:app --host 0.0.0.0 --port 8500 --reload</strong> in /ai-service
          </div>
        )}

        <div className="od-grid">

          {/* ---- Live Stream ---- */}
          <div className="od-stream-card">
            <div className="od-stream-header">
              <h2>Live Camera Feed</h2>
              <span style={{
                fontSize: '0.7rem',
                fontFamily: 'monospace',
                color: detectionActive ? '#34d399' : '#f59e0b',
                fontWeight: 700
              }}>
                {detectionActive ? '● YOLO ACTIVE' : '○ YOLO STANDBY'}
              </span>
            </div>

            {streamError ? (
              <div className="od-stream-placeholder">
                Python AI service offline — start ai-service to enable stream
              </div>
            ) : (
              <img
                src={STREAM_URL}
                alt="Live YOLO annotated feed"
                className="od-stream-img"
                onError={() => setStreamError(true)}
              />
            )}
          </div>

          {/* ---- Right column: Zones + Alerts ---- */}
          <div className="od-right-column">

            {/* Zones card */}
            <div className="od-card">
              <h2>Monitoring Zones</h2>

              {/* Create form */}
              <form className="od-form" onSubmit={handleCreateZone}>
                <input
                  className="od-input"
                  placeholder="Zone name (e.g. Prep Area A)"
                  value={form.zone_name}
                  onChange={e => setForm(p => ({ ...p, zone_name: e.target.value }))}
                />
                <input
                  className="od-input"
                  placeholder="Location (e.g. Floor 2, East Wing)"
                  value={form.location}
                  onChange={e => setForm(p => ({ ...p, location: e.target.value }))}
                />
                <input
                  className="od-input"
                  type="number"
                  min="1"
                  placeholder="Time threshold (minutes)"
                  value={form.time_threshold}
                  onChange={e => setForm(p => ({ ...p, time_threshold: e.target.value }))}
                />
                {formError && (
                  <p style={{ color: '#f87171', fontSize: '0.75rem', margin: 0 }}>{formError}</p>
                )}
                <button className="od-btn-primary" type="submit" disabled={submitting}>
                  {submitting ? 'Creating...' : '+ Add Zone'}
                </button>
              </form>

              <div className="od-zone-list">
                {zones.length === 0 && (
                  <p className="od-empty">No zones configured yet.</p>
                )}

                {zones.map(zone => (
                  <div key={zone.id}>
                    {editId === zone.id ? (
                      <div className="od-edit-form">
                        <input
                          className="od-input"
                          value={editForm.zone_name}
                          onChange={e => setEditForm(p => ({ ...p, zone_name: e.target.value }))}
                        />
                        <div className="od-edit-form-row">
                          <input
                            className="od-input"
                            value={editForm.location}
                            onChange={e => setEditForm(p => ({ ...p, location: e.target.value }))}
                          />
                          <input
                            className="od-input"
                            type="number"
                            min="1"
                            style={{ width: '80px' }}
                            value={editForm.time_threshold}
                            onChange={e => setEditForm(p => ({ ...p, time_threshold: e.target.value }))}
                          />
                        </div>
                        <div className="od-edit-actions">
                          <button className="od-btn-save" onClick={() => handleUpdateZone(zone.id)}>
                            Save
                          </button>
                          <button className="od-btn-cancel" onClick={() => setEditId(null)}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="od-zone-item">
                        <div className="od-zone-top">
                          <span className="od-zone-name">{zone.zone_name}</span>
                          <div className="od-zone-actions">
                            <button
                              className="od-btn-icon"
                              onClick={() => startEdit(zone)}
                            >
                              Edit
                            </button>
                            <button
                              className="od-btn-icon danger"
                              onClick={() => handleDeleteZone(zone.id)}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                        <p className="od-zone-meta">
                          {zone.location} &mdash; threshold: <span>{zone.time_threshold} min</span>
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Alerts card */}
            <div className="od-alerts-card">
              <div className="od-alerts-header">
                <h2>Unattended Item Alerts</h2>
                <span className={`od-alert-count ${activeAlertCount === 0 ? 'none' : ''}`}>
                  {activeAlertCount === 0 ? 'ALL CLEAR' : `${activeAlertCount} ACTIVE`}
                </span>
              </div>

              <div className="od-alert-list">
                {alerts.length === 0 && (
                  <p className="od-empty">No alerts recorded.</p>
                )}

                {alerts.map(alert => (
                  <div
                    key={alert.id}
                    className={`od-alert-item ${alert.status === 'Cleared' ? 'cleared' : ''}`}
                  >
                    <div className="od-alert-top">
                      <span className="od-alert-class">
                        {alert.object_class || 'Unknown Object'}
                      </span>
                      <span className="od-alert-status-badge">{alert.status}</span>
                    </div>
                    <p className="od-alert-meta">
                      Zone: <span>{alert.zone_name}</span><br />
                      Camera: <span>{alert.camera_location}</span><br />
                      {alert.duration_seconds != null && (
                        <>Unattended: <span>{alert.duration_seconds}s</span><br /></>
                      )}
                      <span style={{ color: '#4b5563' }}>
                        {new Date(alert.createdAt).toLocaleString('en-SG', {
                          day: '2-digit', month: 'short',
                          hour: '2-digit', minute: '2-digit', hour12: true
                        })}
                      </span>
                    </p>
                    {alert.status === 'Active' && (
                      <button
                        className="od-btn-clear"
                        onClick={() => handleClearAlert(alert.id)}
                      >
                        Mark as Cleared
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ---- Stat strip under stream ---- */}
          <div className="od-stream-bottom">
            <div className="od-stat">
              <div className="od-stat-icon cyan">👁</div>
              <div className="od-stat-info">
                <h3>{peopleCount}</h3>
                <p>People in Frame</p>
              </div>
            </div>
            <div className="od-stat">
              <div className="od-stat-icon orange">📍</div>
              <div className="od-stat-info">
                <h3>{zones.length}</h3>
                <p>Active Zones</p>
              </div>
            </div>
            <div className="od-stat">
              <div className="od-stat-icon red">🚨</div>
              <div className="od-stat-info">
                <h3>{activeAlertCount}</h3>
                <p>Open Alerts</p>
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
};

export default ObjectDetection;
