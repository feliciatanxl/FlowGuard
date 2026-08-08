// Frontend test — "Escalate to Ticket" row action on the Incident Dashboard.
// Clicking the button opens a confirmation modal pre-filled with the incident's
// ID/location/source/severity/description; confirming calls the real Support
// Ticket API (POST /api/support/tickets — Module 3), mapping incident severity
// to ticket priority and tagging the ticket category "Security".
import { render, screen, fireEvent } from '@testing-library/react';
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

beforeEach(() => {
  mockGet.mockReset(); mockPost.mockReset(); mockPatch.mockReset(); mockDelete.mockReset();
  localStorage.clear();
});

describe('Incident Dashboard — Escalate to Ticket', () => {
  test('opens a confirmation modal pre-filled with ID, location, source, severity, and description', async () => {
    mount([incident()]);
    await screen.findByText('Cold Store B');

    fireEvent.click(screen.getByRole('button', { name: 'Escalate to Ticket' }));

    expect(await screen.findByText('Escalate to Support Ticket?')).toBeTruthy();
    expect(screen.getByText('#42')).toBeTruthy();
    // Location and description both render, and source/severity render inside the
    // modal specifically (not just picked up from the table row behind it).
    const modal = screen.getByText('Escalate to Support Ticket?').closest('.inc-detail-modal');
    expect(modal).toBeTruthy();
    expect(modal.textContent).toContain('Cold Store B');
    expect(modal.textContent).toContain('Face ID'); // sourceLabel('Facial Recognition')
    expect(modal.textContent).toContain('High');
    expect(modal.textContent).toContain('Unrecognised individual near restricted freezer entrance.');
  });

  test('falls back to a placeholder when the incident has no notes', async () => {
    mount([incident({ notes: '' })]);
    await screen.findByText('Cold Store B');
    fireEvent.click(screen.getByRole('button', { name: 'Escalate to Ticket' }));
    expect(await screen.findByText('No description provided.')).toBeTruthy();
  });

  test('Cancel closes the modal without any network call', async () => {
    mount([incident()]);
    await screen.findByText('Cold Store B');
    fireEvent.click(screen.getByRole('button', { name: 'Escalate to Ticket' }));
    await screen.findByText('Escalate to Support Ticket?');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText('Escalate to Support Ticket?')).toBeNull();
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockPatch).not.toHaveBeenCalled();
  });

  test('Confirm Escalation calls POST /api/support/tickets with the mapped priority/category and shows the created ticket id', async () => {
    mockPost.mockResolvedValue({ data: { message: 'Ticket created.', ticket: { id: 'ticket-abcdef123456' } } });
    mount([incident()]); // severity: 'High'
    await screen.findByText('Cold Store B');
    fireEvent.click(screen.getByRole('button', { name: 'Escalate to Ticket' }));
    await screen.findByText('Escalate to Support Ticket?');

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Escalation' }));

    expect(await screen.findByText(/ticket #ticket-a created/i)).toBeTruthy();
    expect(screen.queryByText('Escalate to Support Ticket?')).toBeNull();
    expect(mockPost).toHaveBeenCalledWith(
      '/api/support/tickets',
      expect.objectContaining({ category: 'Security', priority: 'High' }),
      expect.anything()
    );
    expect(mockPatch).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  test('a failed escalation shows an error toast and leaves the modal open for retry', async () => {
    mockPost.mockRejectedValue(new Error('network error'));
    mount([incident()]);
    await screen.findByText('Cold Store B');
    fireEvent.click(screen.getByRole('button', { name: 'Escalate to Ticket' }));
    await screen.findByText('Escalate to Support Ticket?');

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Escalation' }));

    expect(await screen.findByText(/could not create the support ticket/i)).toBeTruthy();
    expect(screen.getByText('Escalate to Support Ticket?')).toBeTruthy(); // still open — nothing to lose on retry
  });
});
