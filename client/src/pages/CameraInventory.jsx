import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router';
import Sidebar from '../components/Sidebar';
import UiIcon from '../components/UiIcon';
import { ROLES } from '../constants/roles';
import {
  SECUREPI_CONNECTION_STATUS,
  testSecurePiConnection,
  validateSecurePiStreamUrl,
} from '../utils/securepiStream';
import '../css/Dashboard.css';
import '../css/Cameras.css';

const CAMERAS_URL = '/api/cameras';
const ZONES_URL = '/api/zones';
const CAMERA_STATUSES = ['Online', 'Offline', 'Maintenance', 'Disabled'];
const VIDEO_SOURCES = [
  { label: 'Loading Bay', value: '/videos/loading.mp4' },
  { label: 'Assembly Line', value: '/videos/assembly.mp4' },
  { label: 'Chemical Storage', value: '/videos/chemical_storage.mp4' },
  { label: 'Command Center', value: '/videos/command.mp4' },
  { label: 'Main Gate', value: '/videos/entrance.mp4' },
  { label: 'Packaging', value: '/videos/packaging.mp4' },
];
// Sentinel select value for a user-supplied HTTP/MJPEG stream (e.g. SecurePi on a Raspberry Pi).
const CUSTOM_SOURCE = 'custom';

const securePiTestMessage = (status) => {
  if (status === SECUREPI_CONNECTION_STATUS.CONNECTED) return 'SecurePi connected';
  if (status === SECUREPI_CONNECTION_STATUS.STALE) return 'SecurePi responding but frame is stale';
  if (status === SECUREPI_CONNECTION_STATUS.TIMEOUT) return 'SecurePi connection timed out';
  if (status === SECUREPI_CONNECTION_STATUS.PERMISSION_REQUIRED) return 'Local Network Access permission required';
  if (status === SECUREPI_CONNECTION_STATUS.INVALID_RESPONSE) return 'Invalid SecurePi response';
  if (status === SECUREPI_CONNECTION_STATUS.INVALID_URL) return 'Invalid SecurePi URL';
  return 'SecurePi unreachable from this network';
};

const emptyCamera = {
  camera_code: '',
  camera_name: '',
  location: '',
  zone_id: '',
  status: 'Online',
  stream_source: VIDEO_SOURCES[0].value,
  custom_stream_url: '',
  camera_type: '',
  notes: '',
};

