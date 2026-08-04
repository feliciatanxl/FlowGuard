// Object Detection source-control layout regression (§2).
// Locks in that the three source options AND every camera-inventory option stay
// rendered, and that the camera picker keeps the layout contract that stops it
// overflowing the Live Camera Feed card (its own control classes + living inside
// the .od-source-controls row that wraps it to a clean second row when narrow).
// CSS is not computed by jsdom, so the responsive guarantee is asserted through
// the stable class contract the stylesheet keys its wrap/min-width:0 rules on.
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi, describe, test, expect, beforeEach } from 'vitest';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('axios', () => ({ default: { get: mockGet, post: vi.fn() } }));

import ObjectDetection from '../../src/pages/ObjectDetection';

const CAMERAS = [
  { id: 1, camera_code: 'CAM-DOCK-01', camera_name: 'Loading Bay North Overhead Wide-Angle', zone: { zone_name: 'Dock A' } },
  { id: 2, camera_code: 'CAM-GATE-02', camera_name: 'Main Gantry Entrance', zone: { zone_name: 'Gate' } },
  { id: 3, camera_code: 'SECUREPI-IMX500', camera_name: 'Raspberry Pi 5 — Sony IMX500 SecurePi Edge Node', zone: null },
];

const routeData = (url) => {
  if (url.includes('/api/cameras')) return { data: CAMERAS };
  if (url.includes('/api/zones')) return { data: [] };
  if (url.includes('/api/detection-alerts')) return { data: [] };
  if (url.includes('/api/yolo/people-count')) return { data: { count: 0, detection_active: false } };
  return { data: [] };
};

const renderOd = async () => {
  localStorage.setItem('accessToken', 'test-token');
  mockGet.mockImplementation((url) => Promise.resolve(routeData(url)));
  render(<MemoryRouter><ObjectDetection /></MemoryRouter>);
  await waitFor(() => expect(screen.getByRole('option', { name: /CAM-DOCK-01/ })).toBeTruthy());
};

beforeEach(() => { mockGet.mockReset(); localStorage.clear(); });

describe('Object Detection source-control layout (§2)', () => {
  test('all three source options remain rendered', async () => {
    await renderOd();
    const controls = document.querySelector('.od-source-controls');
    expect(controls).toBeTruthy();
    expect(within(controls).getByRole('button', { name: 'Browser Camera' })).toBeTruthy();
    expect(within(controls).getByText('Upload Video')).toBeTruthy();
    expect(within(controls).getByRole('button', { name: /SecurePi Hardware/ })).toBeTruthy();
  });

  test('every camera-inventory option remains available with full untruncated values', async () => {
    await renderOd();
    for (const cam of CAMERAS) {
      const label = `${cam.camera_code} - ${cam.camera_name}`;
      expect(screen.getByRole('option', { name: label })).toBeTruthy();
    }
  });

  test('camera picker keeps the containment layout contract inside the source row', async () => {
    await renderOd();
    const picker = document.querySelector('.od-camera-picker');
    expect(picker).toBeTruthy();
    expect(picker.tagName).toBe('SELECT');
    // The native select stays functional (not disabled) and keyboard-labelled.
    expect(picker.disabled).toBe(false);
    // The picker lives inside the wrapping source-control row — the layout hook
    // the stylesheet uses to drop it to its own full-width row when space is tight.
    const controls = document.querySelector('.od-source-controls');
    expect(controls.contains(picker)).toBe(true);
  });
});
