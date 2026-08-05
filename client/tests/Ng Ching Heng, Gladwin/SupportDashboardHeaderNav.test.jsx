// Frontend regression test — Support Tickets page header/navigation fixes:
// the page used to be a tabbed "Support Management" page (Support Tickets +
// Knowledge Base tabs) reachable from the main Operations Dashboard. Knowledge
// Base is now its own sidebar page, so this page should be tickets-only, titled
// "Support Tickets", and its back button should return to the Incident
// Dashboard (its only entry point) rather than the main Dashboard.
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi, describe, test, expect, beforeEach } from 'vitest';

const { mockGet, mockNavigate } = vi.hoisted(() => ({ mockGet: vi.fn(), mockNavigate: vi.fn() }));
vi.mock('axios', () => ({ default: { get: mockGet, post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return { ...actual, useNavigate: () => mockNavigate };
});

import SupportDashboard from '../../src/pages/SupportDashboard';

const mount = () => {
  localStorage.setItem('accessToken', 't');
  localStorage.setItem('userRole', 'FM');
  mockGet.mockImplementation((url) => {
    if (url.includes('/api/support/tickets/stats')) {
      return Promise.resolve({ data: { total: 0, highPriority: 0, investigating: 0, resolved: 0 } });
    }
    if (url.includes('/api/support/tickets')) {
      return Promise.resolve({ data: { tickets: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 1 } } });
    }
    return Promise.reject(new Error(`Unexpected GET: ${url}`));
  });
  render(<MemoryRouter><SupportDashboard /></MemoryRouter>);
};

beforeEach(() => { mockGet.mockReset(); mockNavigate.mockReset(); localStorage.clear(); });

describe('Support Tickets page — header and navigation', () => {
  test('is titled "Support Tickets" with a subtitle that does not mention the knowledge base', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'Support Tickets' })).toBeTruthy();
    expect(screen.queryByText(/Support Management/i)).toBeNull();
    expect(screen.queryByText(/knowledge base/i)).toBeNull();
  });

  test('renders no tabber — Knowledge Base is not a tab on this page anymore', async () => {
    mount();
    await screen.findByRole('heading', { name: 'Support Tickets' });
    expect(screen.queryByRole('button', { name: 'Knowledge Base' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Support Tickets' })).toBeNull();
  });

  test('the back button reads "Incident Dashboard" and navigates to /incidents, not /dashboard', async () => {
    mount();
    const backBtn = await screen.findByRole('button', { name: /Incident Dashboard/i });
    expect(screen.queryByRole('button', { name: /^.\s*Dashboard$/i })).toBeNull();

    fireEvent.click(backBtn);
    expect(mockNavigate).toHaveBeenCalledWith('/incidents');
  });
});
