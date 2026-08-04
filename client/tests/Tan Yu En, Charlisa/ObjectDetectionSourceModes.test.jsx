// Source-mode behaviour of the Object Detection page:
// SecurePi hardware mode must never touch the browser webcam, and
// browser-camera teardown must stop every MediaStream track.
//
// ObjectDetection.jsx reads VITE_SECUREPI_STREAM_URL/VITE_SECUREPI_HEALTH_URL into a
// top-level const at module-eval time, so these tests must NOT depend on whatever the
// developer's local client/.env happens to set. Each test explicitly stubs the env
// (vi.stubEnv) it needs BEFORE the module is (re-)imported — vi.resetModules() plus a
// dynamic import forces ObjectDetection.jsx (and its `import axios from 'axios'`) to
// re-evaluate against the freshly-stubbed env, and axios/ObjectDetection are re-bound
// together so the test's mock setup and the component always share the same instance.
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import '@testing-library/jest-dom';

vi.mock('axios');
vi.mock('../../src/components/Sidebar', () => ({ default: () => null }));

const SECUREPI_CAMERA = {
  id: 1,
  camera_code: 'CAM-SECUREPI-01',
  camera_name: 'SecurePi IMX500',
  location: 'Loading Bay',
  stream_url: 'http://172.20.10.2:8001/video_feed',
  status: 'Online',
};

const MP4_CAMERA = {
  id: 2,
  camera_code: 'CAM-01',
  camera_name: 'Loading Bay Demo',
  location: 'Loading Bay',
  stream_url: '/videos/loading.mp4',
  status: 'Online',
};

// No stream_url at all — only a VITE_SECUREPI_STREAM_URL env fallback can resolve this one.
const NO_STREAM_CAMERA = {
  id: 3,
  camera_code: 'CAM-03',
  camera_name: 'Unwired Dock Camera',
  location: 'Dock 2',
  stream_url: null,
  status: 'Online',
};

const SECOND_SECUREPI_CAMERA = {
  ...SECUREPI_CAMERA,
  id: 4,
  camera_code: 'CAM-SECUREPI-02',
  camera_name: 'SecurePi Alternate Port',
  stream_url: 'http://securepi-secondary.local:9100/video_feed',
};

const trackStop = vi.fn();
const getUserMedia = vi.fn();
const securePiFetch = vi.fn();
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

let axios;
let ObjectDetection;

// Re-evaluates ObjectDetection.jsx (and axios) against whatever env is currently
// stubbed. Must run AFTER vi.stubEnv/vi.unstubAllEnvs for the stub to take effect.
const loadObjectDetection = async () => {
  vi.resetModules();
  axios = (await import('axios')).default;
  ({ default: ObjectDetection } = await import('../../src/pages/ObjectDetection'));
};

const jsonResponse = (body, ok = true, status = ok ? 200 : 500) => ({
  ok,
  status,
  json: vi.fn().mockResolvedValue(body),
});

