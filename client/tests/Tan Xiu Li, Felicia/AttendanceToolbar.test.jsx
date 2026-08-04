// Frontend tests — Attendance toolbar still exposes the date filter, Refresh and
// (FM-only) Launch Gate Terminal. FMs see the current on-site roster without
// historical attendance or punctuality details.
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi, describe, test, expect, beforeEach } from 'vitest';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('axios', () => ({ default: { get: mockGet } }));

import Attendance from '../../src/pages/Attendance';

const FM_DATA = {
  role: 'FM',
  summary: { peopleOnSite: 1, checkedInToday: 8, checkedOutToday: 3 },
  currentOccupancy: [
    {
      userId: 7,
      person: 'On-Site FM',
      role: 'FM',
      currentStatus: 'IN',
      checkInTime: '2026-07-15T01:00:00Z',
      lastAccessEventTime: '2026-07-15T03:00:00Z',
    },
  ],
  records: [],
};

const TENANT_DATA = {
  role: 'Tenant',
  summary: { staffOnSite: 4, onTimeToday: 3, lateToday: 1 },
  records: [
    {
      userId: 5,
      date: '2026-07-15',
      user: { name: 'Sam Ng' },
      firstCheckIn: '2026-07-15T01:00:00Z',
      latestCheckOut: null,
      currentStatus: 'IN',
      punctuality: 'ON_TIME',
    },
  ],
};

const renderAttendance = () => render(<MemoryRouter><Attendance /></MemoryRouter>);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('accessToken', 'test-token');
  localStorage.setItem('userName', 'Flow Manager');
  mockGet.mockReset();
});

describe('Attendance toolbar (FM)', () => {
  beforeEach(() => {
    localStorage.setItem('userRole', 'FM');
    mockGet.mockResolvedValue({ data: FM_DATA });
  });

  test('exposes the date filter, Refresh and Launch Gate Terminal controls', async () => {
    renderAttendance();
    await waitFor(() => expect(document.querySelector('.attendance-actions')).toBeTruthy());

    const actions = document.querySelector('.attendance-actions');
    expect(actions.querySelector('select[aria-label="Attendance date filter"]')).toBeTruthy();

    const buttons = Array.from(actions.querySelectorAll('button')).map((b) => b.textContent.trim());
    expect(buttons).toContain('Refresh');
    expect(buttons).toContain('Launch Gate Terminal');
  });

  test('FM sees the current roster without historical punctuality details', async () => {
    renderAttendance();
    await waitFor(() => expect(document.body.textContent).toContain('Currently On Site'));

    const roster = document.querySelector('.attendance-roster-table');
    expect(roster).toBeTruthy();
    expect(roster.textContent).toContain('On-Site FM');
    expect(roster.textContent).toContain('ROLE');
    expect(roster.textContent).toContain('CURRENT STATUS');
    expect(roster.textContent).toContain('CHECK-IN');
    expect(roster.textContent).toContain('LAST ACCESS');

    // Historical per-person attendance and punctuality remain hidden from FM.
    expect(document.querySelectorAll('.management-table')).toHaveLength(1);
    expect(document.querySelector('.management-table')).toBe(roster);
    expect(document.body.textContent).not.toContain('PUNCTUALITY');
    expect(document.body.textContent).not.toContain('LATE');
  });
});

describe('Attendance toolbar (Tenant)', () => {
  beforeEach(() => {
    localStorage.setItem('userRole', 'Tenant');
    mockGet.mockResolvedValue({ data: TENANT_DATA });
  });

  test('keeps filter + Refresh, and Launch Gate Terminal stays FM-only', async () => {
    renderAttendance();
    await waitFor(() => expect(document.querySelector('.attendance-actions')).toBeTruthy());

    const actions = document.querySelector('.attendance-actions');
    expect(actions.querySelector('select[aria-label="Attendance date filter"]')).toBeTruthy();
    const buttons = Array.from(actions.querySelectorAll('button')).map((b) => b.textContent.trim());
    expect(buttons).toContain('Refresh');
    expect(buttons).not.toContain('Launch Gate Terminal');
  });

  test('non-FM roles still see their attendance table', async () => {
    renderAttendance();
    await waitFor(() => expect(document.querySelector('.management-table')).toBeTruthy());
    expect(document.body.textContent).toContain('Sam Ng');
  });
});
