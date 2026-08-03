import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../constants/api';
import { sortEvaluationLabels, UNKNOWN_LABEL } from '../constants/evaluation';
export default function useEvaluationParticipants({ autoSync = false } = {}) {
  const [participants, setParticipants] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  // Auto-sync failures are non-fatal (the directory still loads); the message
  // is set for future surfacing but not currently rendered, so the value is unread.
  const [, setAutoSyncError] = useState('');
  // Guards the once-per-mount automatic sync: re-renders and reload() calls
  // must never repeat the POST (only a fresh mount or the manual button can).
  const didAutoSync = useRef(false);
  const reload = useCallback(async () => { setLoading(true); setError(''); try { const token = localStorage.getItem('accessToken'); const response = await axios.get(`${API_BASE_URL}/api/facial-recognition/evaluation-participants`, { headers: { Authorization: `Bearer ${token}` } }); setParticipants(Array.isArray(response.data?.participants) ? response.data.participants : []); } catch { setParticipants([]); setError('Could not load evaluation participants.'); } finally { setLoading(false); } }, []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (autoSync && !didAutoSync.current) {
        didAutoSync.current = true;
        try {
          // Idempotent backfill: creates mappings only for users without one;
          // existing P-labels are never changed or renumbered by the server.
          const token = localStorage.getItem('accessToken');
          await axios.post(`${API_BASE_URL}/api/facial-recognition/evaluation-participants/sync`, {}, { headers: { Authorization: `Bearer ${token}` } });
        } catch {
          if (!cancelled) setAutoSyncError('Automatic participant sync failed — showing existing mappings. Use Sync Participants to retry.');
        }
      }
      // Always fetch the directory, even when sync failed or is disabled.
      reload();
    })();
    return () => { cancelled = true; };
  }, [reload, autoSync]);
  // Matrix identity classes: only participants with a valid enrolled template
  // (matrixEligible; legacy payloads fall back to isEnrolled). All participants
  // still appear in the FM directory regardless of eligibility.
  const eligibleParticipants = useMemo(() => participants.filter((p) => (p.matrixEligible ?? p.isEnrolled) !== false), [participants]);
  const labels = useMemo(() => [...sortEvaluationLabels(eligibleParticipants.map((p) => p.evaluationLabel)), UNKNOWN_LABEL], [eligibleParticipants]);
  const namesByLabel = useMemo(() => Object.fromEntries(participants.map((p) => [p.evaluationLabel, p.name])), [participants]);
  return { participants, eligibleParticipants, labels, namesByLabel, loading, error, reload };
}