const mockBackend = (cameras, options = {}) => {
  const {
    peopleCount = { count: 0, detection_active: false },
    health = { status: 'ok' },
    alerts = [],
  } = options;
  axios.get.mockImplementation((url) => {
    if (url === '/api/zones') return Promise.resolve({ data: [] });
    if (url === '/api/cameras') return Promise.resolve({ data: cameras });
    if (url === '/api/detection-alerts') return Promise.resolve({ data: alerts });
    if (url === '/api/yolo/people-count') return Promise.resolve({ data: { count: 0, detection_active: false } });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
  axios.post.mockResolvedValue({ data: { detections: [], count: 0 } });
  securePiFetch.mockImplementation((url) => {
    if (url.endsWith('/health')) return Promise.resolve(jsonResponse(health));
    if (url.endsWith('/people-count')) return Promise.resolve(jsonResponse(peopleCount));
    return Promise.reject(new Error(`unexpected local fetch ${url}`));
  });
};

const renderPage = () => render(<MemoryRouter><ObjectDetection /></MemoryRouter>);

const healthCalls = () => securePiFetch.mock.calls.filter(([url]) => url.endsWith('/health'));
// SecurePi's own /people-count status route — distinct from the browser-YOLO
// /api/yolo/people-count (Node proxy) polled in camera/file mode.
const securePiPeopleCountCalls = () => securePiFetch.mock.calls.filter(([url]) => url.endsWith('/people-count'));

beforeEach(async () => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  localStorage.clear();
  vi.stubGlobal('fetch', securePiFetch);
  // Deterministic baseline for every test: no SecurePi env fallback configured,
  // regardless of what client/.env sets on the developer's machine. Tests that need a
  // fallback explicitly vi.stubEnv + reload (see 'falls back to VITE_SECUREPI_STREAM_URL...').
  vi.stubEnv('VITE_SECUREPI_STREAM_URL', '');
  vi.stubEnv('VITE_SECUREPI_HEALTH_URL', '');
  getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: trackStop }] });
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  });
  await loadObjectDetection();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('SecurePi Hardware mode', () => {
  test('activates only after the current SecurePi health contract and an MJPEG load, without requiring count or snapshot', async () => {
    mockBackend([SECUREPI_CAMERA]);
    securePiFetch.mockImplementation((url) => {
      if (url.endsWith('/health')) {
        return Promise.resolve(jsonResponse({
          status: 'online',
          camera: 'IMX500',
          streaming: true,
          latest_frame_age_seconds: 0.2,
        }));
      }
      if (url.endsWith('/people-count')) return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.reject(new Error(`unexpected local fetch ${url}`));
    });
    renderPage();

    await screen.findByRole('option', { name: /CAM-SECUREPI-01/ });
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'SecurePi Hardware' }));

    const img = await screen.findByAltText('SecurePi live hardware camera');
    expect(screen.queryByText('Active source: Raspberry Pi 5 — Sony IMX500 SecurePi')).toBeNull();
    expect(screen.getByText('Connecting source: Raspberry Pi 5 — Sony IMX500 SecurePi')).toBeInTheDocument();
    expect(screen.getByText('Not provided by this SecurePi service')).toBeInTheDocument();
    expect(securePiPeopleCountCalls()).toHaveLength(1);
    expect(securePiFetch.mock.calls.some(([url]) => url.endsWith('/snapshot'))).toBe(false);

    fireEvent.load(img);
    expect(await screen.findByText('Active source: Raspberry Pi 5 — Sony IMX500 SecurePi')).toBeInTheDocument();
    expect(axios.post).not.toHaveBeenCalledWith('/api/yolo/analyze-frame', expect.anything(), expect.anything());
    await waitFor(() => expect(trackStop).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Browser Camera' }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'SecurePi Hardware' }));
    await waitFor(() => expect(healthCalls()).toHaveLength(2));
    expect(securePiPeopleCountCalls()).toHaveLength(1);
  });

  test('an MJPEG error activates exactly one laptop fallback camera', async () => {
    mockBackend([SECUREPI_CAMERA]);
    renderPage();

    await screen.findByRole('option', { name: /CAM-SECUREPI-01/ });
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'SecurePi Hardware' }));
    const img = await screen.findByAltText('SecurePi live hardware camera');

    fireEvent.error(img);

    expect(await screen.findByText('SecurePi IMX500 unavailable — using laptop camera fallback')).toBeInTheDocument();
    expect(screen.getByText('Active source: Laptop Webcam')).toBeInTheDocument();
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    expect(screen.queryByAltText('SecurePi live hardware camera')).toBeNull();
    expect(trackStop).toHaveBeenCalledTimes(1);
  });

  test('uses the selected inventory HTTP stream in an <img> and never calls getUserMedia', async () => {
    mockBackend([SECUREPI_CAMERA]);
    renderPage();

    await screen.findByRole('option', { name: /CAM-SECUREPI-01/ });
    getUserMedia.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'SecurePi Hardware' }));

    const img = await screen.findByAltText('SecurePi live hardware camera');
    // No cache-busting query before Reconnect is clicked.
    expect(img).toHaveAttribute('src', 'http://172.20.10.2:8001/video_feed');
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(document.querySelector('video')).toBeNull();
  });

  test('starts health polling on the derived /health URL only in hardware mode', async () => {
    mockBackend([SECUREPI_CAMERA]);
    renderPage();

    await screen.findByRole('option', { name: /CAM-SECUREPI-01/ });
    expect(healthCalls()).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'SecurePi Hardware' }));

    await waitFor(() => expect(healthCalls().length).toBeGreaterThan(0));
    expect(healthCalls()[0][0]).toBe('http://172.20.10.2:8001/health');
  });

  test('treats local MP4 inventory paths as not configured (no VITE fallback set)', async () => {
    mockBackend([MP4_CAMERA]);
    renderPage();

    await screen.findByRole('option', { name: /CAM-01/ });
    fireEvent.click(screen.getByRole('button', { name: 'SecurePi Hardware' }));

    expect(await screen.findByText(/selected camera does not have a valid SecurePi stream URL/)).toBeTruthy();
    expect(screen.getByText('Active source: Laptop Webcam')).toBeTruthy();
    expect(screen.queryByAltText('SecurePi live hardware camera')).toBeNull();
    expect(healthCalls()).toHaveLength(0);
  });

  test('falls back to VITE_SECUREPI_STREAM_URL when the selected camera has no stream_url of its own', async () => {
    vi.stubEnv('VITE_SECUREPI_STREAM_URL', 'http://test-securepi:9000/video_feed');
    vi.stubEnv('VITE_SECUREPI_HEALTH_URL', 'http://test-securepi:9000/health');
    await loadObjectDetection();
    mockBackend([NO_STREAM_CAMERA]);
    renderPage();

    await screen.findByRole('option', { name: /CAM-03/ });
    fireEvent.click(screen.getByRole('button', { name: 'SecurePi Hardware' }));

    const img = await screen.findByAltText('SecurePi live hardware camera');
    expect(img).toHaveAttribute('src', 'http://test-securepi:9000/video_feed');
    await waitFor(() => expect(healthCalls().length).toBeGreaterThan(0));
    expect(healthCalls()[0][0]).toBe('http://test-securepi:9000/health');
  });

  test('failed health keeps the laptop webcam active and explicit Retry SecurePi can connect', async () => {
    mockBackend([SECUREPI_CAMERA]);
    let healthAttempts = 0;
    securePiFetch.mockImplementation((url) => {
      if (url.endsWith('/health')) {
        healthAttempts += 1;
        return healthAttempts === 1
          ? Promise.reject(new TypeError('network unavailable'))
          : Promise.resolve(jsonResponse({ status: 'ok' }));
      }
      if (url.endsWith('/people-count')) return Promise.resolve(jsonResponse({ count: 1, detection_active: true }));
      return Promise.reject(new Error(`unexpected local fetch ${url}`));
    });
    renderPage();

    await screen.findByRole('option', { name: /CAM-SECUREPI-01/ });
    fireEvent.click(screen.getByRole('button', { name: 'SecurePi Hardware' }));

    expect(await screen.findByText('SecurePi IMX500 unavailable — using laptop camera fallback')).toBeTruthy();
    expect(screen.getByText('Active source: Laptop Webcam')).toBeTruthy();
    expect(screen.queryByAltText('SecurePi live hardware camera')).toBeNull();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(securePiPeopleCountCalls()).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Retry SecurePi' }));

    const reconnected = await screen.findByAltText('SecurePi live hardware camera');
    expect(reconnected).toHaveAttribute('src', 'http://172.20.10.2:8001/video_feed');
    fireEvent.load(reconnected);
    expect(screen.getByText('Active source: Raspberry Pi 5 — Sony IMX500 SecurePi')).toBeTruthy();
    await waitFor(() => expect(trackStop).toHaveBeenCalledTimes(1));
  });

  test('a failed Retry SecurePi remains on one laptop webcam without polling people-count', async () => {
    mockBackend([SECUREPI_CAMERA]);
    securePiFetch.mockRejectedValue(new TypeError('network unavailable'));
    renderPage();

    await screen.findByRole('option', { name: /CAM-SECUREPI-01/ });
    fireEvent.click(screen.getByRole('button', { name: 'SecurePi Hardware' }));
    await screen.findByText('SecurePi IMX500 unavailable — using laptop camera fallback');
    fireEvent.click(screen.getByRole('button', { name: 'Retry SecurePi' }));

    await waitFor(() => expect(healthCalls()).toHaveLength(2));
    expect(await screen.findByText('Active source: Laptop Webcam')).toBeTruthy();
    expect(screen.queryByAltText('SecurePi live hardware camera')).toBeNull();
    expect(securePiPeopleCountCalls()).toHaveLength(0);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  test('changing the selected camera aborts the old health probe before count polling', async () => {
    mockBackend([SECUREPI_CAMERA, SECOND_SECUREPI_CAMERA]);
    let oldSignal;
    securePiFetch.mockImplementation((_url, options) => {
      oldSignal = options.signal;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    });
    renderPage();

    await screen.findByRole('option', { name: /CAM-SECUREPI-02/ });
    fireEvent.click(screen.getByRole('button', { name: 'SecurePi Hardware' }));
    await waitFor(() => expect(oldSignal).toBeDefined());
    fireEvent.change(document.querySelector('.od-camera-picker'), { target: { value: '4' } });

    expect(oldSignal.aborted).toBe(true);
    expect(screen.getByText('Active source: Laptop Webcam')).toBeTruthy();
    expect(securePiPeopleCountCalls()).toHaveLength(0);
  });

  test('uses a camera-scoped browser override and leaves Camera Inventory unchanged', async () => {
    mockBackend([SECUREPI_CAMERA]);
    renderPage();
    await screen.findByRole('option', { name: /CAM-SECUREPI-01/ });

    fireEvent.change(screen.getByLabelText('SecurePi URL for this browser'), {
      target: { value: 'http://securepi-browser.local:9200/video_feed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save local override' }));
    expect(await screen.findByText(/Browser-local override active/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'SecurePi Hardware' }));

    await screen.findByAltText('SecurePi live hardware camera');
    expect(healthCalls()[0][0]).toBe('http://securepi-browser.local:9200/health');
    expect(SECUREPI_CAMERA.stream_url).toBe('http://172.20.10.2:8001/video_feed');
  });

  test('a local SecurePi failure does not hide cloud-backed alert records', async () => {
    mockBackend([SECUREPI_CAMERA], {
      alerts: [{ id: 91, status: 'Active', alert_type: 'PEST_DETECTION', object_class: 'rat', zone_name: 'Dock', camera_location: 'CAM-SECUREPI-01' }],
    });
    securePiFetch.mockRejectedValue(new TypeError('network unavailable'));
    renderPage();

    expect((await screen.findAllByText('Pest detected')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'SecurePi Hardware' }));
    await screen.findByText('SecurePi IMX500 unavailable — using laptop camera fallback');
    expect(screen.getAllByText('Pest detected').length).toBeGreaterThan(0);
  });
});

