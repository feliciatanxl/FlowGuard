// Frontend test — "Escalate to Ticket" row action on the Incident Dashboard. Clicking
// it opens a confirmation modal pre-filled with the incident's ID/location/source/
// severity/description; confirming actually POSTs to /api/support/tickets (there is
// no incidentId link on SupportTicket, so the incident's details are folded into the
// ticket's title/description text instead — the same pattern the AI chat
// auto-escalation flow uses for its session id).
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi, describe, test, expect, beforeEach } from 'vitest';

const { mockGet, mockPost, mockPatch, mockDelete } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPost: vi.fn(),
  mockPatch: vi.fn(),
  mockDelete: vi.fn(),
}));
vi.mock('axios', () => ({ default: { get: mockGet, post: mockPost, patch: mockPatch, delete: mockDelete } }));

import IncidentDashboard from '../../src/pages/IncidentDashboard';

const incident = (overrides = {}) => ({
  id: 42,
  camera_location: 'Cold Store B',
  status: 'UNAUTHORIZED_ACCESS',
  person_name: null,
  confidence_score: 0.87,
  severity: 'High',
  source: 'Facial Recognition',
  resolutionStatus: 'Active',
  notes: 'Unrecognised individual near restricted freezer entrance.',
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

const openEscalateModal = async () => {
  await screen.findByText('Cold Store B');
  fireEvent.click(screen.getByRole('button', { name: 'Escalate to Ticket' }));
  await screen.findByText('Escalate to Support Ticket?');
};

beforeEach(() => {
  mockGet.mockReset(); mockPost.mockReset(); mockPatch.mockReset(); mockDelete.mockReset();
  localStorage.clear();
});

describe('Incident Dashboard — Escalate to Ticket modal', () => {
  test('opens a confirmation modal pre-filled with ID, location, source, severity, and description', async () => {
    mount([incident()]);
    await openEscalateModal();

    expect(screen.getByText('#42')).toBeTruthy();
    const modal = screen.getByText('Escalate to Support Ticket?').closest('.inc-detail-modal');
    expect(modal).toBeTruthy();
    expect(modal.textContent).toContain('Cold Store B');
    expect(modal.textContent).toContain('Face ID'); // sourceLabel('Facial Recognition')
    expect(modal.textContent).toContain('High');
    expect(modal.textContent).toContain('Unrecognised individual near restricted freezer entrance.');
  });

  test('falls back to a placeholder when the incident has no notes', async () => {
    mount([incident({ notes: '' })]);
    await openEscalateModal();
    expect(screen.getByText('No description provided.')).toBeTruthy();
  });

  test('no longer shows the "not yet connected" disclaimer now that submission is wired up', async () => {
    mount([incident()]);
    await openEscalateModal();
    expect(screen.queryByText(/not yet connected/i)).toBeNull();
  });

  test('Cancel closes the modal without any network call', async () => {
    mount([incident()]);
    await openEscalateModal();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText('Escalate to Support Ticket?')).toBeNull();
    expect(mockPost).not.toHaveBeenCalled();
  });
});

describe('Incident Dashboard — Escalate to Ticket real submission', () => {
  test('Confirm Escalation POSTs to /api/support/tickets with the incident folded into the ticket text', async () => {
    mockPost.mockResolvedValue({ data: { message: 'Ticket created.', ticket: { id: 'abcdef12-3456-7890-abcd-ef1234567890' } } });
    mount([incident()]);
    await openEscalateModal();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Escalation' }));

    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    const [url, body, config] = mockPost.mock.calls[0];
    expect(url).toBe('/api/support/tickets');
    expect(body.issueTitle).toContain('42');
    expect(body.issueTitle).toContain('Cold Store B');
    expect(body.issueDescription).toContain('Cold Store B');
    expect(body.issueDescription).toContain('Face ID');
    expect(body.issueDescription).toContain('High');
    expect(body.issueDescription).toContain('Unrecognised individual near restricted freezer entrance.');
    expect(body.category).toBe('Security');
    expect(body.priority).toBe('High'); // severity 'High' -> ticket priority 'High'
    expect(config.headers).toEqual({ Authorization: 'Bearer t' });

    // Modal closes and a success toast (naming the created ticket) appears.
    expect(screen.queryByText('Escalate to Support Ticket?')).toBeNull();
    expect(await screen.findByText(/escalated to Support Ticket #ABCDEF12/i)).toBeTruthy();
  });

  test('Critical severity maps to High ticket priority (tickets have no Critical tier)', async () => {
    mockPost.mockResolvedValue({ data: { message: 'Ticket created.', ticket: { id: 'x' } } });
    mount([incident({ severity: 'Critical' })]);
    await openEscalateModal();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Escalation' }));

    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    expect(mockPost.mock.calls[0][1].priority).toBe('High');
  });

  test('disables Cancel/Confirm and shows "Escalating..." while the request is in flight', async () => {
    let resolvePost;
    mockPost.mockReturnValue(new Promise((resolve) => { resolvePost = resolve; }));
    mount([incident()]);
    await openEscalateModal();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Escalation' }));

    expect(await screen.findByRole('button', { name: 'Escalating...' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Escalating...' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Cancel' }).disabled).toBe(true);

    resolvePost({ data: { message: 'Ticket created.', ticket: { id: 'x' } } });
    await waitFor(() => expect(screen.queryByText('Escalate to Support Ticket?')).toBeNull());
  });

  test('shows an error toast and keeps the modal open when the request fails', async () => {
    mockPost.mockRejectedValue(new Error('network down'));
    mount([incident()]);
    await openEscalateModal();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Escalation' }));

    expect(await screen.findByText(/Failed to escalate incident/i)).toBeTruthy();
    // Modal stays open so the FM can retry without re-selecting the incident.
    expect(screen.getByText('Escalate to Support Ticket?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm Escalation' }).disabled).toBe(false);
  });
});
