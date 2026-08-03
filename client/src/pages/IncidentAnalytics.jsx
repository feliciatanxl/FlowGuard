import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import axios from 'axios';
import Sidebar from '../components/Sidebar';
import MTTRStatTile from '../components/MTTRStatTile';
import AccuracyMeter from '../components/AccuracyMeter';
import ConfidenceBucketChart from '../components/ConfidenceBucketChart';
import ResolutionFunnelChart from '../components/ResolutionFunnelChart';
import '../css/Dashboard.css';
import '../css/IncidentDashboard.css';
import '../css/IncidentAnalytics.css';
import {
  computeMTTR,
  computeAIAccuracy,
  computeConfidenceBuckets,
  computeResolutionFunnel,
} from '../utils/incidentAnalytics';

// Reachable only via the "View Deep Analytics ->" button on the Incident Dashboard —
// deliberately not in the sidebar (mirrors the /logistics/gate-verification pattern).
// Computes all four analytics client-side from the same GET /api/incident list the
// main dashboard already fetches, so the two pages' numbers never drift apart.
const IncidentAnalytics = () => {
  const navigate = useNavigate();
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  const getToken = () => localStorage.getItem('accessToken');

  const fetchIncidents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/incident', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      setIncidents(Array.isArray(res.data) ? res.data : []);
      setUnavailable(false);
    } catch (err) {
      console.error('Failed to fetch incidents for analytics:', err);
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchIncidents(); }, [fetchIncidents]);

  const mttr = computeMTTR(incidents);
  const accuracy = computeAIAccuracy(incidents);
  const buckets = computeConfidenceBuckets(incidents);
  const funnel = computeResolutionFunnel(incidents);

  return (
    <div className="dashboard-layout">
      <Sidebar />
      <main className="dashboard-main">
        <header className="dashboard-header">
          <div className="header-titles">
            <h1>Incident Deep Analytics</h1>
            <p style={{ color: '#94a3b8', marginTop: '4px' }}>
              Resolution performance and AI accuracy for the Incident Dashboard
            </p>
          </div>
          <div className="inc-header-actions">
            <button type="button" className="inc-support-btn" onClick={() => navigate('/incidents')}>
              ← Back to Incident Dashboard
            </button>
            <button type="button" className="inc-analytics-btn" onClick={fetchIncidents} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </header>

        {unavailable && (
          <p className="analytics-empty analytics-unavailable" role="status">
            Analytics temporarily unavailable. Retrying…
          </p>
        )}

        <section className="ia-kpi-row" aria-label="Resolution and accuracy summary">
          <MTTRStatTile mttr={mttr} />
          <AccuracyMeter accuracy={accuracy} />
        </section>

        <ConfidenceBucketChart buckets={buckets} />
        <ResolutionFunnelChart funnel={funnel} />
      </main>
    </div>
  );
};

export default IncidentAnalytics;