describe('SecurePi Hardware mode - live people count', () => {
  test('polls the derived /people-count URL and shows the live People Detected badge', async () => {
    mockBackend([SECUREPI_CAMERA], { peopleCount: { count: 3, detection_active: true } });
    renderPage();

    await screen.findByRole('option', { name: /CAM-SECUREPI-01/ });
    fireEvent.click(screen.getByRole('button', { name: 'SecurePi Hardware' }));

    await waitFor(() => expect(securePiPeopleCountCalls().length).toBeGreaterThan(0));
    expect(securePiPeopleCountCalls()[0][0]).toBe('http://172.20.10.2:8001/people-count');
    expect(await screen.findByText('3 People Detected')).toBeTruthy();
  });

  test('an invalid people-count response clears stale data and remains on laptop fallback', async () => {
    mockBackend([SECUREPI_CAMERA], { peopleCount: null });
    renderPage();

    await screen.findByRole('option', { name: /CAM-SECUREPI-01/ });
    fireEvent.click(screen.getByRole('button', { name: 'SecurePi Hardware' }));

    await waitFor(() => expect(securePiPeopleCountCalls().length).toBeGreaterThan(0));
    expect(await screen.findByText('0 People Detected')).toBeTruthy();
    expect(await screen.findByText('SecurePi IMX500 unavailable — using laptop camera fallback')).toBeTruthy();
  });

  test('a stale (detection_active: false) Pi response is reflected, not treated as a live count', async () => {
    mockBackend([SECUREPI_CAMERA], { peopleCount: { count: 0, bag_count: 0, detection_active: false, age_seconds: 12.4 } });
    renderPage();

    await screen.findByRole('option', { name: /CAM-SECUREPI-01/ });
    fireEvent.click(screen.getByRole('button', { name: 'SecurePi Hardware' }));

    await waitFor(() => expect(securePiPeopleCountCalls().length).toBeGreaterThan(0));
    expect(await screen.findByText('0 People Detected')).toBeTruthy();
    expect(screen.getByText('SecurePi responding but frame is stale')).toBeTruthy();
    expect(screen.getByText(/Connection/).parentElement).toHaveTextContent('Degraded');
  });

  test('webcam mode never calls the SecurePi /people-count route (only the browser-YOLO endpoint)', async () => {
    mockBackend([SECUREPI_CAMERA], { peopleCount: { count: 5, detection_active: true } });
    renderPage();

    await screen.findByRole('option', { name: /CAM-SECUREPI-01/ });
    await waitFor(() => expect(axios.get.mock.calls.some(([url]) => url === '/api/yolo/people-count')).toBe(true));
    expect(securePiPeopleCountCalls()).toHaveLength(0);
  });

  test('leaving hardware mode stops the SecurePi /people-count poll from growing further', async () => {
    mockBackend([SECUREPI_CAMERA], { peopleCount: { count: 2, detection_active: true } });
    renderPage();

    await screen.findByRole('option', { name: /CAM-SECUREPI-01/ });
    fireEvent.click(screen.getByRole('button', { name: 'SecurePi Hardware' }));
    await screen.findByText('2 People Detected');

    fireEvent.click(screen.getByRole('button', { name: 'Browser Camera' }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));

    const callsRightAfterSwitch = securePiPeopleCountCalls().length;
    // The one-shot poll on entering hardware mode already fired; the effect's cleanup
    // (on the sourceMode dependency changing away from 'hardware') must prevent any
    // further poll from firing once we've left hardware mode.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(securePiPeopleCountCalls().length).toBe(callsRightAfterSwitch);
  });
});

