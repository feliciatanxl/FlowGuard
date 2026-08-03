// Frontend test — Incident Dashboard's source split-bar + legend (replaces the old
// "AI Detected / Manually Logged" text chips). Regression guard for a bucketing bug
// found while planning this feature: IncidentLog.source isn't limited to the 3
// literal values ('Manual' / 'Facial Recognition' / 'Object Detection') — real rows
// also arrive with 'Browser Webcam', 'Uploaded Video', and 'SecurePi Edge Node'
// (see detectionAlerts.js / edgeDetectionAlerts.js). A naive `source === 'Object
// Detection'` filter would silently under-count the Object Detection segment.
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi, describe, test, expect, beforeEach } from 'vitest';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('axios', () => ({ default: { get: mockGet, post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));

import IncidentDashboard from '../../src/pages/IncidentDashboard';

const incident = (overrides = {}) => ({
  id: overrides.id ?? Math.random(),
  camera_location: 'Loading Bay',
  status: 'UNAUTHORIZED_ACCESS',
  person_name: null,
  confidence_score: null,
  severity: 'Medium',
  source: 'Manual',
  resolutionStatus: 'Active',
  notes: '',
  createdAt: '2026-08-01T00:00:00Z',
  ...overrides,
});

const mount = (incidents) => {
  localStorage.setItem('accessToken', 't');
  localStorage.setItem('userRole', 'FM');
  mockGet.mockImplementation((url) => {
    if (url.includes('/api/incident')) return Promise.resolve({ data: incidents });
    return Promise.reject(new Error(`Unexpected GET: ${url}`));
  });
  render(<MemoryRouter><IncidentDashboard /></MemoryRouter>);
};

beforeEach(() => { mockGet.mockReset(); localStorage.clear(); });

describe('Incident Dashboard — source split-bar', () => {
  test('buckets literal Manual/Facial Recognition correctly and everything else as Object Detection', async () => {
    mount([
      incident({ id: 1, source: 'Manual' }),
      incident({ id: 2, source: 'Manual' }),
      incident({ id: 3, source: 'Facial Recognition' }),
      incident({ id: 4, source: 'Object Detection' }),
      incident({ id: 5, source: 'Browser Webcam' }),
      incident({ id: 6, source: 'Uploaded Video' }),
      incident({ id: 7, source: 'SecurePi Edge Node' }),
    ]);

    // 2 Manual, 1 FR, and the remaining 4 (Object Detection + Browser Webcam +
    // Uploaded Video + SecurePi Edge Node) all bucket into Object Detection.
    expect(await screen.findByText('Manual (2)')).toBeTruthy();
    expect(screen.getByText('Facial Recognition (1)')).toBeTruthy();
    expect(screen.getByText('Object Detection (4)')).toBeTruthy();

    // The 3 segments must always sum to the full incident count.
    expect(screen.getByLabelText(
      'Incident source breakdown: 2 manual, 1 facial recognition, 4 object detection.'
    )).toBeTruthy();
  });

  test('renders an empty state (all zero) without crashing when there are no incidents', async () => {
    mount([]);
    expect(await screen.findByText('Manual (0)')).toBeTruthy();
    expect(screen.getByText('Facial Recognition (0)')).toBeTruthy();
    expect(screen.getByText('Object Detection (0)')).toBeTruthy();
  });

  test('recomputes to the currently applied filters, same scope as the stats cards', async () => {
    mount([
      incident({ id: 1, source: 'Manual', severity: 'Critical' }),
      incident({ id: 2, source: 'Manual', severity: 'Low' }),
      incident({ id: 3, source: 'Facial Recognition', severity: 'Critical' }),
      incident({ id: 4, source: 'Object Detection', severity: 'Low' }),
    ]);

    // Unfiltered baseline: 2 Manual, 1 FR, 1 OD.
    expect(await screen.findByText('Manual (2)')).toBeTruthy();

    // Filter down to Severity = Critical (1 Manual, 1 FR, 0 OD) — the split-bar
    // must follow the filter bar, not keep showing the full unfiltered dataset.
    fireEvent.change(screen.getByLabelText('Filter by severity'), { target: { value: 'Critical' } });

    expect(await screen.findByText('Manual (1)')).toBeTruthy();
    expect(screen.getByText('Facial Recognition (1)')).toBeTruthy();
    expect(screen.getByText('Object Detection (0)')).toBeTruthy();
    expect(screen.getByLabelText(
      'Incident source breakdown: 1 manual, 1 facial recognition, 0 object detection.'
    )).toBeTruthy();
  });
});
