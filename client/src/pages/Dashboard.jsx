import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router';
import VideocamIcon from '@mui/icons-material/Videocam';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import VideocamOffIcon from '@mui/icons-material/VideocamOff';
import GroupsIcon from '@mui/icons-material/Groups';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import EventIcon from '@mui/icons-material/Event';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import SupportAgentIcon from '@mui/icons-material/SupportAgent';
import BadgeIcon from '@mui/icons-material/Badge';
import ScheduleIcon from '@mui/icons-material/Schedule';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import HistoryIcon from '@mui/icons-material/History';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import LoginIcon from '@mui/icons-material/Login';
import LogoutIcon from '@mui/icons-material/Logout';
import FaceIcon from '@mui/icons-material/Face';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import SettingsIcon from '@mui/icons-material/Settings';
import Sidebar from '../components/Sidebar';
import SafeMuiIcon from '../components/SafeMuiIcon';
import AlertTrendChart from '../components/AlertTrendChart';
import TopAlertZonesChart from '../components/TopAlertZonesChart';
import '../css/Dashboard.css';
import { API_BASE_URL } from '../constants/api';

const displayMetric = (value) => (value === null || value === undefined || value === '' ? 'Unavailable' : value);
const formatDateTime = (value) => value
  ? new Intl.DateTimeFormat('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : 'Not scheduled';
const formatPunctuality = (value) => {
  if (value === 'ON_TIME') return 'On Time';
  if (value === 'LATE') return 'Late';
  return 'No Check-In';
};

// Real icon component reference (icon={VideocamIcon}), never a derived
// three-letter pseudo-icon and never JSX (icon={<VideocamIcon />}). The
// visible label carries the meaning, so the icon itself stays aria-hidden.
const SummaryCard = ({ icon, label, value, helper, to, tone = 'blue-icon' }) => {
  const displayValue = displayMetric(value);

  const content = (
    <>
      <div className={`icon-wrapper ${tone}`} aria-hidden="true">
        <SafeMuiIcon icon={icon} fontSize="small" />
      </div>
      <div className="summary-info">
        <h2>{displayValue}</h2>
        <p>{label}</p>
        {helper ? <small className="summary-helper">{helper}</small> : null}
      </div>
    </>
  );

  return to ? (
    <Link className="summary-card dashboard-link-card" to={to}>
      {content}
    </Link>
  ) : (
    <div className="summary-card">{content}</div>
  );
};

// Staff quick links come from the API as {label, to}; icons render by route.
const QUICK_LINK_ICONS = {
  '/attendance': FactCheckIcon,
  '/logistics': LocalShippingIcon,
  '/settings': SettingsIcon,
};

// How often the FM dashboard re-polls the single authoritative summary endpoint
// while the browser tab is visible. Polling pauses when the tab is hidden.
const POLL_INTERVAL_MS = 15000;

// "Last updated 6:01:12 PM" in Singapore time (host-timezone independent). The stamp
// comes from the server's generatedAt so it reflects when the data was actually built.
const formatLastUpdated = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
  }).format(date).replace(/\b(am|pm)\b/i, (m) => m.toUpperCase());
};

const alertTitle = (alert) => {
  const descriptor = `${alert.alert_type || ''} ${alert.object_class || ''}`;

  if (/crowd/i.test(alert.alert_type || '')) {
    return 'Crowd density alert';
  }

  if (/unattended/i.test(descriptor)) {
    return 'Unattended pallet/object alert';
  }

  return alert.object_class || alert.alert_type || 'Detection Alert';
};

