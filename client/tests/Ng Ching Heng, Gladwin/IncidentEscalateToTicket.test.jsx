// Frontend test — "Escalate to Ticket" row action on the Incident Dashboard. Clicking
// it opens a confirmation modal pre-filled with the incident's ID/location/source/
// severity/description. Confirming POSTs only { sourceIncidentId } to
// /api/support/tickets — the server loads the incident itself and composes the
// ticket's title/description (SupportTicket has no incidentId FK; it dedupes on a
// stable title behind a Postgres advisory lock keyed on the incident id), so a
// repeated escalation of the same incident reuses the existing ticket instead of
// creating a second one.
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
  mockPost.mockResolvedValue({ data: { duplicate: false, ticket: { id: 'ticket-1' } } });
  localStorage.clear();
});

describe('Incident Dashboard — Escalate to Support Ticket modal', () => {
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

  test('is an accessible dialog', async () => {
    mount([incident()]);
    await openEscalateModal();
    expect(screen.getByRole('dialog', { name: /Escalate incident to Support Tickets/i })).toBeTruthy();
  });

  test('falls back to a placeholder when the incident has no notes', async () => {
    mount([incident({ notes: '' })]);
    await openEscalateModal();
    expect(screen.getByText('No description provided.')).toBeTruthy();
  });

  test('no longer shows the old "not yet connected" disclaimer now that submission is wired up', async () => {
    mount([incident()]);
    await openEscalateModal();
    expect(screen.queryByText(/not yet connected/i)).toBeNull();
    // Replaced with an accurate explanation of the real dedup behavior.
    expect(screen.getByText(/reuses the existing ticket/i)).toBeTruthy();
  });

  test('Cancel closes the modal without any network call', async () => {
    mount([incident()]);
    await openEscalateModal();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText('Escalate to Support Ticket?')).toBeNull();
    expect(mockPost).not.toHaveBeenCalled();
  });
});

describe('Incident Dashboard — Escalate to Support Ticket real submission', () => {
  test('Confirm Escalation POSTs only sourceIncidentId — the server composes the ticket', async () => {
    mount([incident()]);
    await openEscalateModal();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Escalation' }));

    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    expect(mockPost).toHaveBeenCalledWith(
      '/api/support/tickets',
      { sourceIncidentId: 42 },
      expect.objectContaining({ headers: { Authorization: 'Bearer t' } })
    );
    expect(mockPatch).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();

    expect(screen.queryByText('Escalate to Support Ticket?')).toBeNull();
    expect(await screen.findByText(/Incident #42 escalated to Support Tickets/i)).toBeTruthy();
  });

  test('a repeated escalation reports the existing ticket instead of creating a duplicate', async () => {
    mockPost.mockResolvedValueOnce({ data: { duplicate: true, ticket: { id: 'ticket-1' } } });
    mount([incident()]);
    await openEscalateModal();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Escalation' }));

    expect(await screen.findByText(/already tracked in Support Tickets/i)).toBeTruthy();
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  test('disables Cancel/Confirm and shows "Creating Ticket…" while the request is in flight', async () => {
    let resolvePost;
    mockPost.mockReturnValue(new Promise((resolve) => { resolvePost = resolve; }));
    mount([incident()]);
    await openEscalateModal();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Escalation' }));

    expect(await screen.findByRole('button', { name: 'Creating Ticket…' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Creating Ticket…' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Cancel' }).disabled).toBe(true);

    resolvePost({ data: { duplicate: false, ticket: { id: 'x' } } });
    await waitFor(() => expect(screen.queryByText('Escalate to Support Ticket?')).toBeNull());
  });

  test('shows the server-provided error message and keeps the modal open on failure', async () => {
    mockPost.mockRejectedValue({ response: { data: { error: 'Incident not found.' } } });
    mount([incident()]);
    await openEscalateModal();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Escalation' }));

    expect(await screen.findByText('Incident not found.')).toBeTruthy();
    // Modal stays open so the FM can retry without re-selecting the incident.
    expect(screen.getByText('Escalate to Support Ticket?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm Escalation' }).disabled).toBe(false);
  });

  test('falls back to a generic error message when the server gives no error detail', async () => {
    mockPost.mockRejectedValue(new Error('network down'));
    mount([incident()]);
    await openEscalateModal();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Escalation' }));

    expect(await screen.findByText(/Failed to escalate incident to Support Tickets/i)).toBeTruthy();
  });
});