const formatLastActive = (value) => {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString('en-SG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
};

export default function CameraInventory() {
  const [cameras, setCameras] = useState([]);
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [form, setForm] = useState(emptyCamera);
  const [editingId, setEditingId] = useState(null);
  const [query, setQuery] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [securePiTest, setSecurePiTest] = useState({ status: 'idle', message: '', details: null });
  const securePiTestControllerRef = useRef(null);

  const token = localStorage.getItem('accessToken');
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const canEdit = localStorage.getItem('userRole') === ROLES.FM;

  const fetchCameras = useCallback((signal) => {
    return axios.get(CAMERAS_URL, { headers, signal })
      .then((res) => {
        if (signal?.aborted) return;
        setCameras(Array.isArray(res.data) ? res.data : []);
        setOffline(false);
      })
      .catch(() => {
        if (!signal?.aborted) setOffline(true);
      })
      .finally(() => {
        if (!signal?.aborted) setLoading(false);
      });
  }, [headers]);

  const fetchZones = useCallback((signal) => {
    return axios.get(ZONES_URL, { headers, signal })
      .then((res) => {
        if (!signal?.aborted) setZones(Array.isArray(res.data) ? res.data : []);
      })
      .catch(() => {
        if (!signal?.aborted) setZones([]);
      });
  }, [headers]);

  useEffect(() => {
    const controller = new AbortController();
    const loadInventory = async () => {
      await Promise.all([fetchCameras(controller.signal), fetchZones(controller.signal)]);
    };

    void loadInventory();
    return () => {
      controller.abort();
      securePiTestControllerRef.current?.abort();
    };
  }, [fetchCameras, fetchZones]);

  const resetSecurePiTest = () => {
    securePiTestControllerRef.current?.abort();
    securePiTestControllerRef.current = null;
    setSecurePiTest({ status: 'idle', message: '', details: null });
  };

  const filteredCameras = useMemo(() => (
    cameras.filter((cam) => (
      `${cam.camera_code} ${cam.camera_name} ${cam.location} ${cam.status}`.toLowerCase().includes(query.toLowerCase())
    ))
  ), [cameras, query]);

  const inventoryStats = useMemo(() => ({
    total: cameras.length,
    live: cameras.filter((cam) => cam.status === 'Online').length,
    attention: cameras.filter((cam) => ['Maintenance', 'Offline'].includes(cam.status)).length,
  }), [cameras]);

  const startCreate = () => {
    resetSecurePiTest();
    const nextNumber = String(cameras.length + 1).padStart(2, '0');
    setForm({ ...emptyCamera, camera_code: `CAM-${nextNumber}` });
    setEditingId(null);
    setFormError('');
    setConfirmDeleteId(null);
    setAdvancedOpen(false);
  };

  const startEdit = (cam) => {
    resetSecurePiTest();
    const isPreset = VIDEO_SOURCES.some((source) => source.value === cam.stream_url);
    setForm({
      camera_code: cam.camera_code,
      camera_name: cam.camera_name,
      location: cam.location,
      zone_id: cam.zone_id || '',
      status: cam.status,
      stream_source: isPreset || !cam.stream_url ? (cam.stream_url || VIDEO_SOURCES[0].value) : CUSTOM_SOURCE,
      custom_stream_url: isPreset || !cam.stream_url ? '' : cam.stream_url,
      camera_type: cam.camera_type || '',
      notes: cam.notes || '',
    });
    setEditingId(cam.id);
    setFormError('');
    setConfirmDeleteId(null);
    setAdvancedOpen(false);
  };

  const resetForm = () => {
    resetSecurePiTest();
    setForm(emptyCamera);
    setEditingId(null);
    setFormError('');
    setAdvancedOpen(false);
  };

  const saveCamera = async (event) => {
    event.preventDefault();
    if (!form.camera_code.trim() || !form.camera_name.trim() || !form.location.trim()) {
      setFormError('Camera code, name, and location are required.');
      return;
    }
    const isCustomSource = form.stream_source === CUSTOM_SOURCE;
    const streamValidation = isCustomSource ? validateSecurePiStreamUrl(form.custom_stream_url) : null;
    if (streamValidation && !streamValidation.valid) {
      setFormError(streamValidation.error);
      return;
    }

    const payload = {
      camera_code: form.camera_code.trim().toUpperCase(),
      camera_name: form.camera_name.trim(),
      location: form.location.trim(),
      zone_id: form.zone_id || null,
      status: form.status,
      stream_url: isCustomSource ? streamValidation.normalized : form.stream_source,
      camera_type: form.camera_type.trim() || null,
      notes: form.notes.trim() || null,
    };

    setSaving(true);
    setFormError('');
    try {
      if (editingId) {
        await axios.put(`${CAMERAS_URL}/${editingId}`, payload, { headers });
      } else {
        await axios.post(CAMERAS_URL, payload, { headers });
      }
      resetForm();
      fetchCameras();
    } catch (err) {
      if (!err.response) {
        setOffline(true);
        setFormError('Could not reach the server. Check that the Node.js backend is running.');
      } else {
        setFormError(err.response.data?.error || 'Failed to save camera.');
      }
    } finally {
      setSaving(false);
    }
  };

  const testSecurePi = async () => {
    resetSecurePiTest();
    const validation = validateSecurePiStreamUrl(form.custom_stream_url);
    if (!validation.valid) {
      setSecurePiTest({ status: SECUREPI_CONNECTION_STATUS.INVALID_URL, message: 'Invalid SecurePi URL', details: null });
      setFormError(validation.error);
      return;
    }

    setFormError('');
    const controller = new AbortController();
    securePiTestControllerRef.current = controller;
    setSecurePiTest({ status: 'testing', message: 'Testing SecurePi…', details: null });
    const result = await testSecurePiConnection({
      streamUrl: validation.normalized,
      timeoutMs: 3500,
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;
    securePiTestControllerRef.current = null;
    setSecurePiTest({
      status: result.status,
      message: securePiTestMessage(result.status),
      details: result.ok ? result.details : null,
    });
  };

  const deleteCamera = async (id) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      return;
    }
    try {
      await axios.delete(`${CAMERAS_URL}/${id}`, { headers });
      if (editingId === id) resetForm();
      fetchCameras();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to deactivate camera.');
    } finally {
      setConfirmDeleteId(null);
    }
  };

  const zoneName = (zoneId) => zones.find((zone) => zone.id === zoneId)?.zone_name || 'Unassigned';

  return (
    <div className="dashboard-layout">
      <Sidebar />
      <main className="dashboard-main cameras-main">
        <header className="dashboard-header cameras-header">
          <div className="header-titles">
            <h1>Camera Inventory</h1>
            <p>Maintain camera locations, stream sources, and operational metadata away from the live wall.</p>
          </div>
          <div className="camera-header-actions">
            <Link className="camera-secondary-link" to="/cameras">
              <UiIcon name="arrowBack" />
              Live Wall
            </Link>
            {canEdit && (
              <button className="camera-primary-btn" onClick={startCreate} type="button">
                <UiIcon name="add" />
                Add Camera
              </button>
            )}
          </div>
        </header>

        {offline && (
          <div className="camera-system-banner">
            Node.js server offline - camera inventory is unavailable right now.
          </div>
        )}
        {!canEdit && (
          <div className="camera-system-banner" style={{ background: 'rgba(59,130,246,0.08)', borderColor: 'rgba(59,130,246,0.3)', color: '#93c5fd' }}>
            You have view-only access to Camera Inventory. Contact a Facilities Manager to add, edit, or deactivate cameras.
          </div>
        )}

        <section className="camera-inventory-summary" aria-label="Camera inventory summary">
          <div>
            <UiIcon name="camera" />
            <span>Total Cameras</span>
            <strong>{inventoryStats.total}</strong>
          </div>
          <div className="healthy">
            <UiIcon name="check" />
            <span>Online</span>
            <strong>{inventoryStats.live}</strong>
          </div>
          <div className="attention">
            <UiIcon name="warning" />
            <span>Need Attention</span>
            <strong>{inventoryStats.attention}</strong>
          </div>
        </section>

        <section className="camera-admin-layout">
          <div className="camera-inventory-list">
            <div className="camera-section-title">
              <div>
                <h2>Camera Register</h2>
                <p>{filteredCameras.length} cameras visible - camera CRUD only.</p>
              </div>
              <label className="camera-search compact">
                <UiIcon name="search" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search inventory..." />
              </label>
            </div>

            <div className="camera-table">
              {loading && <p className="camera-loading-state">Loading camera inventory...</p>}

              {!loading && filteredCameras.map((cam) => (
                <article
                  key={cam.id}
                  className={`camera-row-card${cam.id === editingId ? ' editing' : ''}`}
                >
                  <div className="camera-row-main">
                    <span className="camera-row-icon">
                      <UiIcon name="camera" />
                    </span>
                    <div>
                      <h3>{cam.camera_code} - {cam.camera_name}</h3>
                      <p>{cam.location} - {zoneName(cam.zone_id)}</p>
                    </div>
                  </div>
                  <div className="camera-row-meta">
                    <span className={`camera-status-pill ${cam.status.toLowerCase()}`}>{cam.status}</span>
                    <span>{cam.camera_type || 'Unspecified type'}</span>
                    <span>Last active {formatLastActive(cam.last_active_at)}</span>
                  </div>
                  {canEdit && (
                    <div className="camera-row-actions">
                      <button type="button" onClick={() => startEdit(cam)} aria-label={`Edit ${cam.camera_code}`}>
                        <UiIcon name="edit" />
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => deleteCamera(cam.id)}
                        aria-label={`Delete ${cam.camera_code}`}
                        title={confirmDeleteId === cam.id ? 'Click again to confirm deactivation' : 'Deactivate camera'}
                      >
                        <UiIcon name={confirmDeleteId === cam.id ? 'warning' : 'delete'} />
                      </button>
                    </div>
                  )}
                </article>
              ))}
              {!loading && filteredCameras.length === 0 && cameras.length > 0 && (
                <p className="camera-empty">No cameras match "{query}".</p>
              )}
              {!loading && cameras.length === 0 && !offline && (
                <p className="camera-empty">No cameras in inventory yet. {canEdit ? 'Add your first camera to get started.' : 'Ask a Facilities Manager to add one.'}</p>
              )}
            </div>
          </div>

          {canEdit && (
            <form className={`camera-crud-card camera-admin-form${editingId ? ' editing' : ''}`} onSubmit={saveCamera}>
              <div className="camera-panel-heading">
                <div>
                  <span className="camera-kicker">Inventory Form</span>
                  <h2>{editingId ? 'Update Camera' : 'Create Camera'}</h2>
                </div>
                <button type="button" className="camera-icon-btn" onClick={resetForm} aria-label="Clear camera form">
                  <UiIcon name="close" />
                </button>
              </div>
              <div className="camera-form-grid">
                <label>Camera Code<input value={form.camera_code} onChange={(event) => setForm((prev) => ({ ...prev, camera_code: event.target.value }))} placeholder="CAM-07" /></label>
                <label className="wide">Camera Name<input value={form.camera_name} onChange={(event) => setForm((prev) => ({ ...prev, camera_name: event.target.value }))} placeholder="Dispatch Bay East" /></label>
                <label className="wide">Location<input value={form.location} onChange={(event) => setForm((prev) => ({ ...prev, location: event.target.value }))} placeholder="Zone G - Dispatch" /></label>
                <label>Assigned Zone<select value={form.zone_id} onChange={(event) => setForm((prev) => ({ ...prev, zone_id: event.target.value }))}><option value="">Unassigned</option>{zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.zone_name}</option>)}</select></label>
                <label>Status<select value={form.status} onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}>{CAMERA_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label>
                <label>Video Source<select value={form.stream_source} onChange={(event) => { resetSecurePiTest(); setForm((prev) => ({ ...prev, stream_source: event.target.value })); }}>{VIDEO_SOURCES.map((source) => <option key={source.value} value={source.value}>{source.label}</option>)}<option value={CUSTOM_SOURCE}>Custom hardware/MJPEG URL</option></select></label>
                {form.stream_source === CUSTOM_SOURCE && (
                  <div className="camera-securepi-test wide">
                    <label>Stream URL<input value={form.custom_stream_url} onChange={(event) => { resetSecurePiTest(); setForm((prev) => ({ ...prev, custom_stream_url: event.target.value })); }} placeholder="http://securepi.local:8001/video_feed" /></label>
                    <button
                      type="button"
                      className="camera-secondary-btn"
                      disabled={securePiTest.status === 'testing'}
                      onClick={() => { void testSecurePi(); }}
                    >
                      {securePiTest.status === 'testing' ? 'Testing SecurePi…' : 'Test SecurePi Connection'}
                    </button>
                    {securePiTest.message && (
                      <div className={`camera-securepi-result ${securePiTest.status}`} role="status">
                        <strong>{securePiTest.message}</strong>
                        {securePiTest.status === SECUREPI_CONNECTION_STATUS.PERMISSION_REQUIRED && (
                          <span>Allow Local Network Access for this FlowGuard site, then try again.</span>
                        )}
                        {[SECUREPI_CONNECTION_STATUS.UNREACHABLE, SECUREPI_CONNECTION_STATUS.TIMEOUT].includes(securePiTest.status) && (
                          <span>Local device not reachable from this network. Confirm this computer and the Raspberry Pi are on the same hotspot or LAN.</span>
                        )}
                        {securePiTest.details && (
                          <div className="camera-securepi-detail-grid">
                            {securePiTest.details.cameraDescription && <span>Camera: <strong>{securePiTest.details.cameraDescription}</strong></span>}
                            {securePiTest.details.deviceId && <span>Device ID <strong>{securePiTest.details.deviceId}</strong></span>}
                            {securePiTest.details.zone && <span>Zone <strong>{securePiTest.details.zone}</strong></span>}
                            <span>Streaming: <strong>{securePiTest.details.streaming === true ? 'Active' : securePiTest.details.streaming === false ? 'Unavailable' : 'Not reported'}</strong></span>
                            <span>Detection <strong>{securePiTest.details.detectionActive ? 'Active' : 'Standby'}</strong></span>
                            <span>People count: <strong>{securePiTest.details.visiblePeople === null ? 'Not provided by this SecurePi service' : securePiTest.details.visiblePeople}</strong></span>
                            {securePiTest.details.frameAgeSeconds !== null && <span>Frame age <strong>{securePiTest.details.frameAgeSeconds}s</strong></span>}
                            <span>Resolved port <strong>{securePiTest.details.resolvedPort}</strong></span>
                          </div>
                        )}
                        <small>This confirms only that the local HTTP service is reachable; it does not validate the model or detection accuracy.</small>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <details className="camera-advanced-details" open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}>
                <summary>Advanced details</summary>
                <div className="camera-form-grid">
                  <label>Camera Type<input value={form.camera_type} onChange={(event) => setForm((prev) => ({ ...prev, camera_type: event.target.value }))} placeholder="Fixed / PTZ / Dome" /></label>
                  <label className="wide">Notes<input value={form.notes} onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))} placeholder="Optional maintenance or install notes" /></label>
                </div>
              </details>
              <p className={`camera-form-error${formError ? '' : ' is-empty'}`}>{formError || ' '}</p>
              <button className="camera-primary-btn full" type="submit" disabled={saving}>
                <UiIcon name="check" />
                {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Create Camera'}
              </button>
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
