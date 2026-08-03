import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest';

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

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const renderPage = ({ strict = false } = {}) => {
  localStorage.setItem('accessToken', 't');
  localStorage.setItem('userRole', 'FM');
  const page = <MemoryRouter><IncidentAnalytics /></MemoryRouter>;
  return render(strict ? <StrictMode>{page}</StrictMode> : page);
};

beforeEach(() => {
  mockGet.mockReset();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Incident Deep Analytics page', () => {
  test('initial render starts loading and fetches analytics with auth and cancellation support', async () => {
    const request = deferred();
    mockGet.mockReturnValueOnce(request.promise);

    renderPage();

    expect(screen.getByRole('heading', { name: 'Incident Deep Analytics' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Refreshing/i }).disabled).toBe(true);
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));

    const [url, config] = mockGet.mock.calls[0];
    expect(url).toBe('/api/incident');
    expect(config.headers).toEqual({ Authorization: 'Bearer t' });
    expect(config.signal.aborted).toBe(false);

    await act(async () => request.resolve({ data: [] }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' }).disabled).toBe(false));
  });

  test('renders all four panels with fixture-derived numbers', async () => {
    mockGet.mockResolvedValueOnce({
      data: [
        incident({ id: 1, resolutionStatus: 'Cleared', confidence_score: 0.95 }),
        incident({ id: 2, resolutionStatus: 'False Positive', confidence_score: 0.72, resolvedAt: '2026-08-01T09:05:00Z' }),
        incident({ id: 3, source: 'Manual', resolutionStatus: 'Active', confidence_score: null, resolvedAt: null }),
        incident({ id: 4, resolutionStatus: 'Investigating', confidence_score: null, resolvedAt: null }),
      ],
    });

    renderPage();

    expect(await screen.findByText('Avg. Resolution Time')).toBeTruthy();
    expect(screen.getByText('AI Accuracy Rate')).toBeTruthy();
    expect(screen.getByText('AI Confidence vs. Outcome')).toBeTruthy();
    expect(screen.getByText('Escalation & Resolution Funnel')).toBeTruthy();
    expect(screen.getByText('50.0%')).toBeTruthy();
    expect(screen.getByLabelText('Active: 1')).toBeTruthy();
    expect(screen.getByLabelText('Investigating: 1')).toBeTruthy();
    expect(screen.getByLabelText('Cleared: 1')).toBeTruthy();
  });

  test('shows empty analytics without crashing', async () => {
    mockGet.mockResolvedValueOnce({ data: [] });
    renderPage();

    expect(await screen.findByText('Avg. Resolution Time')).toBeTruthy();
    expect(screen.getByText(/No adjudicated AI incidents/i)).toBeTruthy();
    expect(screen.getByText('0 resolved incidents')).toBeTruthy();
  });

  test('keeps loading until a failed request settles and then shows the error state', async () => {
    const request = deferred();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGet.mockReturnValueOnce(request.promise);
    renderPage();

    expect(screen.getByRole('button', { name: /Refreshing/i }).disabled).toBe(true);
    await act(async () => request.reject(new Error('network down')));

    expect(await screen.findByText(/Analytics temporarily unavailable/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refresh' }).disabled).toBe(false);
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to fetch incidents for analytics:',
      expect.objectContaining({ message: 'network down' }),
    );
  });

  test('refresh applies changed status and date results while preserving loading behaviour', async () => {
    const refreshRequest = deferred();
    mockGet
      .mockResolvedValueOnce({
        data: [incident({ id: 1, resolutionStatus: 'Active', resolvedAt: null })],
      })
      .mockReturnValueOnce(refreshRequest.promise);

    renderPage();
    expect(await screen.findByLabelText('Active: 1')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(screen.getByRole('button', { name: /Refreshing/i }).disabled).toBe(true);
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));

    await act(async () => refreshRequest.resolve({
      data: [incident({
        id: 2,
        resolutionStatus: 'Cleared',
        createdAt: '2026-08-02T10:00:00Z',
        resolvedAt: '2026-08-02T10:30:00Z',
      })],
    }));

    await waitFor(() => expect(screen.getByLabelText('Cleared: 1')).toBeTruthy());
    expect(screen.getByLabelText('Active: 0')).toBeTruthy();
    expect(screen.getAllByText('30m').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Refresh' }).disabled).toBe(false);
  });

  test('ignores an older request that resolves after the current request', async () => {
    const staleRequest = deferred();
    const currentRequest = deferred();
    mockGet
      .mockReturnValueOnce(staleRequest.promise)
      .mockReturnValueOnce(currentRequest.promise);

    renderPage({ strict: true });
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
    expect(mockGet.mock.calls[0][1].signal.aborted).toBe(true);

    await act(async () => currentRequest.resolve({
      data: [incident({ id: 2, resolutionStatus: 'Cleared' })],
    }));
    expect(await screen.findByLabelText('Cleared: 1')).toBeTruthy();

    await act(async () => staleRequest.resolve({
      data: [incident({ id: 1, resolutionStatus: 'Active', resolvedAt: null })],
    }));
    expect(screen.getByLabelText('Cleared: 1')).toBeTruthy();
    expect(screen.getByLabelText('Active: 0')).toBeTruthy();
  });

  test('aborts the request on unmount and ignores its later completion', async () => {
    const request = deferred();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGet.mockReturnValueOnce(request.promise);

    const { unmount } = renderPage();
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));
    const signal = mockGet.mock.calls[0][1].signal;

    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => request.resolve({ data: [incident({ id: 1 })] }));
    expect(consoleError).not.toHaveBeenCalled();
  });
});
