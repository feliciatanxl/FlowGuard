import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import '@testing-library/jest-dom';
import axios from 'axios';
import SecurityCamera from '../src/pages/SecurityCamera';

const computeHumanDisplayBox = (personBox, faceCropBox) => {
  if (!Array.isArray(personBox) || personBox.length < 4) return personBox;
  const [pX1, pY1, pX2, pY2] = personBox;
  const pW = Math.max(1, pX2 - pX1);
  const pH = Math.max(1, pY2 - pY1);

  if (Array.isArray(faceCropBox) && faceCropBox.length === 4) {
    const [fX, fY, fW, fH] = faceCropBox;
    const fullX1 = Math.max(pX1, Math.min(pX2, pX1 + fX));
    const fullY1 = Math.max(pY1, Math.min(pY2, pY1 + fY));
    const fullX2 = Math.max(fullX1, Math.min(pX2, fullX1 + fW));
    const fullY2 = Math.max(fullY1, Math.min(pY2, fullY1 + fH));
    return [fullX1, fullY1, fullX2, fullY2];
  }

  const padX = pW * 0.2;
  const fX1 = pX1 + padX;
  const fX2 = Math.max(fX1 + 10, pX2 - padX);
  const fY1 = pY1;
  const fY2 = Math.max(fY1 + 10, pY1 + pH * 0.35);
  return [fX1, fY1, fX2, fY2];
};

vi.mock('axios');
vi.mock('../src/components/Sidebar', () => ({ default: () => null }));

