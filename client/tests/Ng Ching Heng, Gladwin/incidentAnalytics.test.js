// Unit tests for the 4 pure aggregation functions backing the Incident Dashboard's
// Deep Analytics subpage. Fixture arrays in, exact shape out — no React, no axios,
// same style as server/tests/dashboard-analytics.test.js.
import { describe, test, expect } from 'vitest';
import {
  formatDuration,
  formatDetectionType,
  computeMTTR,
  computeAIAccuracy,
  computeConfidenceBuckets,
  computeResolutionFunnel,
  computeDetectionTypeBreakdown,
} from '../../src/utils/incidentAnalytics';

const NOW = new Date(2026, 7, 3, 12, 0, 0); // 3 Aug 2026, noon local

const incident = (overrides = {}) => ({
  id: Math.random(),
  source: 'Facial Recognition',
  resolutionStatus: 'Cleared',
  confidence_score: 0.95,
  createdAt: new Date(2026, 7, 1, 9, 0, 0),
  resolvedAt: new Date(2026, 7, 1, 9, 14, 0),
  ...overrides,
});

describe('formatDuration', () => {
  test('formats seconds / minutes / hours / days', () => {
    expect(formatDuration(30000)).toBe('30s');
    expect(formatDuration(14 * 60000)).toBe('14m');
    expect(formatDuration(2.5 * 3600000)).toBe('2.5h');
    expect(formatDuration(3 * 86400000)).toBe('3.0d');
  });

  test('returns an em-dash for null/NaN', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(NaN)).toBe('—');
  });
});

describe('computeMTTR', () => {
  test('averages only resolved incidents, excluding ones with no resolvedAt', () => {
    const incidents = [
      incident({ createdAt: new Date(2026, 7, 1, 9, 0, 0), resolvedAt: new Date(2026, 7, 1, 9, 10, 0) }), // 10m
      incident({ createdAt: new Date(2026, 7, 1, 10, 0, 0), resolvedAt: new Date(2026, 7, 1, 10, 30, 0) }), // 30m
      incident({ resolvedAt: null }),
    ];
    const result = computeMTTR(incidents, { now: NOW });
    expect(result.resolvedCount).toBe(2);
    expect(result.avgMs).toBe(20 * 60000);
    expect(result.avgLabel).toBe('20m');
  });

  test('no resolved incidents -> null avg, em-dash label, zero count', () => {
    const result = computeMTTR([incident({ resolvedAt: null })], { now: NOW });
    expect(result.avgMs).toBeNull();
    expect(result.avgLabel).toBe('—');
    expect(result.resolvedCount).toBe(0);
  });

  test('always returns a 7-point trend, zero-filled for days with no resolutions', () => {
    const result = computeMTTR([], { now: NOW });
    expect(result.trend).toHaveLength(7);
    expect(result.trend.every((d) => d.avgMs === 0 && d.avgLabel === '—')).toBe(true);
    expect(result.trend[6].date).toBe('2026-08-03'); // last point = "now"'s own calendar day
  });

  test('buckets a resolved incident onto its own resolvedAt calendar day', () => {
    const incidents = [
      incident({ createdAt: new Date(2026, 7, 1, 9, 0, 0), resolvedAt: new Date(2026, 7, 1, 9, 10, 0) }), // 10m
      incident({ createdAt: new Date(2026, 7, 1, 10, 0, 0), resolvedAt: new Date(2026, 7, 1, 10, 30, 0) }), // 30m
    ];
    const result = computeMTTR(incidents, { now: NOW });
    const aug1 = result.trend.find((d) => d.date === '2026-08-01');
    const aug3 = result.trend.find((d) => d.date === '2026-08-03');
    expect(aug1.avgMs).toBe(20 * 60000);
    expect(aug1.avgLabel).toBe('20m');
    expect(aug3.avgMs).toBe(0);
  });
});

describe('computeAIAccuracy', () => {
  test('excludes Manual-sourced and non-terminal incidents from the denominator', () => {
    const incidents = [
      incident({ source: 'Manual', resolutionStatus: 'Cleared' }),
      incident({ source: 'Facial Recognition', resolutionStatus: 'Active' }),
      incident({ source: 'Facial Recognition', resolutionStatus: 'Cleared' }),
      incident({ source: 'Object Detection', resolutionStatus: 'False Positive' }),
    ];
    const result = computeAIAccuracy(incidents);
    expect(result.evaluatedCount).toBe(2);
    expect(result.falsePositiveCount).toBe(1);
    expect(result.accuracyPct).toBe(50);
    expect(result.tier).toBe('danger');
  });

  test('tier boundaries: >=90 accent, 70-89 warning, <70 danger', () => {
    const makeSet = (validCount, fpCount) => [
      ...Array.from({ length: validCount }, () => incident({ resolutionStatus: 'Cleared' })),
      ...Array.from({ length: fpCount }, () => incident({ resolutionStatus: 'False Positive' })),
    ];
    expect(computeAIAccuracy(makeSet(9, 1)).tier).toBe('accent'); // 90%
    expect(computeAIAccuracy(makeSet(7, 3)).tier).toBe('warning'); // 70%
    expect(computeAIAccuracy(makeSet(6, 4)).tier).toBe('danger'); // 60%
  });

  test('no evaluated incidents -> null accuracyPct', () => {
    const result = computeAIAccuracy([incident({ resolutionStatus: 'Active' })]);
    expect(result.evaluatedCount).toBe(0);
    expect(result.accuracyPct).toBeNull();
  });
});

