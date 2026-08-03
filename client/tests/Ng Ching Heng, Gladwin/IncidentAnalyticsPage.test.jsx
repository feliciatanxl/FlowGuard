// Frontend test — the Incident Dashboard's Deep Analytics subpage. Mocks
// GET /api/incident (the same endpoint the main dashboard already uses) and asserts
// all 4 panels render, empty data doesn't crash, and a fetch failure shows the
// unavailable banner — same vi.hoisted/MemoryRouter pattern as DashboardAnalytics.test.jsx.
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi, describe, test, expect, beforeEach } from 'vitest';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('axios', () => ({ default: { get: mockGet } }));

import IncidentAnalytics from '../../src/pages/IncidentAnalytics';

const incident = (overrides = {}) => ({
  id: overrides.id ?? Math.random(),
  source: 'Facial Recognition',
  resolutionStatus: 'Cleared',
  confidence_score: 0.95,
  createdAt: '2026-08-01T09:00:00Z',
  resolvedAt: '2026-08-01T09:14:00Z',
  ...overrides,
});

const mount = (incidents) => {
  localStorage.setItem('accessToken', 't');
  localStorage.setItem('userRole', 'FM');
  mockGet.mockImplementation((url) => {
    if (url.includes('/api/incident')) return Promise.resolve({ data: incidents });
    return Promise.reject(new Error(`Unexpected GET: ${url}`));
  });
  render(<MemoryRouter><IncidentAnalytics /></MemoryRouter>);
};

beforeEach(() => { mockGet.mockReset(); localStorage.clear(); });

describe('Incident Deep Analytics page', () => {
  test('renders all 4 panels with fixture-derived numbers', async () => {
    mount([
      incident({ id: 1, resolutionStatus: 'Cleared', confidence_score: 0.95 }),
      incident({ id: 2, resolutionStatus: 'False Positive', confidence_score: 0.72, resolvedAt: '2026-08-01T09:05:00Z' }),
      incident({ id: 3, source: 'Manual', resolutionStatus: 'Active', confidence_score: null, resolvedAt: null }),
      incident({ id: 4, resolutionStatus: 'Investigating', confidence_score: null, resolvedAt: null }),
    ]);

    expect(await screen.findByText('Avg. Resolution Time')).toBeTruthy();
    expect(screen.getByText('AI Accuracy Rate')).toBeTruthy();
    expect(screen.getByText('AI Confidence vs. Outcome')).toBeTruthy();
    expect(screen.getByText('Escalation & Resolution Funnel')).toBeTruthy();

    // 2 evaluated AI incidents (Cleared + False Positive), 1 false positive -> 50%.
    expect(screen.getByText('50.0%')).toBeTruthy();
    // Funnel stage counts: 1 Active, 1 Investigating, 0 Escalated, 1 Cleared.
    expect(screen.getByLabelText('Active: 1')).toBeTruthy();
    expect(screen.getByLabelText('Investigating: 1')).toBeTruthy();
    expect(screen.getByLabelText('Cleared: 1')).toBeTruthy();
  });

  test('shows empty states without crashing when there are no incidents', async () => {
    mount([]);
    expect(await screen.findByText('Avg. Resolution Time')).toBeTruthy();
    // No resolved incidents -> em-dash, not a crash or "NaN".
    const tiles = screen.getAllByText('—');
    expect(tiles.length).toBeGreaterThan(0);
    expect(screen.getByText(/No adjudicated AI incidents/i)).toBeTruthy();
  });

  test('shows the unavailable banner when the fetch fails', async () => {
    localStorage.setItem('accessToken', 't');
    mockGet.mockImplementation(() => Promise.reject(new Error('network down')));
    render(<MemoryRouter><IncidentAnalytics /></MemoryRouter>);
    expect(await screen.findByText(/Analytics temporarily unavailable/i)).toBeTruthy();
  });
});
