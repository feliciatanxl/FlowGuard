import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mutable, hoisted Pi mock so each test can flip URL/reachability without re-importing.
const h = vi.hoisted(() => ({
  piState: { url: '', reachable: false },
  isPiCameraReachableCached: vi.fn(),
  getLastPiProbeResult: vi.fn(),
  fetchPiSnapshotBitmap: vi.fn(),
}));

vi.mock('../constants/piCamera', () => ({
  get PI_CAMERA_STREAM_URL() { return ''; },
  get PI_CAMERA_SNAPSHOT_URL() { return h.piState.url; },
  get PI_CAMERA_HEALTH_URL() { return h.piState.url ? 'http://pi.local:8081/health' : ''; },
  PI_CONNECTION_STATUS: { SUCCESS: 'success', PERMISSION_REQUIRED: 'permission-required' },
  PI_CONFIG_SOURCE: { NONE: 'none' },
  CAMERA_SOURCES: { PI: 'pi', WEBCAM: 'webcam' },
  CAMERA_STATUS_MESSAGES: {},
  getResolvedPiCameraConfig: () => ({ configured: Boolean(h.piState.url) }),
  probePiCamera: vi.fn(),
  testPiCameraConnection: vi.fn(),
  isPiCameraReachable: vi.fn(),
  isPiCameraReachableCached: h.isPiCameraReachableCached,
  getLastPiProbeResult: h.getLastPiProbeResult,
  isPiInCooldown: () => false,
  markPiUnavailable: vi.fn(),
  resetPiAvailabilityCache: vi.fn(),
  fetchPiSnapshotBitmap: h.fetchPiSnapshotBitmap,
  validatePiCameraBaseUrl: vi.fn(),
  normalizePiCameraBaseUrl: vi.fn(),
  derivePiCameraUrls: vi.fn(),
  readRuntimePiCameraBaseUrl: vi.fn(),
  saveRuntimePiCameraBaseUrl: vi.fn(),
  clearRuntimePiCameraBaseUrl: vi.fn(),
}));

import {
  resolvePreferredCameraSource,
  capturePiSnapshotCanvas,
  drawBitmapToCanvasAndClose,
  stopStream,
  CAMERA_SOURCE,
  FALLBACK_REASON,
} from './cameraSource';

beforeEach(() => {
  vi.clearAllMocks();
  h.piState.url = '';
  h.piState.reachable = false;
  h.getLastPiProbeResult.mockReturnValue(null);
});

describe('resolvePreferredCameraSource (source priority: Pi → webcam)', () => {
  it('selects the Pi when it is configured AND reachable', async () => {
    h.piState.url = 'http://pi.local:8081/snapshot';
    h.isPiCameraReachableCached.mockResolvedValue(true);
    const result = await resolvePreferredCameraSource();
    expect(result).toEqual({ source: CAMERA_SOURCE.PI, reason: null, probed: true });
    expect(h.isPiCameraReachableCached).toHaveBeenCalledTimes(1);
  });

  it('falls back to the webcam when the Pi is configured but unreachable', async () => {
    h.piState.url = 'http://pi.local:8081/snapshot';
    h.isPiCameraReachableCached.mockResolvedValue(false);
    const result = await resolvePreferredCameraSource();
    expect(result.source).toBe(CAMERA_SOURCE.WEBCAM);
    expect(result.reason).toBe(FALLBACK_REASON.PI_UNREACHABLE);
    expect(result.probed).toBe(true);
  });

  it('distinguishes local-network permission from an unreachable Pi', async () => {
    h.piState.url = 'http://pi.local:8081/snapshot';
    h.isPiCameraReachableCached.mockResolvedValue(false);
    h.getLastPiProbeResult.mockReturnValue({ status: 'permission-required' });
    const result = await resolvePreferredCameraSource();
    expect(result).toEqual({
      source: CAMERA_SOURCE.WEBCAM,
      reason: FALLBACK_REASON.LOCAL_NETWORK_PERMISSION_REQUIRED,
      probed: true,
    });
  });

  it('cloud build with NO Pi URL performs no Pi probe and uses the webcam immediately', async () => {
    h.piState.url = ''; // deployed cloud frontend has no Pi address
    const result = await resolvePreferredCameraSource();
    expect(result.source).toBe(CAMERA_SOURCE.WEBCAM);
    expect(result.reason).toBe(FALLBACK_REASON.PI_NOT_CONFIGURED);
    expect(result.probed).toBe(false);
    expect(h.isPiCameraReachableCached).not.toHaveBeenCalled(); // no network probe at all
  });
});

describe('capturePiSnapshotCanvas (Pi still → in-memory canvas)', () => {
  const withCanvasMock = () => {
    const drawImage = vi.fn();
    vi.spyOn(document, 'createElement').mockImplementation(() => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
    }));
    return { drawImage };
  };

  it('draws the Pi snapshot onto a canvas and RELEASES the ImageBitmap', async () => {
    const { drawImage } = withCanvasMock();
    const close = vi.fn();
    h.fetchPiSnapshotBitmap.mockResolvedValue({ width: 640, height: 480, close });

    const canvas = await capturePiSnapshotCanvas();

    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(480);
    expect(drawImage).toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1); // bitmap released, never persisted
    document.createElement.mockRestore();
  });

  it('throws when the Pi snapshot cannot be fetched (caller falls back to webcam)', async () => {
    h.fetchPiSnapshotBitmap.mockRejectedValue(new Error('Pi snapshot HTTP 503'));
    await expect(capturePiSnapshotCanvas()).rejects.toThrow(/Pi snapshot/);
  });

  it('closes the ImageBitmap even when canvas drawing throws', () => {
    const close = vi.fn();
    const bitmap = { width: 640, height: 480, close };
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: () => { throw new Error('canvas failed'); } }),
    };

    expect(() => drawBitmapToCanvasAndClose(bitmap, canvas)).toThrow(/canvas failed/);
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('stopStream (switching source releases webcam tracks)', () => {
  it('stops every track and detaches the stream from the <video>', () => {
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }, { stop }] };
    const video = { srcObject: stream };
    stopStream(video, stream);
    expect(stop).toHaveBeenCalledTimes(2);
    expect(video.srcObject).toBeNull();
  });
});