describe('computeConfidenceBuckets', () => {
  test('boundary confidence values land in the correct bucket', () => {
    const incidents = [
      incident({ confidence_score: 0.90, resolutionStatus: 'Cleared' }),
      incident({ confidence_score: 0.70, resolutionStatus: 'Cleared' }),
      incident({ confidence_score: 0.69, resolutionStatus: 'False Positive' }),
    ];
    const buckets = computeConfidenceBuckets(incidents);
    expect(buckets.find((b) => b.bucket === '90–100%').valid).toBe(1);
    expect(buckets.find((b) => b.bucket === '70–89%').valid).toBe(1);
    expect(buckets.find((b) => b.bucket === 'Below 70%').falsePositive).toBe(1);
  });

  test('excludes Manual-sourced, non-terminal, and null-confidence incidents', () => {
    const incidents = [
      incident({ source: 'Manual', confidence_score: 0.95 }),
      incident({ resolutionStatus: 'Active', confidence_score: 0.95 }),
      incident({ confidence_score: null }),
    ];
    const buckets = computeConfidenceBuckets(incidents);
    const total = buckets.reduce((sum, b) => sum + b.valid + b.falsePositive, 0);
    expect(total).toBe(0);
  });
});

describe('computeResolutionFunnel', () => {
  test('counts per stage regardless of input order; False Positive kept separate', () => {
    const incidents = [
      incident({ resolutionStatus: 'Cleared' }),
      incident({ resolutionStatus: 'Active' }),
      incident({ resolutionStatus: 'False Positive' }),
      incident({ resolutionStatus: 'Investigating' }),
      incident({ resolutionStatus: 'Active' }),
      incident({ resolutionStatus: 'Escalated to Security' }),
    ];
    const result = computeResolutionFunnel(incidents);
    expect(result.stages).toEqual([
      { stage: 'Active', count: 2 },
      { stage: 'Investigating', count: 1 },
      { stage: 'Escalated to Security', count: 1 },
      { stage: 'Cleared', count: 1 },
    ]);
    expect(result.falsePositiveCount).toBe(1);
  });
});

describe('formatDetectionType', () => {
  test('turns underscores into spaces and title-cases built-in types', () => {
    expect(formatDetectionType('UNAUTHORIZED_ACCESS')).toBe('Unauthorized Access');
  });

  test('title-cases a free-text custom type regardless of the case it was typed in', () => {
    expect(formatDetectionType('Water Leakage')).toBe('Water Leakage');
    expect(formatDetectionType('water leakage')).toBe('Water Leakage');
    expect(formatDetectionType('WATER LEAKAGE')).toBe('Water Leakage');
  });

  test('handles null/empty without throwing', () => {
    expect(formatDetectionType(null)).toBe('');
    expect(formatDetectionType(undefined)).toBe('');
    expect(formatDetectionType('')).toBe('');
  });
});

describe('computeDetectionTypeBreakdown', () => {
  test('groups by formatted type, sorted by count descending', () => {
    const incidents = [
      incident({ status: 'UNAUTHORIZED_ACCESS' }),
      incident({ status: 'UNAUTHORIZED_ACCESS' }),
      incident({ status: 'TAILGATING' }),
      incident({ status: 'Water Leakage' }), // custom type
    ];
    const result = computeDetectionTypeBreakdown(incidents);
    expect(result).toEqual([
      { type: 'Unauthorized Access', count: 2 },
      { type: 'Tailgating', count: 1 },
      { type: 'Water Leakage', count: 1 },
    ]);
  });

  test('custom types with different casing collapse into the same bucket', () => {
    const incidents = [
      incident({ status: 'Water Leakage' }),
      incident({ status: 'water leakage' }),
      incident({ status: 'WATER LEAKAGE' }),
    ];
    const result = computeDetectionTypeBreakdown(incidents);
    expect(result).toEqual([{ type: 'Water Leakage', count: 3 }]);
  });

  test('incidents with no status are skipped, not counted as an empty-string type', () => {
    const incidents = [incident({ status: '' }), incident({ status: null }), incident({ status: 'TAILGATING' })];
    expect(computeDetectionTypeBreakdown(incidents)).toEqual([{ type: 'Tailgating', count: 1 }]);
  });

  test('empty incident list returns an empty breakdown', () => {
    expect(computeDetectionTypeBreakdown([])).toEqual([]);
  });
});
