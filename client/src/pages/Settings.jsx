import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import axios from 'axios';
import Sidebar from '../components/Sidebar';
import '../css/Dashboard.css';
import '../css/Settings.css';
import { API_BASE_URL } from '../constants/api';
import {
  PI_CONFIG_SOURCE,
  PI_CONNECTION_STATUS,
  clearRuntimePiCameraBaseUrl,
  getResolvedPiCameraConfig,
  readRuntimePiCameraBaseUrl,
  saveRuntimePiCameraBaseUrl,
  subscribeToPiCameraConfig,
  testPiCameraConnection,
  validatePiCameraBaseUrl,
} from '../constants/piCamera';

const PI_STATUS_LABELS = Object.freeze({
  idle: 'Not tested',
  testing: 'Testing',
  [PI_CONNECTION_STATUS.SUCCESS]: 'Connected',
  [PI_CONNECTION_STATUS.UNREACHABLE]: 'Unreachable',
  [PI_CONNECTION_STATUS.PERMISSION_REQUIRED]: 'Permission Required',
  [PI_CONNECTION_STATUS.INVALID_URL]: 'Invalid URL',
  [PI_CONNECTION_STATUS.UNEXPECTED_RESPONSE]: 'Unreachable',
  [PI_CONNECTION_STATUS.NOT_CONFIGURED]: 'Unreachable',
  [PI_CONNECTION_STATUS.DISABLED]: 'Unreachable',
  [PI_CONNECTION_STATUS.ABORTED]: 'Not tested',
});

const PI_SOURCE_LABELS = Object.freeze({
  [PI_CONFIG_SOURCE.RUNTIME]: 'Runtime',
  [PI_CONFIG_SOURCE.ENVIRONMENT]: 'Environment',
  [PI_CONFIG_SOURCE.NONE]: 'Not configured',
});

// Display-only example. Keeping the hotspot octets separate prevents this
// transient demo address from looking like an active bundled Pi endpoint.
const PI_CAMERA_URL_PLACEHOLDER = Object.freeze(['http://172', '20', '10', '4:8081']).join('.');

