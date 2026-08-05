import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import axios from 'axios';

// Keep the render light + deterministic: mock the heavy children and the router so the
// test only exercises Dashboard's live-polling data flow.
vi.mock('axios');
vi.mock('../components/Sidebar', () => ({ default: () => <div data-testid="sidebar" /> }));
vi.mock('../components/SafeMuiIcon', () => ({ default: () => <span /> }));
vi.mock('../components/AlertTrendChart', () => ({ default: () => <div data-testid="trend" /> }));
vi.mock('../components/TopAlertZonesChart', () => ({ default: () => <div data-testid="zones" /> }));
vi.mock('react-router', () => ({
  Link: ({ children }) => <a>{children}</a>,
  useNavigate: () => vi.fn(),
}));

import Dashboard from './Dashboard';

const fmPayload = {
  role: 'FM',
  generatedAt: '2026-08-02T04:00:00.000Z',
  summary: { cameras: {}, attendance: {}, urgentDetectionAlerts: 0 },
  recentHighPriorityAlerts: [],
  analytics: { alertTrend7Days: [], topAlertZones7Days: [] },
  analyticsAvailable: true,
};

const summaryCalls = () =>
  axios.get.mock.calls.filter((c) => String(c[0]).includes('/api/dashboard/summary')).length;

describe('Dashboard live polling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    localStorage.setItem('userRole', 'FM');
    localStorage.setItem('accessToken', 'tok');
    axios.isCancel = () => false;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
    localStorage.clear();
    // Reset any overridden document.hidden getter.
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  });

  it('fetches immediately on mount and polls every 15s while visible', async () => {
    axios.get.mockResolvedValue({ data: fmPayload });
    render(<Dashboard />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(summaryCalls()).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(summaryCalls()).toBe(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(summaryCalls()).toBe(3);
  });

  it('never issues overlapping requests', async () => {
    // A request that never resolves keeps the in-flight guard latched.
    axios.get.mockImplementation(() => new Promise(() => {}));
    render(<Dashboard />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(summaryCalls()).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(45000); });
    expect(summaryCalls()).toBe(1); // still only the first, in-flight request
  });

  it('cleans up polling on unmount (no setInterval leak)', async () => {
    axios.get.mockResolvedValue({ data: fmPayload });
    const { unmount } = render(<Dashboard />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(summaryCalls()).toBe(1);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(summaryCalls()).toBe(1); // nothing polled after unmount
  });

  it('pauses polling while the tab is hidden and refreshes on becoming visible', async () => {
    axios.get.mockResolvedValue({ data: fmPayload });
    render(<Dashboard />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(summaryCalls()).toBe(1);

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(summaryCalls()).toBe(1); // hidden → no polling

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(summaryCalls()).toBe(2); // visible again → immediate refresh
  });

  it('keeps the last good data when a later poll fails (no fake zeroes)', async () => {
    axios.get.mockResolvedValueOnce({ data: fmPayload });
    const { container } = render(<Dashboard />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(container.querySelector('[data-testid="trend"]')).toBeInTheDocument();

    // Next poll fails — the dashboard must NOT blank out; the charts stay rendered.
    axios.get.mockRejectedValueOnce({ message: 'network down' });
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(container.querySelector('[data-testid="trend"]')).toBeInTheDocument();
  });
});
