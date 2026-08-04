import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi, describe, test, expect, beforeEach } from 'vitest';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('axios', () => ({ default: { get: mockGet } }));

import Attendance from '../../src/pages/Attendance';

const responses = {
  FM: {
    role: 'FM',
    summary: { peopleOnSite: 3, checkedInToday: 8, checkedOutToday: 5 },
    currentOccupancy: [
      { userId: 1, person: 'FM Occupant', role: 'FM', currentStatus: 'IN', checkInTime: '2026-07-10T00:10:00.000Z', lastAccessEventTime: '2026-07-10T00:10:00.000Z' },
      { userId: 2, person: 'Tenant Occupant', role: 'Tenant', currentStatus: 'IN', checkInTime: '2026-07-10T00:20:00.000Z', lastAccessEventTime: '2026-07-10T00:20:00.000Z' },
      { userId: 3, person: 'Staff Occupant', role: 'Staff', currentStatus: 'IN', checkInTime: '2026-07-10T00:30:00.000Z', lastAccessEventTime: '2026-07-10T00:31:00.000Z' }
    ],
    records: [
      { userId: 3, user: { name: 'Staff Occupant', role: 'Staff' }, date: '2026-07-10', firstCheckIn: '2026-07-10T00:30:00.000Z', latestCheckOut: null, currentStatus: 'IN' },
      { userId: 4, user: { name: 'Checked Out Staff', role: 'Staff' }, date: '2026-07-10', firstCheckIn: '2026-07-10T00:40:00.000Z', latestCheckOut: '2026-07-10T09:00:00.000Z', currentStatus: 'OUT' }
    ]
  },
  Tenant: {
    role: 'Tenant',
    summary: { staffOnSite: 2, onTimeToday: 4, lateToday: 1 },
    records: [{ userId: 10, user: { name: 'Linked Staff', role: 'Staff' }, date: '2026-07-10', firstCheckIn: '2026-07-10T00:30:00.000Z', latestCheckOut: '2026-07-10T09:00:00.000Z', currentStatus: 'OUT', punctuality: 'ON_TIME' }]
  },
  Staff: {
    role: 'Staff',
    summary: { currentStatus: 'IN', firstCheckIn: '2026-07-10T00:30:00.000Z', latestCheckOut: null, punctuality: 'ON_TIME' },
    records: [{ userId: 60, user: { name: 'Me', role: 'Staff' }, date: '2026-07-10', firstCheckIn: '2026-07-10T00:30:00.000Z', latestCheckOut: null, currentStatus: 'IN', punctuality: 'ON_TIME' }]
  }
};

const renderAs = async (role) => {
  localStorage.setItem('accessToken', 'test-token');
  localStorage.setItem('userRole', role);
  mockGet.mockResolvedValueOnce({ data: responses[role] });
  render(<MemoryRouter><Attendance /></MemoryRouter>);
  await waitFor(() => expect(mockGet).toHaveBeenCalled());
};

beforeEach(() => { mockGet.mockReset(); localStorage.clear(); });

describe('Daily Attendance - Phase 2 role-aware summaries', () => {
  test('FM sees all-role current occupancy with a count matching People On Site', async () => {
    await renderAs('FM');
    expect(await screen.findByText('Workforce Attendance Management')).toBeTruthy();
    expect(screen.getByText('People On Site')).toBeTruthy();
    expect(screen.getByText('Checked In Today')).toBeTruthy();
    expect(screen.getByText('Checked Out Today')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Currently On Site' })).toBeTruthy();
    expect(screen.getByText('FM Occupant')).toBeTruthy();
    expect(screen.getByText('Tenant Occupant')).toBeTruthy();
    expect(screen.getAllByText('Staff Occupant')).toHaveLength(2);
    expect(screen.getByLabelText('3 people currently on site')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Attendance Activity' })).toBeTruthy();
    const roster = document.querySelector('.attendance-roster-table');
    const activity = document.querySelector('.attendance-activity-table');
    expect(within(roster).queryByText('Checked Out Staff')).toBeNull();
    expect(within(activity).getByText('Checked Out Staff')).toBeTruthy();
    expect(within(activity).getByText('Off Site')).toBeTruthy();
    expect(within(activity).getAllByText('10 Jul 2026')).toHaveLength(2);
    expect(within(activity).getByText('10 Jul 2026, 8:30 AM')).toBeTruthy();
    expect(screen.getByText(/Individual lateness analytics/i)).toBeTruthy();
    expect(screen.queryByText('Late Exceptions')).toBeNull();
  });

  test('Tenant sees own-Staff cards and detailed linked Staff table', async () => {
    await renderAs('Tenant');
    expect(await screen.findByText('Unit Staff Attendance')).toBeTruthy();
    expect(screen.getByText('Staff On Site')).toBeTruthy();
    expect(screen.getByText('Late Exceptions')).toBeTruthy();
    expect(screen.getByText('Linked Staff')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Currently On Site' })).toBeNull();
  });

  test('Staff sees personal status and own history only', async () => {
    await renderAs('Staff');
    expect(await screen.findByText('My Attendance')).toBeTruthy();
    expect(screen.getByText('Current Status')).toBeTruthy();
    expect(screen.getByText('First Check-In')).toBeTruthy();
    expect(screen.getByText('Latest Check-Out')).toBeTruthy();
    expect(screen.queryByText('Staff On Site')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Currently On Site' })).toBeNull();
  });

  test('FM renders a truthful empty roster', async () => {
    localStorage.setItem('accessToken', 'test-token');
    localStorage.setItem('userRole', 'FM');
    mockGet.mockResolvedValueOnce({ data: { role: 'FM', summary: { peopleOnSite: 0, checkedInToday: 0, checkedOutToday: 0 }, currentOccupancy: [], records: [] } });
    render(<MemoryRouter><Attendance /></MemoryRouter>);
    expect(await screen.findByText('No one is currently checked in.')).toBeTruthy();
    expect(screen.getByLabelText('0 people currently on site')).toBeTruthy();
    expect(screen.getByText('No facility attendance activity was recorded for the selected date range.')).toBeTruthy();
  });

  test('calls the role-aware logs API with a date filter', async () => {
    await renderAs('Staff');
    expect(mockGet).toHaveBeenCalledWith('/api/attendance/logs', expect.objectContaining({ params: { filter: 'today' } }));
  });
});
