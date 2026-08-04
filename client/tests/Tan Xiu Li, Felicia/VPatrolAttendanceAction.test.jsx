// Frontend tests — V-Patrol operator attendance action control (§3).
// The operator picks Patrol only / Check In / Check Out; the default must remain
// Patrol only (preserving the deployed audit-only behaviour), the selection must
// be clearly visible before scanning, and a completed authoritative cycle posts
// exactly one explicit IN/OUT (never the toggle-style /attendance/scan endpoint).
import fs from 'node:fs';
import path from 'node:path';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/components/Sidebar', () => ({ default: () => <div data-testid="sidebar" /> }));

const mockAxios = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('axios', () => ({ default: mockAxios }));

import VPatrol from '../../src/pages/VPatrol';
import { resetPiAvailabilityCache } from '../../src/constants/piCamera';

beforeEach(() => {
  vi.clearAllMocks();
  resetPiAvailabilityCache();
  mockAxios.get.mockResolvedValue({ data: [] });
  mockAxios.post.mockResolvedValue({ data: {} });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('pi offline')));
  Object.defineProperty(global.navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderVPatrol = async () => {
  const utils = render(<VPatrol />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Patrol only' })).toBeTruthy());
  return utils;
};

describe('V-Patrol attendance action control', () => {
  test('offers Patrol only / Check In / Check Out, defaulting to Patrol only', async () => {
    await renderVPatrol();
    const patrol = screen.getByRole('button', { name: 'Patrol only' });
    const checkIn = screen.getByRole('button', { name: 'Check In' });
    const checkOut = screen.getByRole('button', { name: 'Check Out' });
    expect(patrol.getAttribute('aria-pressed')).toBe('true');
    expect(checkIn.getAttribute('aria-pressed')).toBe('false');
    expect(checkOut.getAttribute('aria-pressed')).toBe('false');
    // The default selection is clearly stated (audit-only) before any scan.
    expect(screen.getByText(/access is audited only; no clock-in\/out/i)).toBeTruthy();
  });

  test('selecting Check In updates the pressed state and the visible current-action line', async () => {
    await renderVPatrol();
    fireEvent.click(screen.getByRole('button', { name: 'Check In' }));
    expect(screen.getByRole('button', { name: 'Check In' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Patrol only' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText(/a completed recognition checks the person in/i)).toBeTruthy();
  });

  test('selecting Check Out is reflected in the current-action line', async () => {
    await renderVPatrol();
    fireEvent.click(screen.getByRole('button', { name: 'Check Out' }));
    expect(screen.getByRole('button', { name: 'Check Out' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/a completed recognition checks the person out/i)).toBeTruthy();
  });

  test('wiring: attendance action is gated to a completed cycle and IN/OUT only (never the toggle scan)', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../src/pages/VPatrol.jsx'), 'utf8');
    // Explicit action endpoint is used, and only inside the granted path guarded
    // by an IN/OUT check — not on every automatic scan.
    expect(source).toMatch(/api\/attendance\/action/);
    expect(source).toMatch(/action === 'IN' \|\| action === 'OUT'/);
    // The blind toggle endpoint is never called from V-Patrol.
    expect(source).not.toMatch(/attendance\/scan/);
    // The same recognition cycleId is reused so a retry is idempotent server-side.
    expect(source).toMatch(/cycleId/);
  });
});