const Settings = () => {
  const navigate = useNavigate();
  const [alertsEnabled, setAlertsEnabled] = useState(true);
  const currentUserId = localStorage.getItem("userId");
  const currentUserName = localStorage.getItem("userName");
  const role = localStorage.getItem("userRole");
  const isFM = role === 'FM';

  // Change Password (all authenticated users)
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMessage, setPasswordMessage] = useState(null); // { type: 'error'|'success', text }
  const [changingPassword, setChangingPassword] = useState(false);

  // Runtime Pi configuration is browser-local and contains only a normalized
  // base URL. It is intentionally independent from account/auth storage.
  const initialPiConfig = getResolvedPiCameraConfig();
  const runtimePiConfig = readRuntimePiCameraBaseUrl();
  const [piConfig, setPiConfig] = useState(initialPiConfig);
  const [piBaseUrl, setPiBaseUrl] = useState(
    runtimePiConfig.valid ? runtimePiConfig.normalized : initialPiConfig.baseUrl
  );
  const [piConnectionStatus, setPiConnectionStatus] = useState('idle');
  const [piMessage, setPiMessage] = useState('');
  const piTestControllerRef = useRef(null);

  useEffect(() => {
    const unsubscribe = subscribeToPiCameraConfig((config) => setPiConfig(config));
    return () => {
      piTestControllerRef.current?.abort();
      piTestControllerRef.current = null;
      unsubscribe();
    };
  }, []);

  const handlePiBaseUrlChange = (event) => {
    setPiBaseUrl(event.target.value);
    setPiConnectionStatus('idle');
    setPiMessage('');
  };

  const handleSavePiCamera = () => {
    const result = saveRuntimePiCameraBaseUrl(piBaseUrl);
    if (!result.ok) {
      setPiConnectionStatus(PI_CONNECTION_STATUS.INVALID_URL);
      setPiMessage(result.error);
      return;
    }
    setPiBaseUrl(result.normalized);
    setPiConfig(result.config);
    setPiConnectionStatus('idle');
    setPiMessage('Pi camera URL saved in this browser.');
  };

  const handleResetPiCamera = () => {
    piTestControllerRef.current?.abort();
    piTestControllerRef.current = null;
    const config = clearRuntimePiCameraBaseUrl();
    setPiConfig(config);
    setPiBaseUrl(config.baseUrl);
    setPiConnectionStatus('idle');
    setPiMessage(
      config.source === PI_CONFIG_SOURCE.ENVIRONMENT
        ? 'Runtime override removed. Environment configuration is active.'
        : 'Runtime override removed. Pi camera is not configured.'
    );
  };

  const handleTestPiCamera = async () => {
    if (piTestControllerRef.current) return;
    const validation = validatePiCameraBaseUrl(piBaseUrl);
    if (!validation.valid) {
      setPiConnectionStatus(PI_CONNECTION_STATUS.INVALID_URL);
      setPiMessage(validation.error);
      return;
    }

    const controller = new AbortController();
    piTestControllerRef.current = controller;
    setPiConnectionStatus('testing');
    setPiMessage('Testing the Pi /health endpoint from this browser…');
    try {
      const result = await testPiCameraConnection({
        baseUrl: validation.normalized,
        timeoutMs: 3500,
        signal: controller.signal,
      });
      setPiConnectionStatus(result.status);
      if (result.status === PI_CONNECTION_STATUS.SUCCESS) {
        setPiMessage('Pi Camera Module 3 is healthy and reachable.');
      } else if (result.status === PI_CONNECTION_STATUS.PERMISSION_REQUIRED) {
        setPiMessage('Allow Chrome local-network access for FlowGuard, then test the connection again.');
      } else if (result.status === PI_CONNECTION_STATUS.UNEXPECTED_RESPONSE) {
        setPiMessage('The address responded, but it was not a healthy FlowGuard Pi camera server.');
      } else if (result.status !== PI_CONNECTION_STATUS.ABORTED) {
        setPiMessage('The Pi camera is unreachable. Check the hotspot, IP address, and camera server.');
      }
    } finally {
      if (piTestControllerRef.current === controller) piTestControllerRef.current = null;
    }
  };

  const handleSelfReEnroll = () => {
    const params = new URLSearchParams({
      userId: currentUserId,
      name: currentUserName || 'My profile',
      returnTo: '/settings'
    });
    navigate(`/enrollment?${params.toString()}`);
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPasswordMessage(null);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordMessage({ type: 'error', text: 'All three password fields are required.' });
      return;
    }
    if (newPassword.length < 8) {
      setPasswordMessage({ type: 'error', text: 'New password must be at least 8 characters.' });
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordMessage({ type: 'error', text: 'New password must be different from the current password.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage({ type: 'error', text: 'New password and confirmation do not match.' });
      return;
    }

    setChangingPassword(true);
    try {
      const token = localStorage.getItem('accessToken');
      await axios.put(`${API_BASE_URL}/user/change-password`, {
        currentPassword,
        newPassword
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      // The backend revoked every existing session (tokenVersion bump), so the
      // current token is dead too — clear the session and require a fresh login.
      setPasswordMessage({ type: 'success', text: 'Password changed. Redirecting to login…' });
      localStorage.clear();
      navigate('/login', { state: { notice: 'Password changed successfully. Please log in with your new password.' } });
    } catch (err) {
      const text = err.response?.data?.message || 'Password change failed. Please try again.';
      setPasswordMessage({ type: 'error', text });
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <div className="dashboard-layout">
      <Sidebar />

      {/* --- MAIN SETTINGS CONTENT --- */}
      <main className="dashboard-main">
        <header className="dashboard-header settings-header">
          <div className="header-titles">
            <h1>Settings</h1>
            <p>Manage your biometric profile, account security and notification preferences.</p>
          </div>
        </header>

        <div className="settings-grid">

          <section className="settings-card" aria-labelledby="pi-camera-settings-heading">
            <div className="card-header">
              <h3 id="pi-camera-settings-heading">Raspberry Pi Camera</h3>
              <p>Configure the Camera Module 3 used by gate scanning in this browser.</p>
            </div>
            <div className="pi-camera-settings-body">
              <label className="pi-camera-url-label" htmlFor="pi-camera-base-url">Pi Camera Base URL</label>
              <input
                id="pi-camera-base-url"
                className="dark-select pi-camera-url-input"
                type="url"
                inputMode="url"
                value={piBaseUrl}
                onChange={handlePiBaseUrlChange}
                placeholder={PI_CAMERA_URL_PLACEHOLDER}
                autoComplete="off"
              />
              <div className="pi-camera-meta" aria-live="polite">
                <span>Configuration source: <strong>{PI_SOURCE_LABELS[piConfig.source]}</strong></span>
                <span>
                  Connection status: <strong data-status={piConnectionStatus}>{PI_STATUS_LABELS[piConnectionStatus]}</strong>
                </span>
              </div>
              {piMessage && (
                <p
                  className={piConnectionStatus === PI_CONNECTION_STATUS.INVALID_URL ? 'settings-feedback-error' : 'pi-camera-message'}
                  role={piConnectionStatus === PI_CONNECTION_STATUS.INVALID_URL ? 'alert' : 'status'}
                >
                  {piMessage}
                </p>
              )}
              <div className="pi-camera-actions">
                <button type="button" className="save-btn" onClick={handleSavePiCamera}>Save</button>
                <button
                  type="button"
                  className="save-btn secondary-btn"
                  onClick={handleTestPiCamera}
                  disabled={piConnectionStatus === 'testing'}
                >
                  {piConnectionStatus === 'testing' ? 'Testing…' : 'Test Connection'}
                </button>
                <button type="button" className="save-btn secondary-btn" onClick={handleResetPiCamera}>Reset</button>
              </div>
              <ol className="pi-camera-instructions">
                <li>Connect the laptop and Raspberry Pi to the same hotspot.</li>
                <li>Run the Pi camera server.</li>
                <li>Enter the current Pi base URL.</li>
                <li>Allow Chrome local-network access when prompted.</li>
              </ol>
              <p className="pi-camera-note">
                Your browser connects directly to the Pi over the hotspot. Cloud Run does not connect to the private Pi address.
              </p>
            </div>
          </section>

          {/* --- FM-only: alert routing --- */}
          {isFM && (
            <section className="settings-card">
              <div className="card-header">
                <h3>Network & Notifications</h3>
                <p>Manage how FlowGuard communicates with the floor managers.</p>
              </div>

              <div className="setting-row">
                <div className="setting-info">
                  <h4>Push Notifications to Mobile</h4>
                  <p>Instantly alert floor supervisors of hygiene violations.</p>
                </div>
                <div className="setting-control">
                  <label className="toggle-switch">
                    <input type="checkbox" checked={alertsEnabled} onChange={() => setAlertsEnabled(!alertsEnabled)} />
                    <span className="toggle-slider"></span>
                  </label>
                </div>
              </div>
            </section>
          )}

          {/* --- Biometric Profile: available to ALL authenticated users --- */}
          <section className="settings-card">
            <div className="card-header">
              <h3>Biometric Profile</h3>
              <p>Refresh your Face ID if gate recognition becomes unreliable.</p>
            </div>
            <div className="setting-row">
              <div className="setting-info">
                <h4>Face ID Re-enrollment</h4>
                <p>Use either camera capture or manual photo upload to replace your current protected biometric template.</p>
              </div>
              <div className="setting-control">
                <button className="save-btn" onClick={handleSelfReEnroll}>Re-enroll My Face ID</button>
              </div>
            </div>
          </section>

          {/* --- Account Security: available to ALL authenticated users --- */}
          <section className="settings-card">
            <div className="card-header">
              <h3>Account Security</h3>
              <p>Change your FlowGuard sign-in password. You will be logged out of all devices.</p>
            </div>
            <form onSubmit={handleChangePassword}>
              <div className="setting-row">
                <div className="setting-info">
                  <h4>Current Password</h4>
                </div>
                <div className="setting-control">
                  <input
                    type="password"
                    className="dark-select"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Current password"
                    aria-label="Current Password"
                  />
                </div>
              </div>
              <div className="setting-row">
                <div className="setting-info">
                  <h4>New Password</h4>
                  <p>Minimum 8 characters, different from your current password.</p>
                </div>
                <div className="setting-control">
                  <input
                    type="password"
                    className="dark-select"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="New password"
                    aria-label="New Password"
                  />
                </div>
              </div>
              <div className="setting-row">
                <div className="setting-info">
                  <h4>Confirm New Password</h4>
                </div>
                <div className="setting-control">
                  <input
                    type="password"
                    className="dark-select"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repeat new password"
                    aria-label="Confirm New Password"
                  />
                </div>
              </div>
              {passwordMessage && (
                <p
                  role="alert"
                  className={passwordMessage.type === 'error' ? 'settings-feedback-error' : 'settings-feedback-success'}
                >
                  {passwordMessage.text}
                </p>
              )}
              <div className="setting-row">
                <div className="setting-info" />
                <div className="setting-control">
                  <button type="submit" className="save-btn" disabled={changingPassword}>
                    {changingPassword ? 'Changing…' : 'Change Password'}
                  </button>
                </div>
              </div>
            </form>
          </section>

        </div>
      </main>
    </div>
  );
};

export default Settings;