const Dashboard = () => {
  const [user] = useState(() => ({
    name: localStorage.getItem('userName') || 'Guest',
    role: localStorage.getItem('userRole') || 'Tenant'
  }));
  const [currentTime, setCurrentTime] = useState(new Date());
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);      // initial load only
  const [error, setError] = useState('');            // hard error before any data
  const [staleError, setStaleError] = useState('');  // soft error while keeping last data
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState('');

  // Refs guard against overlapping requests and against setState-after-unmount /
  // stale responses arriving out of order.
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const abortRef = useRef(null);
  const hasDataRef = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Single authoritative fetch of /api/dashboard/summary. Never runs two at once; a
  // temporary failure keeps the last good data and surfaces a soft "unavailable" state
  // instead of blanking the screen with fake zeroes.
  const fetchSummary = useCallback(async () => {
    if (inFlightRef.current) return; // no overlapping requests
    inFlightRef.current = true;
    if (hasDataRef.current) setRefreshing(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const token = localStorage.getItem('accessToken');
      const res = await axios.get(`${API_BASE_URL}/api/dashboard/summary`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!mountedRef.current) return;
      setDashboard(res.data);
      hasDataRef.current = true;
      setLastUpdated(res.data?.generatedAt || new Date().toISOString());
      setError('');
      setStaleError('');
    } catch (err) {
      if (axios.isCancel?.(err) || err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') return;
      if (!mountedRef.current) return;
      console.error('Dashboard summary failed:', err);
      // Keep the last good data on a transient failure; only show the hard error/Retry
      // state if we have never loaded anything yet.
      if (hasDataRef.current) {
        setStaleError('Live data temporarily unavailable — showing the last update.');
      } else {
        setError(err.response?.data?.error || 'Unable to load dashboard summary.');
      }
    } finally {
      if (mountedRef.current) { setLoading(false); setRefreshing(false); }
      inFlightRef.current = false;
    }
  }, []);

  // Mount: fetch immediately, then poll every 15s WHILE the tab is visible. Polling
  // pauses when the tab is hidden and refreshes immediately when it becomes visible
  // again. Everything is cleaned up on unmount (interval, listener, in-flight request).
  useEffect(() => {
    mountedRef.current = true;
    (async () => { await fetchSummary(); })();
    const interval = setInterval(() => {
      if (!document.hidden) fetchSummary();
    }, POLL_INTERVAL_MS);
    const onVisibility = () => { if (!document.hidden) fetchSummary(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      try { abortRef.current?.abort(); } catch { /* ignore */ }
    };
  }, [fetchSummary]);

  const role = dashboard?.role || user.role;
  const title = role === 'FM' ? 'Operations Dashboard' : role === 'Tenant' ? 'Tenant Dashboard' : 'Staff Dashboard';

  const content = useMemo(() => {
    if (!dashboard) return null;
    const summary = dashboard.summary || {};

    if (dashboard.role === 'FM') {
      // Single source of truth: the summary payload already carries the newest five
      // active High/Critical alerts (safe metadata only) — no separate fetch.
      const alertsToShow = dashboard.recentHighPriorityAlerts || [];
      const analyticsUnavailable = dashboard.analyticsAvailable === false;

      return (
        <>
          <section className="top-summary-row dashboard-summary-grid">
            <SummaryCard to="/cameras" icon={VideocamIcon} label="Total Cameras" value={summary.cameras?.total} />
            <SummaryCard to="/cameras" tone="green-icon" icon={CheckCircleIcon} label="Cameras Online" value={summary.cameras?.online} />
            <SummaryCard to="/cameras" tone="red-icon" icon={VideocamOffIcon} label="Cameras Offline" value={summary.cameras?.offline} />
            <SummaryCard to="/attendance" icon={GroupsIcon} label="People On Site" value={summary.attendance?.peopleCurrentlyOnSite} />
            <SummaryCard to="/object-detection" tone="red-icon" icon={WarningAmberIcon} label="Urgent Alerts" value={summary.urgentDetectionAlerts} />
            <SummaryCard to="/logistics" tone="purple-icon" icon={EventIcon} label="Today's Bookings" value={summary.todaysLoadingBayBookings} />
            <SummaryCard to="/logistics" icon={LocalShippingIcon} label="Active Vehicles" value={summary.activeOrArrivedVehicles} />
            <SummaryCard to="/incidents" tone="red-icon" icon={ReportProblemIcon} label="Open Incidents" value={summary.openIncidents} />
            <SummaryCard to="/support-dashboard" tone="purple-icon" icon={SupportAgentIcon} label="Open Tickets" value={summary.openSupportTickets} />
          </section>

          <section className="dashboard-alert-section">
            <div className="dashboard-section-heading">
              <div>
                <h3>Recent High-Priority Operational Alerts</h3>
                <p>Safe alert metadata only. Individual lateness is not included.</p>
              </div>
              <Link to="/object-detection">Open live console</Link>
            </div>
            <div className="dashboard-alert-grid">
              {alertsToShow.map((alert) => (
                <Link className="dashboard-alert-card" key={alert.id} to="/object-detection">
                  <span>{alert.severity || alert.status}</span>
                  <h2>{alertTitle(alert)}</h2>
                  <p>{alert.zone_name} - {alert.camera_location}</p>
                  <small>{formatDateTime(alert.occurred_at || alert.createdAt)}</small>
                </Link>
              ))}
              {alertsToShow.length === 0 && (
                // Distinguishes a temporary outage (keep last data + banner above) from a
                // genuine "there really are no active urgent alerts right now".
                staleError ? (
                  <div className="dashboard-alert-empty"><h2>Live data temporarily unavailable</h2><p>Showing the last successful update. Retrying automatically…</p></div>
                ) : (
                  <div className="dashboard-alert-empty"><h2>No high-priority alerts</h2><p>Urgent operational alerts will appear here when active.</p></div>
                )
              )}
            </div>
          </section>

          <section className="dashboard-analytics-grid" aria-label="Operational alert analytics">
            <AlertTrendChart data={dashboard.analytics?.alertTrend7Days} unavailable={analyticsUnavailable} />
            <TopAlertZonesChart data={dashboard.analytics?.topAlertZones7Days} unavailable={analyticsUnavailable} />
          </section>
        </>
      );
    }

    if (dashboard.role === 'Tenant') {
      return (
        <>
          <section className="top-summary-row dashboard-summary-grid">
            <SummaryCard to="/staff" icon={GroupsIcon} label="Own Staff Total" value={summary.staffTotal} />
            <SummaryCard to="/attendance" tone="green-icon" icon={BadgeIcon} label="Staff On Site" value={summary.staffCurrentlyOnSite} />
            <SummaryCard to="/attendance" tone="red-icon" icon={ScheduleIcon} label="Own Staff Late Today" value={summary.staffLateToday} />
            <SummaryCard to="/logistics" tone="purple-icon" icon={EventIcon} label="Today's Own Bookings" value={summary.todaysOwnBookings} />
            <SummaryCard to="/support-dashboard" icon={SupportAgentIcon} label="Own Open Support Cases" value={summary.ownOpenSupportCases} />
          </section>

          <section className="dashboard-detail-grid">
            <div className="chart-card">
              <h3><SafeMuiIcon icon={EventAvailableIcon} fontSize="small" aria-hidden="true" /> Next Booking</h3>
              {dashboard.nextBooking ? (
                <p>{dashboard.nextBooking.booking_ref} at {dashboard.nextBooking.loading_bay} - {formatDateTime(dashboard.nextBooking.slot_start)}</p>
              ) : <p className="dashboard-muted">No upcoming own booking.</p>}
            </div>
            <div className="chart-card">
              <h3><SafeMuiIcon icon={HistoryIcon} fontSize="small" aria-hidden="true" /> Recent Own-Unit Activity</h3>
              {(dashboard.recentActivity || []).length > 0 ? dashboard.recentActivity.map((item) => (
                <p key={item.id || item.booking_ref}>{item.booking_ref} - {item.status}</p>
              )) : <p className="dashboard-muted">No recent own-unit activity.</p>}
            </div>
          </section>
        </>
      );
    }

    return (
      <>
        <section className="top-summary-row dashboard-summary-grid">
          <SummaryCard to="/attendance" icon={LocationOnIcon} label="Current Status" value={summary.currentClockStatus === 'IN' ? 'On Site' : 'Off Site'} />
          <SummaryCard to="/attendance" tone="green-icon" icon={LoginIcon} label="First Clock-In" value={summary.todayFirstClockIn ? formatDateTime(summary.todayFirstClockIn) : 'Not recorded'} />
          <SummaryCard to="/attendance" tone="purple-icon" icon={LogoutIcon} label="Latest Clock-Out" value={summary.todayLatestClockOut ? formatDateTime(summary.todayLatestClockOut) : 'Not recorded'} />
          <SummaryCard to="/attendance" tone="red-icon" icon={ScheduleIcon} label="Punctuality" value={formatPunctuality(summary.punctuality)} />
          <SummaryCard to="/settings" icon={FaceIcon} label="Face ID" value={summary.faceIdEnrolled ? 'Enrolled' : 'Not Enrolled'} />
        </section>

        <section className="dashboard-detail-grid">
          <div className="chart-card">
            <h3><SafeMuiIcon icon={EventAvailableIcon} fontSize="small" aria-hidden="true" /> Next Relevant Booking</h3>
            {dashboard.nextRelevantBooking ? <p>{dashboard.nextRelevantBooking.booking_ref}</p> : <p className="dashboard-muted">{dashboard.unavailable?.nextRelevantBooking || 'No relevant booking.'}</p>}
          </div>
          <div className="chart-card">
            <h3>Quick Links</h3>
            <div className="dashboard-quick-links">
              {(dashboard.quickLinks || []).map((link) => (
                <Link key={link.to} to={link.to}>
                  <SafeMuiIcon icon={QUICK_LINK_ICONS[link.to]} fontSize="small" aria-hidden="true" /> {link.label}
                </Link>
              ))}
            </div>
          </div>
        </section>
      </>
    );
  }, [dashboard, staleError]);

  return (
    <div className="dashboard-layout">
      <Sidebar />
      <main className="dashboard-main">
        <header className="dashboard-header">
          <div className="header-titles">
            <h1>{title}</h1>
            <p>Welcome back, <strong>{user.name}</strong></p>
          </div>
          <div className="header-time">
            <p className="time-text">{currentTime.toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'medium' })}</p>
            <p className="timezone-text">Region: Singapore (JTC Factory)</p>
          </div>
        </header>

        <div className="dashboard-refresh-bar">
          <span className="dashboard-last-updated">
            {lastUpdated ? `Last updated: ${formatLastUpdated(lastUpdated)} SGT` : 'Live dashboard'}
          </span>
          <button
            type="button"
            className="dashboard-refresh-btn"
            onClick={fetchSummary}
            disabled={refreshing || loading}
          >
            {refreshing ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </div>

        {/* Soft banner: a poll failed but the last good data is still shown below. */}
        {staleError && !error && (
          <div className="dashboard-stale-banner" role="status">{staleError}</div>
        )}

        {loading && <div className="dashboard-loading">Loading dashboard summary...</div>}
        {error && (
          <div className="dashboard-error" role="alert">
            <span>{error}</span>
            <button type="button" className="dashboard-retry-btn" onClick={fetchSummary}>Retry</button>
          </div>
        )}
        {!loading && !error && content}
      </main>
    </div>
  );
};

export default Dashboard;