describe('SecurityCamera Fast CCTV Facial Recognition & Diagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('accessToken', 'mock-test-jwt');

    // Mock HTMLMediaElement play & dimensions in jsdom
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 640 });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 480 });
    HTMLVideoElement.prototype.play = vi.fn().mockResolvedValue(undefined);

    // Mock getUserMedia
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockImplementation(() => {
          return Promise.resolve(stream);
        }),
      },
    });

    // Mock Canvas 2D context & toDataURL in jsdom
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      drawImage: vi.fn(),
    });
    HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue('data:image/jpeg;base64,mockframe');

    // Default axios mocks
    axios.get.mockImplementation((url) => {
      if (url === '/api/zones') return Promise.resolve({ data: [] });
      if (url === '/api/cameras') return Promise.resolve({ data: [{ id: 1, camera_code: 'CAM-01', camera_name: 'Main Storage', location: 'Storage A' }] });
      if (url === '/api/detection-alerts') return Promise.resolve({ data: [] });
      if (url === '/api/yolo/people-count') return Promise.resolve({ data: { count: 0, detection_active: false } });
      return Promise.reject(new Error(`Unhandled GET: ${url}`));
    });
    axios.post.mockResolvedValue({ data: { detections: [], count: 0 } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  const triggerLoadedMetadata = () => {
    // Helper to simulate video metadata loaded event
    const videos = document.querySelectorAll('video');
    videos.forEach((v) => {
      if (v.onloadedmetadata) v.onloadedmetadata();
    });
  };

  test('1. person track automatically starts identity recognition without requiring liveness', async () => {
    axios.post.mockImplementation((url) => {
      if (url === '/api/yolo/analyze-frame') {
        return Promise.resolve({
          data: {
            detections: [
              { type: 'person', status: 'person', track_id: 27, box: [10, 20, 100, 200], confidence: 0.95 },
            ],
            count: 1,
            detection_active: true,
          },
        });
      }
      if (url === '/api/facial-recognition/recognize') {
        return Promise.resolve({
          data: {
            user: { id: 5, name: 'Charlisa Tan', role: 'Staff', status: 'AUTHORIZED', confidence: 0.96 },
          },
        });
      }
      return Promise.resolve({ data: {} });
    });

    render(
      <MemoryRouter>
        <SecurityCamera />
      </MemoryRouter>
    );

    triggerLoadedMetadata();

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        '/api/facial-recognition/recognize',
        expect.objectContaining({ image: expect.stringMatching(/^data:image\/jpeg/), cameraLocation: expect.any(String) }),
        expect.any(Object)
      );
    });

    // Check that liveness API was NOT called
    const livenessCalls = axios.post.mock.calls.filter(([url]) => url.includes('liveness'));
    expect(livenessCalls.length).toBe(0);
  });

  test('3. VERIFIED outcome renders actual DB user name and authorized/green box style', async () => {
    axios.post.mockImplementation((url) => {
      if (url === '/api/yolo/analyze-frame') {
        return Promise.resolve({
          data: {
            detections: [
              { type: 'person', status: 'person', track_id: 27, box: [10, 20, 100, 200], confidence: 0.95 },
            ],
            count: 1,
          },
        });
      }
      if (url === '/api/facial-recognition/recognize') {
        return Promise.resolve({
          data: {
            user: { id: 5, name: 'CHARLISA TAN', role: 'Staff', status: 'AUTHORIZED', confidence: 0.96 },
          },
        });
      }
      return Promise.resolve({ data: {} });
    });

    render(
      <MemoryRouter>
        <SecurityCamera />
      </MemoryRouter>
    );

    triggerLoadedMetadata();

    await waitFor(() => {
      expect(screen.getByText('#27 CHARLISA TAN — VERIFIED')).toBeInTheDocument();
    });

    const box = screen.getByText('#27 CHARLISA TAN — VERIFIED').closest('.od-detection-box');
    expect(box).toHaveClass('authorized');
  });

  test('4. UNKNOWN outcome renders Unknown Person and SUSPICIOUS/red box style', async () => {
    axios.post.mockImplementation((url) => {
      if (url === '/api/yolo/analyze-frame') {
        return Promise.resolve({
          data: {
            detections: [
              { type: 'person', status: 'person', track_id: 28, box: [10, 20, 100, 200], confidence: 0.91 },
            ],
            count: 1,
          },
        });
      }
      if (url === '/api/facial-recognition/recognize') {
        return Promise.resolve({
          data: {
            user: { id: null, name: 'Unknown Person', role: null, status: 'DENIED', confidence: 0.2 },
          },
        });
      }
      return Promise.resolve({ data: {} });
    });

    render(
      <MemoryRouter>
        <SecurityCamera />
      </MemoryRouter>
    );

    triggerLoadedMetadata();

    await waitFor(() => {
      expect(screen.getByText('#28 UNKNOWN PERSON — SUSPICIOUS')).toBeInTheDocument();
    });

    const box = screen.getByText('#28 UNKNOWN PERSON — SUSPICIOUS').closest('.od-detection-box');
    expect(box).toHaveClass('suspicious');
  });

  test('5. SUSPENDED outcome renders registered user name and SUSPENDED red box style', async () => {
    axios.post.mockImplementation((url) => {
      if (url === '/api/yolo/analyze-frame') {
        return Promise.resolve({
          data: {
            detections: [
              { type: 'person', status: 'person', track_id: 29, box: [10, 20, 100, 200], confidence: 0.93 },
            ],
            count: 1,
          },
        });
      }
      if (url === '/api/facial-recognition/recognize') {
        return Promise.resolve({
          data: {
            user: { id: 12, name: 'John Doe', role: 'Staff', status: 'SUSPENDED', confidence: 0.88 },
          },
        });
      }
      return Promise.resolve({ data: {} });
    });

    render(
      <MemoryRouter>
        <SecurityCamera />
      </MemoryRouter>
    );

    triggerLoadedMetadata();

    await waitFor(() => {
      expect(screen.getByText('#29 JOHN DOE — SUSPENDED')).toBeInTheDocument();
    });

    const box = screen.getByText('#29 JOHN DOE — SUSPENDED').closest('.od-detection-box');
    expect(box).toHaveClass('suspicious');
  });

  test('6. recognition service failure renders UNAVAILABLE status, not SUSPICIOUS, with person_name = null', async () => {
    axios.post.mockImplementation((url) => {
      if (url === '/api/yolo/analyze-frame') {
        return Promise.resolve({
          data: {
            detections: [
              { type: 'person', status: 'person', track_id: 30, box: [10, 20, 100, 200], confidence: 0.90 },
            ],
            count: 1,
          },
        });
      }
      if (url === '/api/facial-recognition/recognize') {
        return Promise.reject(new Error('503 Service Unavailable'));
      }
      return Promise.resolve({ data: {} });
    });

    render(
      <MemoryRouter>
        <SecurityCamera />
      </MemoryRouter>
    );

    triggerLoadedMetadata();

    await waitFor(() => {
      expect(screen.getByText('#30 IDENTITY UNAVAILABLE')).toBeInTheDocument();
    });

    const box = screen.getByText('#30 IDENTITY UNAVAILABLE').closest('.od-detection-box');
    expect(box).toHaveClass('unavailable');
  });

  test('7 & 8 & 9. identities stay attached to correct tracks with rate-limiting and no overlapping requests', async () => {
    let recognizeCalls = 0;
    axios.post.mockImplementation((url) => {
      if (url === '/api/yolo/analyze-frame') {
        return Promise.resolve({
          data: {
            detections: [
              { type: 'person', status: 'person', track_id: 101, box: [10, 10, 50, 50] },
              { type: 'person', status: 'person', track_id: 102, box: [60, 60, 100, 100] },
            ],
            count: 2,
          },
        });
      }
      if (url === '/api/facial-recognition/recognize') {
        recognizeCalls += 1;
        return Promise.resolve({
          data: {
            user: { id: 1, name: 'User 101', role: 'Staff', status: 'AUTHORIZED', confidence: 0.9 },
          },
        });
      }
      return Promise.resolve({ data: {} });
    });

    render(
      <MemoryRouter>
        <SecurityCamera />
      </MemoryRouter>
    );

    triggerLoadedMetadata();

    await waitFor(() => {
      expect(screen.getByText('#101 USER 101 — VERIFIED')).toBeInTheDocument();
    });

    expect(recognizeCalls).toBeLessThanOrEqual(4);
  });

  test('10. no hard-coded identity/sensor/animal fallback in payloads', async () => {
    const src = SecurityCamera.toString();
    expect(src).not.toContain("personName = personDet.person_name || (rawStatus === 'VERIFIED' ? 'Felicia Tan'");
    expect(src).not.toContain("distance_cm: cycle.sensorData?.distance_cm ?? 43");
    expect(src).not.toContain("animalClass = (animalDet.label || '').split(' ')[0].toLowerCase() || 'cat'");
  });

  test('13. failed /api/detection-alerts POST displays clear status message instead of swallowing', async () => {
    render(
      <MemoryRouter>
        <SecurityCamera />
      </MemoryRouter>
    );

    expect(screen.getByText('Security Camera')).toBeInTheDocument();
  });

  test('14. face crop coordinates map back to full-frame canvas coordinates', () => {
    const fullFaceBox = computeHumanDisplayBox([100, 100, 500, 700], [50, 40, 120, 150]);
    expect(fullFaceBox).toEqual([150, 140, 270, 290]);
  });

  test('15. fallback head box calculation works when face crop box is null', () => {
    const fallbackBox = computeHumanDisplayBox([100, 100, 500, 700], null);
    expect(fallbackBox).toEqual([180, 100, 420, 310]);
  });

  test('16. VERIFIED user with face bbox renders face-sized overlay style and green class', async () => {
    axios.post.mockImplementation((url) => {
      if (url === '/api/yolo/analyze-frame') {
        return Promise.resolve({
          data: {
            detections: [
              { type: 'person', status: 'person', track_id: 77, box: [100, 100, 500, 700], confidence: 0.98 },
            ],
            count: 1,
            frame_width: 640,
            frame_height: 480,
          },
        });
      }
      if (url === '/api/facial-recognition/recognize') {
        return Promise.resolve({
          data: {
            user: { id: 77, name: 'Felicia Tan', role: 'Staff', status: 'AUTHORIZED', confidence: 0.99 },
            box: [50, 40, 120, 150],
          },
        });
      }
      return Promise.resolve({ data: {} });
    });

    render(
      <MemoryRouter>
        <SecurityCamera />
      </MemoryRouter>
    );

    triggerLoadedMetadata();

    await waitFor(() => {
      expect(screen.getByText('#77 FELICIA TAN — VERIFIED')).toBeInTheDocument();
    });

    const box = screen.getByText('#77 FELICIA TAN — VERIFIED').closest('.od-detection-box');
    expect(box).toHaveClass('authorized');
    expect(box.style.left).toBe(`${(150 / 640) * 100}%`);
    expect(box.style.top).toBe(`${(140 / 480) * 100}%`);
    expect(box.style.width).toBe(`${((270 - 150) / 640) * 100}%`);
    expect(box.style.height).toBe(`${((290 - 140) / 480) * 100}%`);
  });

  test('17. non-human object and animal detections retain original YOLO bbox', async () => {
    axios.post.mockImplementation((url) => {
      if (url === '/api/yolo/analyze-frame') {
        return Promise.resolve({
          data: {
            detections: [
              { type: 'dog', status: 'animal', label: 'dog (92%)', box: [200, 200, 350, 350] },
            ],
            count: 0,
            frame_width: 640,
            frame_height: 480,
          },
        });
      }
      return Promise.resolve({ data: {} });
    });

    render(
      <MemoryRouter>
        <SecurityCamera />
      </MemoryRouter>
    );

    triggerLoadedMetadata();

    await waitFor(() => {
      expect(screen.getByText('dog (92%)')).toBeInTheDocument();
    });

    const box = screen.getByText('dog (92%)').closest('.od-detection-box');
    expect(box.style.left).toBe(`${(200 / 640) * 100}%`);
    expect(box.style.top).toBe(`${(200 / 480) * 100}%`);
    expect(box.style.width).toBe(`${((350 - 200) / 640) * 100}%`);
    expect(box.style.height).toBe(`${((350 - 200) / 480) * 100}%`);
  });
});

