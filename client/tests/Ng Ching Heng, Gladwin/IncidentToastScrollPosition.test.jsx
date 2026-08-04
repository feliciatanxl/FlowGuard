// Frontend test — the Incident Dashboard's toast stack repositions to a fixed
// top-right panel once the incident table's top edge has scrolled out of view
// (so status updates aren't missed further down a long list), and reverts to its
// normal in-flow position above the table once scrolled back up. Only one toast
// stack element is ever rendered at a time — never both simultaneously.
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('axios', () => ({ default: { get: mockGet, post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));

import IncidentDashboard from '../../src/pages/IncidentDashboard';

// jsdom never lays elements out, so getBoundingClientRect() always returns
// zeros — stub it to move just the table wrapper relative to the scroll
// container (.dashboard-main), mirroring what real scrolling would produce.
let tableTop = 200; // starts below the container's top edge (0) -> visible
const zeroRect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };

beforeEach(() => {
  tableTop = 200;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function stub() {
    if (this.classList.contains('inc-table-wrap')) return { ...zeroRect, top: tableTop };
    if (this.classList.contains('dashboard-main')) return { ...zeroRect, top: 0 };
    return zeroRect;
  });
  mockGet.mockReset();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const mount = () => {
  localStorage.setItem('accessToken', 't');
  localStorage.setItem('userRole', 'FM');
  // The GET rejection is the simplest existing path that fires a toast on mount.
  mockGet.mockRejectedValue(new Error('network down'));
  render(<MemoryRouter><IncidentDashboard /></MemoryRouter>);
};

describe('Incident Dashboard — toast follows table scroll position', () => {
  test('renders in-flow (not floating) while the table top is visible', async () => {
    mount();
    const toast = await screen.findByText('Failed to load incidents from server.');
    const stack = toast.closest('.inc-toast-stack');
    expect(stack.className).not.toContain('inc-toast-stack-floating');
  });

  test('switches to the floating top-right position once the table top scrolls out of view', async () => {
    mount();
    const toast = await screen.findByText('Failed to load incidents from server.');
    expect(toast.closest('.inc-toast-stack').className).not.toContain('inc-toast-stack-floating');

    tableTop = -50; // table's top edge has scrolled above the container's top
    fireEvent.scroll(document.querySelector('.dashboard-main'));

    await waitFor(() => {
      expect(screen.getByText('Failed to load incidents from server.').closest('.inc-toast-stack').className)
        .toContain('inc-toast-stack-floating');
    });
    // Never both at once.
    expect(document.querySelectorAll('.inc-toast-stack')).toHaveLength(1);
  });

  test('reverts to in-flow once scrolled back so the table top is visible again', async () => {
    mount();
    await screen.findByText('Failed to load incidents from server.');

    tableTop = -50;
    fireEvent.scroll(document.querySelector('.dashboard-main'));
    await waitFor(() => {
      expect(screen.getByText('Failed to load incidents from server.').closest('.inc-toast-stack').className)
        .toContain('inc-toast-stack-floating');
    });

    tableTop = 200;
    fireEvent.scroll(document.querySelector('.dashboard-main'));
    await waitFor(() => {
      expect(screen.getByText('Failed to load incidents from server.').closest('.inc-toast-stack').className)
        .not.toContain('inc-toast-stack-floating');
    });
  });
});
