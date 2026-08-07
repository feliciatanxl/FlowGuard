// Frontend test — "Other / Custom..." incident type on the "Log New Incident" form.
// Selecting it reveals a "Custom Incident Type" text input (capped at 35 chars);
// submitting sends the trimmed, Title-Cased custom text as the incident's `status`
// field instead of the sentinel value. Also covers the View modal rendering any
// detection type (built-in or custom) in Title Case, and the create form's Notes
// textarea no longer being manually resizable.
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi, describe, test, expect, beforeEach } from 'vitest';

const { mockGet, mockPost } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn() }));
vi.mock('axios', () => ({ default: { get: mockGet, post: mockPost, patch: vi.fn(), delete: vi.fn() } }));

import IncidentDashboard from '../../src/pages/IncidentDashboard';

const incident = (overrides = {}) => ({
  id: 1,
  camera_location: 'Cold Store B',
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

const mount = (incidents = []) => {
  localStorage.setItem('accessToken', 't');
  localStorage.setItem('userRole', 'FM');
  mockGet.mockImplementation((url) => {
    if (url.includes('/api/incident')) return Promise.resolve({ data: incidents });
    return Promise.reject(new Error(`Unexpected GET: ${url}`));
  });
  render(<MemoryRouter><IncidentDashboard /></MemoryRouter>);
};

const openCreateModal = async () => {
  fireEvent.click(screen.getByRole('button', { name: '+ Log Incident' }));
  await screen.findByText('Log New Incident');
  return screen.getByText('Log New Incident').closest('.inc-create-modal');
};

beforeEach(() => {
  mockGet.mockReset(); mockPost.mockReset();
  localStorage.clear();
});

describe('Log New Incident — Other / Custom incident type', () => {
  test('the Incident Type dropdown includes "Other / Custom..." at the end', async () => {
    mount();
    const modal = await openCreateModal();
    const options = Array.from(modal.querySelectorAll('select')[0].options).map((o) => o.textContent);
    expect(options[options.length - 1]).toBe('Other / Custom...');
  });

  test('selecting "Other / Custom..." reveals a labeled, capped custom-type input', async () => {
    mount();
    const modal = await openCreateModal();
    const typeSelect = modal.querySelectorAll('select')[0];

    expect(screen.queryByPlaceholderText('e.g., Water Leakage')).toBeNull();

    fireEvent.change(typeSelect, { target: { value: 'OTHER_CUSTOM' } });

    const customInput = await screen.findByPlaceholderText('e.g., Water Leakage');
    expect(screen.getByText('Custom Incident Type')).toBeTruthy();
    expect(customInput.maxLength).toBe(35);
    expect(screen.getByText('Max 35 characters.')).toBeTruthy();
  });

  test('switching back to a predefined type hides the custom input again', async () => {
    mount();
    const modal = await openCreateModal();
    const typeSelect = modal.querySelectorAll('select')[0];

    fireEvent.change(typeSelect, { target: { value: 'OTHER_CUSTOM' } });
    await screen.findByPlaceholderText('e.g., Water Leakage');

    fireEvent.change(typeSelect, { target: { value: 'TAILGATING' } });
    expect(screen.queryByPlaceholderText('e.g., Water Leakage')).toBeNull();
  });

  test('submitting with a custom type sends the trimmed, Title-Cased text as status', async () => {
    mockPost.mockResolvedValue({ data: incident({ id: 99, status: 'Water Leakage' }) });
    mount();
    const modal = await openCreateModal();

    fireEvent.change(modal.querySelector('input[placeholder="e.g. Gate A – Main Entrance"]'), { target: { value: 'Loading Bay 3' } });
    fireEvent.change(modal.querySelectorAll('select')[0], { target: { value: 'OTHER_CUSTOM' } });
    const customInput = await screen.findByPlaceholderText('e.g., Water Leakage');
    // Deliberately mis-cased, to prove submission normalises it rather than
    // merely trimming whitespace.
    fireEvent.change(customInput, { target: { value: '  wATER leakAGE  ' } });

    fireEvent.click(screen.getByRole('button', { name: 'Log Incident' }));

    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    expect(mockPost.mock.calls[0][1]).toEqual(expect.objectContaining({ status: 'Water Leakage' }));
  });

  test('submitting a predefined type still sends that type verbatim (regression)', async () => {
    mockPost.mockResolvedValue({ data: incident({ id: 99, status: 'TAILGATING' }) });
    mount();
    const modal = await openCreateModal();

    fireEvent.change(modal.querySelector('input[placeholder="e.g. Gate A – Main Entrance"]'), { target: { value: 'Loading Bay 3' } });
    fireEvent.change(modal.querySelectorAll('select')[0], { target: { value: 'TAILGATING' } });

    fireEvent.click(screen.getByRole('button', { name: 'Log Incident' }));

    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    expect(mockPost.mock.calls[0][1]).toEqual(expect.objectContaining({ status: 'TAILGATING' }));
  });
});

describe('Log New Incident — Notes textarea no longer manually resizable', () => {
  test('the create-form Notes textarea carries the autogrow (no-resize) modifier class', async () => {
    mount();
    await openCreateModal();
    const notes = screen.getByPlaceholderText('Describe the incident...');
    expect(notes.className).toContain('inc-notes-textarea-autogrow');
  });
});

describe('View incident modal — detection type always renders in Title Case', () => {
  test('a custom, oddly-cased detection type is force-rendered in Title Case', async () => {
    mount([incident({ id: 5, status: 'WATER leakage NEAR dock 2' })]);
    await screen.findByText('Cold Store B');
    fireEvent.click(screen.getByRole('button', { name: 'View' }));

    expect(await screen.findByText('Water Leakage Near Dock 2')).toBeTruthy();
    expect(screen.queryByText('WATER leakage NEAR dock 2')).toBeNull();
  });

  test('built-in types still render with underscores turned into spaces', async () => {
    mount([incident({ id: 5, status: 'UNAUTHORIZED_ACCESS' })]);
    await screen.findByText('Cold Store B');
    fireEvent.click(screen.getByRole('button', { name: 'View' }));

    expect(await screen.findByText('Unauthorized Access')).toBeTruthy();
  });
});
