// Object Detection page — display of SecurePi edge detection alerts (Felicia's
// FlowGuard <- SecurePi integration). Verifies readable titles for the new alert
// types, the WhatsApp notification status, and — critically — that a Raspberry Pi
// LOCAL snapshot path is never rendered as a clickable link while a valid remote
// https URL is. Mirrors the axios/env mocking of the Charlisa ObjectDetection test.
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import '@testing-library/jest-dom';

vi.mock('axios');
vi.mock('../../src/components/Sidebar', () => ({ default: () => null }));

const trackStop = vi.fn();
const getUserMedia = vi.fn();

let axios;
let ObjectDetection;

const loadObjectDetection = async () => {
  vi.resetModules();
  axios = (await import('axios')).default;
  ({ default: ObjectDetection } = await import('../../src/pages/ObjectDetection'));
};

const mockBackend = (alerts) => {
  axios.get.mockImplementation((url) => {
    if (url === '/api/zones') return Promise.resolve({ data: [] });
    if (url === '/api/cameras') return Promise.resolve({ data: [] });
    if (url === '/api/detection-alerts') return Promise.resolve({ data: alerts });
    if (url === '/api/yolo/people-count') return Promise.resolve({ data: { count: 0, detection_active: false } });
    if (url.endsWith('/health')) return Promise.resolve({ data: { status: 'ok' } });
    if (url.endsWith('/people-count')) return Promise.reject(new Error('not reachable'));
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
  axios.post.mockResolvedValue({ data: { detections: [], count: 0 } });
  axios.put.mockResolvedValue({ data: {} });
};

const renderPage = () => render(<MemoryRouter><ObjectDetection /></MemoryRouter>);

const pestAlertLocalSnapshot = {
  id: 101,
  zone_name: 'Kitchen',
  camera_location: 'Kitchen Camera 01',
  status: 'Active',
  alert_type: 'Pest Detection',
  object_class: 'rat',
  severity: 'High',
  source: 'SecurePi Edge Node',
  confidence: 0.92,
  device_id: 'securepi-kitchen-01',
  // A Raspberry Pi LOCAL path — must NOT become a link.
  snapshot_url: 'runtime/snapshots/kitchen/pest_rat_4.jpg',
  whatsapp_status: 'Simulated',
  occurred_at: '2026-07-29T08:46:00Z',
};

const unattendedAlertRemoteSnapshot = {
  id: 102,
  zone_name: 'Lobby',
  camera_location: 'Lobby Camera 01',
  status: 'Active',
  alert_type: 'Unattended Object',
  object_class: 'backpack',
  severity: 'High',
  source: 'SecurePi Edge Node',
  confidence: 0.88,
  duration_seconds: 35,
  device_id: 'securepi-lobby-01',
  snapshot_url: 'https://cdn.example.com/alerts/bag12.jpg',
  whatsapp_status: 'Sent',
  occurred_at: '2026-07-29T08:46:00Z',
};

const restrictedMotionAlert = {
  id: 103,
  zone_name: 'Chemical Storage',
  camera_location: 'Chemical Storage Camera 01',
  status: 'Active',
  alert_type: 'Restricted-Zone Motion',
  severity: 'High',
  source: 'SecurePi Edge Node',
  whatsapp_status: 'Failed',
  occurred_at: '2026-07-29T22:10:00Z',
};

beforeEach(async () => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv('VITE_SECUREPI_STREAM_URL', '');
  vi.stubEnv('VITE_SECUREPI_HEALTH_URL', '');
  getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: trackStop }] });
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
  await loadObjectDetection();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Object Detection — edge alert display', () => {
  test('renders a readable Pest title and does NOT link a local snapshot path', async () => {
    mockBackend([pestAlertLocalSnapshot]);
    renderPage();

    // Readable pest title (appears in the alert list + incident console heading).
    expect(await screen.findAllByText('Pest detected')).not.toHaveLength(0);

    // WhatsApp notification status is surfaced.
    expect(await screen.findByText(/WhatsApp: Simulated/i)).toBeInTheDocument();

    // The local Pi path is acknowledged as a note — NOT as a clickable link.
    expect(screen.getByText(/captured on the edge device/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /view edge snapshot/i })).toBeNull();
    // Belt and braces: no anchor anywhere carries the raw local path as an href.
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    expect(anchors.some((a) => a.getAttribute('href').includes('runtime/snapshots'))).toBe(false);
  });

  test('renders a valid remote https snapshot as a safe link', async () => {
    mockBackend([unattendedAlertRemoteSnapshot]);
    renderPage();

    const link = await screen.findByRole('link', { name: /view edge snapshot/i });
    expect(link).toHaveAttribute('href', 'https://cdn.example.com/alerts/bag12.jpg');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'));

    // Unattended title + WhatsApp Sent status shown.
    expect(await screen.findAllByText('Unattended pallet/object detected')).not.toHaveLength(0);
    expect(await screen.findByText(/WhatsApp: Sent/i)).toBeInTheDocument();
  });

  test('renders a readable Restricted-Zone Motion title', async () => {
    mockBackend([restrictedMotionAlert]);
    renderPage();
    expect(await screen.findAllByText('Restricted-zone motion detected')).not.toHaveLength(0);
    expect(await screen.findByText(/WhatsApp: Failed/i)).toBeInTheDocument();
  });
});
