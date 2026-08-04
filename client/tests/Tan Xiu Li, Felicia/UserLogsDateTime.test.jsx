// Frontend tests — Activity Log DATE + TIME (§7).
// Every personnel activity-log row must show both a Singapore-time DATE and TIME,
// preferring the authoritative persisted instant (occurredAt → createdAt) and
// only falling back to the legacy time-only string — never concatenating today's
// date onto a historical time, and always with a safe "Not recorded" fallback.
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { vi, describe, test, expect, beforeEach } from 'vitest';

vi.mock('../../src/components/Sidebar', () => ({ default: () => <div data-testid="sidebar" /> }));

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('axios', () => ({ default: { get: mockGet } }));

import UserLogs from '../../src/pages/UserLogs';

const LOGS = [
  // occurredAt present → wins over createdAt (a very different date).
  { id: 'a-1111-b', type: 'Gantry Access', severity: 'safe', occurredAt: '2026-08-04T07:47:40+08:00', createdAt: '2025-01-01T00:00:00+08:00', time: '01:01:01 am' },
  // no occurredAt → createdAt fallback.
  { id: 'b-2222-c', type: 'Gantry Access', severity: 'safe', createdAt: '2026-08-03T22:05:00+08:00', time: 'stale-legacy' },
  // neither timestamp → legacy time-only string is kept, date is Not recorded.
  { id: 'c-3333-d', type: 'Intrusion Alert', severity: 'critical', time: '09:15:00 am' },
  // nothing at all → both Not recorded (safe fallback).
  { id: 'd-4444-e', type: 'Gantry Access', severity: 'safe' },
];

const renderLogs = async (logs = LOGS) => {
  localStorage.setItem('accessToken', 'test-token');
  mockGet.mockResolvedValueOnce({ data: { personnelName: 'Test Staff', logs } });
  render(
    <MemoryRouter initialEntries={['/personnel/5/logs']}>
      <Routes>
        <Route path="/personnel/:id/logs" element={<UserLogs />} />
      </Routes>
    </MemoryRouter>
  );
  await waitFor(() => expect(mockGet).toHaveBeenCalled());
  await screen.findByText('Test Staff', { exact: false });
};

beforeEach(() => { mockGet.mockReset(); localStorage.clear(); });

describe('Activity Log DATE + TIME', () => {
  test('renders both a DATE and a TIME column header', async () => {
    await renderLogs();
    expect(screen.getByRole('columnheader', { name: 'DATE' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'TIME' })).toBeTruthy();
  });

  test('occurredAt is preferred over createdAt for both date and time', async () => {
    await renderLogs();
    expect(screen.getByText('04 Aug 2026')).toBeTruthy();
    expect(screen.getByText(/07:47:40/i)).toBeTruthy();
    // The (much older) createdAt on that row must NOT be shown.
    expect(screen.queryByText('01 Jan 2025')).toBeNull();
  });

  test('createdAt is used when occurredAt is absent', async () => {
    await renderLogs();
    expect(screen.getByText('03 Aug 2026')).toBeTruthy();
    expect(screen.getByText(/10:05:00/i)).toBeTruthy();
    // The legacy time string is NOT used when a real instant exists.
    expect(screen.queryByText('stale-legacy')).toBeNull();
  });

  test('legacy time-only string is kept safely with a Not recorded date', async () => {
    await renderLogs();
    const legacyTime = screen.getByText('09:15:00 am');
    const row = legacyTime.closest('tr');
    expect(within(row).getByText('Not recorded')).toBeTruthy();
  });

  test('a row with no timestamp shows Not recorded for both date and time', async () => {
    await renderLogs([{ id: 'z-9999-z', type: 'Gantry Access', severity: 'safe' }]);
    const notRecorded = screen.getAllByText('Not recorded');
    expect(notRecorded.length).toBe(2);
  });
});