describe('Browser Camera mode', () => {
  test('stops a late MediaStream that resolves after switching to SecurePi hardware', async () => {
    const pendingStream = deferred();
    getUserMedia.mockReturnValueOnce(pendingStream.promise);
    mockBackend([SECUREPI_CAMERA]);
    renderPage();

    await screen.findByRole('option', { name: /CAM-SECUREPI-01/ });
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'SecurePi Hardware' }));
    await screen.findByAltText('SecurePi live hardware camera');

    pendingStream.resolve({ getTracks: () => [{ stop: trackStop }] });
    await waitFor(() => expect(trackStop).toHaveBeenCalledTimes(1));
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  test('acquires the webcam by default and stops all tracks when switching to hardware', async () => {
    mockBackend([SECUREPI_CAMERA]);
    renderPage();

    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    expect(trackStop).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'SecurePi Hardware' }));

    await waitFor(() => expect(trackStop).toHaveBeenCalled());
    // Switching to hardware must not reacquire the webcam.
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  test('remains available after visiting hardware mode', async () => {
    mockBackend([SECUREPI_CAMERA]);
    renderPage();

    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'SecurePi Hardware' }));
    await screen.findByAltText('SecurePi live hardware camera');

    fireEvent.click(screen.getByRole('button', { name: 'Browser Camera' }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    expect(document.querySelector('video')).not.toBeNull();
  });

  test('upload video control stays present in every mode', async () => {
    mockBackend([SECUREPI_CAMERA]);
    renderPage();

    await screen.findByRole('option', { name: /CAM-SECUREPI-01/ });
    expect(screen.getByText('Upload Video')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'SecurePi Hardware' }));
    expect(screen.getByText('Upload Video')).toBeTruthy();
  });
});
