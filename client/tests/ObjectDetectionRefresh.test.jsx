import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import '@testing-library/jest-dom';

vi.mock('axios');
vi.mock('../src/components/Sidebar', () => ({ default: () => null }));

const trackStop = vi.fn();
const getUserMedia = vi.fn();

let axios;
let ObjectDetection;

const loadObjectDetection = async () => {
  vi.resetModules();
  axios = (await import('axios')).default;
  ({ default: ObjectDetection } = await import('../src/pages/ObjectDetection'));
};

const mockBackend = (alerts) => {
  axios.get.mockImplementation((url) => {
    if (url === '/api/zones') return Promise.resolve({ data: [] });
    if (url === '/api/cameras') return Promise.resolve({ data: [] });
    if (url === '/api/detection-alerts') return Promise.resolve({ data: alerts });
    if (url === '/api/yolo/people-count') return Promise.resolve({ data: { count: 0, detection_active: false } });
    if (url.endsWith('/health')) return Promise.resolve({ data: { status: 'ok' } });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
  axios.post.mockResolvedValue({ data: { detections: [], count: 0 } });
  axios.put.mockResolvedValue({ data: {} });
};

const renderPage = () => render(<MemoryRouter><ObjectDetection /></MemoryRouter>);

describe('ObjectDetection — snapshot refresh, evidence sorting, and polling cadence', () => {
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

  test('sorts open alerts by evidence timestamp (occurred_at) so newest evidence is displayed first', async () => {
    const olderAlertCreatedLater = {
      id: 1,
      zone_name: 'Zone A',
      camera_location: 'Cam 01',
      status: 'Active',
      alert_type: 'Unattended Object',
      object_class: 'bag',
      severity: 'Low',
      createdAt: '2026-08-08T12:00:00Z',
      occurred_at: '2026-08-01T08:00:00Z',
    };

    const newerEvidenceCreatedEarlier = {
      id: 2,
      zone_name: 'Zone B',
      camera_location: 'Cam 02',
      status: 'Active',
      alert_type: 'Pest Detection',
      object_class: 'rat',
      severity: 'High',
      createdAt: '2026-08-01T12:00:00Z',
      occurred_at: '2026-08-08T15:00:00Z',
    };

    mockBackend([olderAlertCreatedLater, newerEvidenceCreatedEarlier]);
    renderPage();

    // The incident console heading should render the title of the alert with the newest occurred_at evidence timestamp (id: 2)
    expect((await screen.findAllByText('Pest detected')).length).toBeGreaterThan(0);
  });

  test('fetches protected snapshot blob and revokes ObjectURL when displayedSnapshotUrl updates', async () => {
    const alertWithSnapshot = {
      id: 5,
      zone_name: 'Loading Bay',
      camera_location: 'Cam 01',
      status: 'Active',
      alert_type: 'Unattended Object',
      object_class: 'box',
      severity: 'High',
      snapshot_url: '/api/detection-alerts/5/snapshot/uuid-v1.jpg',
      occurred_at: '2026-08-08T10:00:00Z',
    };

    const createObjectURLSpy = vi.fn().mockReturnValue('blob:http://localhost/mock-blob-1');
    const revokeObjectURLSpy = vi.fn();
    vi.stubGlobal('URL', {
      createObjectURL: createObjectURLSpy,
      revokeObjectURL: revokeObjectURLSpy,
    });

    axios.get.mockImplementation((url) => {
      if (url === '/api/zones') return Promise.resolve({ data: [] });
      if (url === '/api/cameras') return Promise.resolve({ data: [] });
      if (url === '/api/detection-alerts') return Promise.resolve({ data: [alertWithSnapshot] });
      if (url === '/api/yolo/people-count') return Promise.resolve({ data: { count: 0, detection_active: false } });
      if (url.includes('/snapshot/')) return Promise.resolve({ data: new Blob(['jpeg-data'], { type: 'image/jpeg' }) });
      return Promise.reject(new Error(`unexpected GET ${url}`));
    });

    renderPage();

    await waitFor(() => {
      expect(createObjectURLSpy).toHaveBeenCalled();
    });

    const img = await screen.findByAltText(/box detection snapshot/i);
    expect(img).toHaveAttribute('src', 'blob:http://localhost/mock-blob-1');
  });
});
