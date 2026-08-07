// Pure aggregation functions backing the Incident Dashboard's Deep Analytics
// subpage. Framework-free (no React, no axios) so they're trivially unit-testable —
// mirrors the style of server/services/dashboardAnalytics.js, just running client-side
// against the incident list the main dashboard already fetches from GET /api/incident.

const MINUTE = 60000;
const HOUR = 3600000;
const DAY = HOUR * 24;
const TREND_DAYS = 7;

// An incident is "adjudicated" once it reaches one of these — Active/Investigating
// incidents haven't been judged valid vs. false-positive yet, so several charts below
// deliberately exclude them from their denominator.
const TERMINAL_STATUSES = ['Cleared', 'False Positive'];
const FUNNEL_STAGES = ['Active', 'Investigating', 'Escalated to Security', 'Cleared'];

const CONFIDENCE_BUCKETS = [
  { label: '90–100%', min: 0.90, max: Infinity },
  { label: '70–89%', min: 0.70, max: 0.90 },
  { label: 'Below 70%', min: -Infinity, max: 0.70 },
];

const isAiSourced = (incident) => incident.source !== 'Manual';
const isTerminal = (incident) => TERMINAL_STATUSES.includes(incident.resolutionStatus);

export const formatDuration = (ms) => {
  if (ms == null || Number.isNaN(ms)) return '—';
  if (ms < MINUTE) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (ms < HOUR) return `${Math.round(ms / MINUTE)}m`;
  if (ms < DAY) return `${(ms / HOUR).toFixed(1)}h`;
  return `${(ms / DAY).toFixed(1)}d`;
};

// YYYY-MM-DD keyed off the LOCAL calendar date (not UTC, not Singapore-day — an
// accepted simplification for a first-pass KPI sparkline; see the plan notes for
// swapping to SG-day precision later).
const localDateKey = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const dayLabelFormatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

// Item 1 — Mean Time To Resolve: average (resolvedAt - createdAt) across every
// incident that has been resolved, plus a zero-filled 7-day trend of that same
// average, bucketed by the LOCAL calendar day the incident was resolved on.
export const computeMTTR = (incidents, { now = new Date() } = {}) => {
  const resolved = incidents.filter((i) => i.resolvedAt && i.createdAt);
  const durations = resolved.map((i) => new Date(i.resolvedAt).getTime() - new Date(i.createdAt).getTime());
  const avgMs = durations.length > 0 ? durations.reduce((sum, d) => sum + d, 0) / durations.length : null;

  const days = [];
  for (let i = TREND_DAYS - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    days.push({ key: localDateKey(d), dateObj: d });
  }

  const byDay = new Map(days.map((d) => [d.key, []]));
  for (const incident of resolved) {
    const key = localDateKey(new Date(incident.resolvedAt));
    if (byDay.has(key)) {
      byDay.get(key).push(new Date(incident.resolvedAt).getTime() - new Date(incident.createdAt).getTime());
    }
  }

  const trend = days.map(({ key, dateObj }) => {
    const values = byDay.get(key);
    const dayAvgMs = values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
    return {
      date: key,
      label: dayLabelFormatter.format(dateObj),
      avgMs: dayAvgMs,
      avgLabel: values.length > 0 ? formatDuration(dayAvgMs) : '—',
    };
  });

  return {
    avgMs,
    avgLabel: avgMs != null ? formatDuration(avgMs) : '—',
    resolvedCount: durations.length,
    trend,
    trendMax: trend.reduce((m, t) => Math.max(m, t.avgMs), 0) || 1,
  };
};

// Item 2a — AI Accuracy: % of AI-sourced, adjudicated incidents that were NOT marked
// False Positive. AI-sourced = anything not 'Manual' (same definition the source
// split-bar uses). Tier drives the meter's fill color (accent/warning/danger).
export const computeAIAccuracy = (incidents) => {
  const evaluated = incidents.filter((i) => isAiSourced(i) && isTerminal(i));
  const falsePositiveCount = evaluated.filter((i) => i.resolutionStatus === 'False Positive').length;
  const evaluatedCount = evaluated.length;
  const accuracyPct = evaluatedCount > 0 ? ((evaluatedCount - falsePositiveCount) / evaluatedCount) * 100 : null;
  const tier = accuracyPct == null || accuracyPct >= 90 ? 'accent' : accuracyPct >= 70 ? 'warning' : 'danger';
  return { evaluatedCount, falsePositiveCount, accuracyPct, tier };
};

// Item 2b — confidence-score buckets vs. outcome. Scoped to AI-sourced, adjudicated
// incidents with a recorded confidence_score (Manual incidents rarely have one, and
// an unresolved incident has no "valid vs false positive" answer yet).
export const computeConfidenceBuckets = (incidents) => {
  const eligible = incidents.filter((i) => isAiSourced(i) && isTerminal(i) && i.confidence_score != null);
  return CONFIDENCE_BUCKETS.map(({ label, min, max }) => {
    const inBucket = eligible.filter((i) => {
      const score = Number(i.confidence_score);
      return score >= min && score < max;
    });
    const falsePositive = inBucket.filter((i) => i.resolutionStatus === 'False Positive').length;
    return { bucket: label, valid: inBucket.length - falsePositive, falsePositive };
  });
};

// Item 4 — current counts for the 4 linear resolutionStatus stages, plus a separate
// falsePositiveCount (a branch off the funnel, not a 5th sequential stage).
export const computeResolutionFunnel = (incidents) => ({
  stages: FUNNEL_STAGES.map((stage) => ({
    stage,
    count: incidents.filter((i) => i.resolutionStatus === stage).length,
  })),
  falsePositiveCount: incidents.filter((i) => i.resolutionStatus === 'False Positive').length,
});

// Capitalises the first letter of every word, lowercasing the rest — used
// wherever a detection type (built-in or user-typed) needs to match the same
// Title Case convention as this page's static dropdown option labels.
export const toTitleCase = (str) =>
  (str || '').toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

// Formats a detection-type (incident.status) value for display: underscores ->
// spaces, Title Case. Built-in values (UNAUTHORIZED_ACCESS, etc.) render as
// "Unauthorized Access"; free-text custom types FM staff type in (e.g.
// "water leakage") get normalised to the same convention regardless of the
// case they were typed/stored in.
export const formatDetectionType = (status) =>
  toTitleCase((status || '').replace(/_/g, ' '));

// Item 5 — incident counts grouped by detection type, covering both the fixed
// built-in categories and any custom types FM staff have logged. Sorted by
// count descending; every distinct type present is shown — the type space is
// small enough that folding a tail into "Other" would just hide real data.
export const computeDetectionTypeBreakdown = (incidents) => {
  const counts = new Map();
  for (const incident of incidents) {
    const label = formatDetectionType(incident.status);
    if (!label) continue;
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
};
