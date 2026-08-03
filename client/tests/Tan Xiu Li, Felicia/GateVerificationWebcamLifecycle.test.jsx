// Smart Logistics webcam lifecycle tests. These exercise the real gate-camera
// and shared MediaStream helpers; only network/Pi/OCR boundaries are mocked.
import { render, screen, fireEvent, act, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  resolvePreferredCameraSource: vi.fn(),
  fetchPiSnapshotBitmap: vi.fn(),
  preloadQrScanner: vi.fn(() => Promise.resolve(true)),
  recognizePlate: vi.fn(),
  post: vi.fn(),
}));

vi.mock('axios', () => ({ default: { post: h.post } }));
vi.mock('../../src/components/Sidebar', () => ({ default: () => <div data-testid="sidebar" /> }));
vi.mock('../../src/utils/plateOcr', () => ({ recognizePlate: h.recognizePlate }));
vi.mock('../../src/utils/gateCamera', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, preloadQrScanner: h.preloadQrScanner };
});
vi.mock('../../src/utils/cameraSource', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    PI_CAMERA_STREAM_URL: 'http://pi.test:8081/video_feed',
    isPiConfigured: () => true,
    resolvePreferredCameraSource: h.resolvePreferredCameraSource,
    fetchPiSnapshotBitmap: h.fetchPiSnapshotBitmap,
  };
});

import GateVerification from '../../src/pages/GateVerification';
import { CAMERA_SOURCE, SOURCE_LABELS } from '../../src/utils/cameraSource';

const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

const fakeStream = () => {
  const track = {
    stop: vi.fn(),
    getSettings: () => ({ width: 1280, height: 720, frameRate: 30, facingMode: 'environment' }),
  };
  return {
    track,
    stream: { getTracks: () => [track], getVideoTracks: () => [track] },
  };
};

const installCamera = (getUserMedia) => {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
};

const renderPage = () => {
  localStorage.setItem('accessToken', 'test-token');
  localStorage.setItem('userRole', 'FM');
  return render(<MemoryRouter><GateVerification /></MemoryRouter>);
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  h.resolvePreferredCameraSource.mockResolvedValue({
    source: CAMERA_SOURCE.WEBCAM,
    reason: null,
    probed: true,
  });
  h.recognizePlate.mockResolvedValue({ raw: 'GBG 1234 M', normalized: 'GBG1234M', confidence: 88 });
  h.post.mockResolvedValue({ data: {} });
  vi.stubGlobal('BarcodeDetector', class {
    detect() { return Promise.resolve([]); }
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalMediaDevices) Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
  else delete navigator.mediaDevices;
});

describe('Smart Logistics Laptop Webcam lifecycle', () => {
  test('selecting Laptop Webcam requests permission, attaches the stream, and shows Camera ready', async () => {
    const pending = deferred();
    const { stream } = fakeStream();
    const getUserMedia = vi.fn().mockReturnValue(pending.promise);
    installCamera(getUserMedia);
    renderPage();

    const video = screen.getByLabelText('QR scanner preview');
    const preview = video.parentElement;
    expect(within(preview).getByText('Camera is off')).toBeTruthy();

    act(() => { fireEvent.click(screen.getByRole('button', { name: SOURCE_LABELS.webcam })); });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(within(preview).getByText('Starting camera')).toBeTruthy();

    await act(async () => {
      pending.resolve(stream);
      await pending.promise;
    });

    expect(video.srcObject).toBe(stream);
    expect(video.play).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Camera ready')).toBeTruthy();
    expect(within(preview).queryByText('Camera is off')).toBeNull();
  });

  test.each([
    ['NotAllowedError', 'Permission denied', /Camera permission was denied/i],
    ['NotFoundError', 'Camera unavailable', /No camera was found/i],
    ['NotReadableError', 'Camera already in use', /Close other apps or tabs/i],
  ])('shows a safe status for %s', async (name, status, message) => {
    const error = Object.assign(new Error('raw browser detail'), { name });
    installCamera(vi.fn().mockRejectedValue(error));
    renderPage();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Plate camera source: Laptop Webcam/i }));
    });

    const preview = screen.getByLabelText('Plate camera preview').parentElement;
    expect(within(preview).getByText(status)).toBeTruthy();
    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.queryByText(/raw browser detail/i)).toBeNull();
  });

  test('Pi to Laptop starts one stream; Laptop to Pi stops it and clears the webcam preview', async () => {
    const { stream, track } = fakeStream();
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    installCamera(getUserMedia);
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Plate camera source: Raspberry Pi Camera Module 3/i }));
    expect(screen.getByAltText(/Raspberry Pi Camera Module 3 plate preview/i)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Plate camera source: Laptop Webcam/i }));
    });
    const video = screen.getByLabelText('Plate camera preview');
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBe(stream);
    expect(screen.queryByAltText(/Raspberry Pi Camera Module 3 plate preview/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Plate camera source: Laptop Webcam/i }));
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Plate camera source: Raspberry Pi Camera Module 3/i }));
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBeNull();
    expect(screen.getByAltText(/Raspberry Pi Camera Module 3 plate preview/i)).toBeTruthy();
  });

  test('unmount stops every active webcam track', async () => {
    const first = { stop: vi.fn(), getSettings: () => ({}) };
    const second = { stop: vi.fn(), getSettings: () => ({}) };
    const stream = { getTracks: () => [first, second], getVideoTracks: () => [first] };
    installCamera(vi.fn().mockResolvedValue(stream));
    const { unmount } = renderPage();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Plate camera source: Laptop Webcam/i }));
    });
    unmount();

    expect(first.stop).toHaveBeenCalledTimes(1);
    expect(second.stop).toHaveBeenCalledTimes(1);
  });

  test('a late getUserMedia result is stopped after switching to Pi', async () => {
    const pending = deferred();
    const { stream, track } = fakeStream();
    installCamera(vi.fn().mockReturnValue(pending.promise));
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Plate camera source: Laptop Webcam/i }));
    fireEvent.click(screen.getByRole('button', { name: /Plate camera source: Raspberry Pi Camera Module 3/i }));

    await act(async () => {
      pending.resolve(stream);
      await pending.promise;
    });

    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Plate camera preview').srcObject).toBeNull();
    expect(screen.getByAltText(/Raspberry Pi Camera Module 3 plate preview/i)).toBeTruthy();
  });

  test('a manual Laptop selection is not overwritten by a late automatic Pi probe', async () => {
    const probe = deferred();
    h.resolvePreferredCameraSource.mockReturnValue(probe.promise);
    const { stream } = fakeStream();
    installCamera(vi.fn().mockResolvedValue(stream));
    renderPage();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: SOURCE_LABELS.webcam }));
    });
    await act(async () => {
      probe.resolve({ source: CAMERA_SOURCE.PI, reason: null, probed: true });
      await probe.promise;
    });

    expect(screen.getByRole('button', { name: SOURCE_LABELS.webcam }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByAltText(/Raspberry Pi Camera Module 3 live preview/i)).toBeNull();
    expect(screen.getByLabelText('QR scanner preview').srcObject).toBe(stream);
  });
});
