// Frontend tests for the FM Support Dashboard (tickets + knowledge base tabs).
// Includes a regression guard for a real bug found and fixed this project: a
// Pending ticket's status badge and a Medium-priority badge used to render
// with the identical class/colour, making the two columns visually ambiguous.
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi, describe, test, expect, beforeEach } from 'vitest';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('axios', () => ({ default: { get: mockGet, post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));

import SupportDashboard from '../../src/pages/SupportDashboard';

const ticket = (overrides = {}) => ({
  id: '33333333-3333-3333-3333-333333333333',
  tenantName: 'Acme Corp',
  unitNumber: '01-23',
  issueTitle: 'Face scan keeps failing',
  issueDescription: 'Tenant reports repeated failures at the gate scanner.',
  category: 'Access Control',
  priority: 'Medium',
  status: 'Pending',
  isArchived: false,
  resolvedBy: null,
  resolutionNotes: null,
  createdAt: '2026-08-01T00:00:00Z',
  transcript: null,
  ...overrides
});

const defaultStats = { total: 1, highPriority: 0, investigating: 0, resolved: 0 };

const mockRoutes = ({ tickets = [ticket()], stats = defaultStats, kb = [] } = {}) => {
  mockGet.mockImplementation((url) => {
    if (url.includes('/api/support/tickets/stats')) return Promise.resolve({ data: stats });
    if (url.includes('/api/support/tickets')) {
      return Promise.resolve({ data: { tickets, pagination: { page: 1, limit: 10, total: tickets.length, totalPages: 1 } } });
    }
    if (url.includes('/api/support/knowledge')) return Promise.resolve({ data: kb });
    return Promise.reject(new Error(`Unexpected GET: ${url}`));
  });
};

const mount = (opts) => {
  localStorage.setItem('accessToken', 'test-token');
  mockRoutes(opts);
  return render(<MemoryRouter><SupportDashboard /></MemoryRouter>);
};

beforeEach(() => {
  mockGet.mockReset();
  localStorage.clear();
});

describe('SupportDashboard — tickets', () => {
  test('loads and renders a ticket row', async () => {
    mount();
    await waitFor(() => expect(screen.getByText('Face scan keeps failing')).toBeInTheDocument());
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
  });

  test('Pending status badge and Medium priority badge are visually distinct (regression)', async () => {
    const { container } = mount({ tickets: [ticket({ status: 'Pending', priority: 'Medium' })] });
    await waitFor(() => expect(screen.getByText('Face scan keeps failing')).toBeInTheDocument());

    const pendingBadge = container.querySelector('.status-badge.pending');
    const mediumBadge = container.querySelector('.status-badge.medium');
    expect(pendingBadge).toBeTruthy();
    expect(mediumBadge).toBeTruthy();
    expect(pendingBadge.className).not.toBe(mediumBadge.className);
  });

  test('stat cards reflect the real stats response, not placeholders', async () => {
    mount({ stats: { total: 7, highPriority: 3, investigating: 2, resolved: 1 } });
    await waitFor(() => expect(screen.getByText('7')).toBeInTheDocument());
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  test('typing in the search box refetches with a q param and resets to page 1', async () => {
    mount();
    await waitFor(() => expect(screen.getByText('Face scan keeps failing')).toBeInTheDocument());
    mockGet.mockClear();

    fireEvent.change(screen.getByPlaceholderText(/search tenant, unit, or issue/i), { target: { value: 'scan' } });

    await waitFor(() => {
      const called = mockGet.mock.calls.some(([url]) => url.includes('/api/support/tickets?') && url.includes('q=scan'));
      expect(called).toBe(true);
    });
  });

  test('toggling "View Archive" refetches with archived=true', async () => {
    mount();
    await waitFor(() => expect(screen.getByText('Face scan keeps failing')).toBeInTheDocument());
    mockGet.mockClear();

    fireEvent.click(screen.getByRole('button', { name: /view archive/i }));

    await waitFor(() => {
      const called = mockGet.mock.calls.some(([url]) => url.includes('/api/support/tickets?') && url.includes('archived=true'));
      expect(called).toBe(true);
    });
  });

  test('shows an empty state distinct from the loading state when there are no tickets', async () => {
    mount({ tickets: [] });
    await waitFor(() => expect(screen.getByText(/no tickets found/i)).toBeInTheDocument());
  });
});

describe('SupportDashboard — knowledge base tab', () => {
  test('switches tabs and loads knowledge base entries', async () => {
    mount({
      kb: [{ id: 'kb-1', category: 'Access Control', question: 'Why does my face scan fail?', answer: 'Re-enrol in good lighting.', keywords: ['face', 'scan'] }]
    });
    await waitFor(() => expect(screen.getByText('Face scan keeps failing')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /knowledge base/i }));

    await waitFor(() => expect(screen.getByText('Why does my face scan fail?')).toBeInTheDocument());
  });

  test('shows the genuinely-empty message (not the filtered message) when there are no FAQs and no filter is active', async () => {
    mount({ kb: [] });
    await waitFor(() => expect(screen.getByText('Face scan keeps failing')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /knowledge base/i }));

    await waitFor(() => expect(screen.getByText(/no faq entries yet\. add the first one above/i)).toBeInTheDocument());
  });
});
