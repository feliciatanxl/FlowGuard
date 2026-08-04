import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  SECUREPI_CONNECTION_STATUS,
  clearSecurePiStreamOverride,
  deriveSecurePiEndpoints,
  getHardwareHealthUrl,
  getHardwarePeopleCountUrl,
  getHardwareSnapshotUrl,
  getHardwareStreamUrl,
  readSecurePiStreamOverride,
  saveSecurePiStreamOverride,
  testSecurePiConnection,
  validateSecurePiStreamUrl,
  isHttpUrl,
} from '../../src/utils/securepiStream';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('getHardwareStreamUrl', () => {
  test('uses the selected camera inventory HTTP stream_url first', () => {
    const camera = { stream_url: 'http://172.20.10.2:8001/video_feed' };
    expect(getHardwareStreamUrl(camera, 'http://fallback:8001/video_feed'))
      .toBe('http://172.20.10.2:8001/video_feed');
  });

  test('falls back to VITE env URL only when inventory URL is unavailable', () => {
    expect(getHardwareStreamUrl(null, 'http://fallback:8001/video_feed'))
      .toBe('http://fallback:8001/video_feed');
    expect(getHardwareStreamUrl({ stream_url: null }, 'http://fallback:8001/video_feed'))
      .toBe('http://fallback:8001/video_feed');
  });

  test('does not treat local demo videos or MP4 paths as hardware streams', () => {
    expect(getHardwareStreamUrl({ stream_url: '/videos/loading.mp4' }, ''))
      .toBe('');
    expect(getHardwareStreamUrl({ stream_url: '/videos/loading.mp4' }, 'http://fallback:8001/video_feed'))
      .toBe('http://fallback:8001/video_feed');
  });

  test('returns empty string when nothing is configured', () => {
    expect(getHardwareStreamUrl(null, '')).toBe('');
    expect(getHardwareStreamUrl({ stream_url: 'ftp://bad' }, 'file:///nope')).toBe('');
  });

  test('accepts https and trims whitespace', () => {
    expect(getHardwareStreamUrl({ stream_url: '  https://pi.local:8001/video_feed  ' }, ''))
      .toBe('https://pi.local:8001/video_feed');
  });
});

describe('getHardwareHealthUrl', () => {
  test('prefers VITE_SECUREPI_HEALTH_URL when set', () => {
    expect(getHardwareHealthUrl('http://172.20.10.2:8001/video_feed', 'http://172.20.10.2:8001/custom-health'))
      .toBe('http://172.20.10.2:8001/custom-health');
  });

  test('derives /health from the MJPEG stream origin', () => {
    expect(getHardwareHealthUrl('http://172.20.10.2:8001/video_feed', ''))
      .toBe('http://172.20.10.2:8001/health');
  });

  test('returns empty string (polling disabled) when no valid hardware stream exists', () => {
    expect(getHardwareHealthUrl('', '')).toBe('');
    expect(getHardwareHealthUrl('/videos/loading.mp4', '')).toBe('');
  });
});

describe('isHttpUrl', () => {
  test('only http/https URLs qualify', () => {
    expect(isHttpUrl('http://x')).toBe(true);
    expect(isHttpUrl('HTTPS://x')).toBe(true);
    expect(isHttpUrl('/videos/loading.mp4')).toBe(false);
    expect(isHttpUrl('rtsp://cam')).toBe(false);
    expect(isHttpUrl(undefined)).toBe(false);
  });
});

describe('SecurePi endpoint validation and derivation', () => {
  test.each([
    ['http://securepi.local:5001/video_feed', 'http://securepi.local:5001'],
    ['http://securepi.local:9443/video_feed', 'http://securepi.local:9443'],
    ['https://camera.example.test/mjpeg', 'https://camera.example.test'],
  ])('derives every endpoint from the parsed origin for %s', (streamUrl, origin) => {
    expect(deriveSecurePiEndpoints(streamUrl)).toMatchObject({
      valid: true,
      healthUrl: `${origin}/health`,
      peopleCountUrl: `${origin}/people-count`,
      snapshotUrl: `${origin}/snapshot`,
    });
    expect(getHardwareHealthUrl(streamUrl)).toBe(`${origin}/health`);
    expect(getHardwarePeopleCountUrl(streamUrl)).toBe(`${origin}/people-count`);
    expect(getHardwareSnapshotUrl(streamUrl)).toBe(`${origin}/snapshot`);
  });

  test('rejects malformed, unsupported, credential-bearing, and secret-bearing URLs', () => {
    expect(validateSecurePiStreamUrl('not a url').valid).toBe(false);
    expect(validateSecurePiStreamUrl('ftp://securepi.local/video_feed').valid).toBe(false);
    expect(validateSecurePiStreamUrl('http://user:pass@securepi.local/video_feed').valid).toBe(false);
    expect(validateSecurePiStreamUrl('http://securepi.local/video_feed?access_token=secret').valid).toBe(false);
    expect(validateSecurePiStreamUrl('http://securepi.local/video_feed?quality=80').valid).toBe(true);
  });
});

describe('browser-local SecurePi override', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };

  beforeEach(() => values.clear());

  test('is scoped to a camera ID and can be cleared', () => {
    expect(saveSecurePiStreamOverride(7, 'http://securepi-a.local:5001/video_feed', storage).ok).toBe(true);
    expect(readSecurePiStreamOverride(7, storage)).toMatchObject({ valid: true, normalized: 'http://securepi-a.local:5001/video_feed' });
    expect(readSecurePiStreamOverride(8, storage).present).toBe(false);
    clearSecurePiStreamOverride(7, storage);
    expect(readSecurePiStreamOverride(7, storage).present).toBe(false);
  });

  test('never stores a malformed or secret-bearing override', () => {
    expect(saveSecurePiStreamOverride(7, 'http://securepi.local/video_feed?token=nope', storage).ok).toBe(false);
    expect(values.size).toBe(0);
  });
});

describe('testSecurePiConnection', () => {
  const jsonResponse = (body, ok = true, status = ok ? 200 : 500) => ({
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
  });

  test('accepts status online and latest_frame_age_seconds from the current SecurePi health contract', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
        status: 'online',
        camera: 'IMX500',
        streaming: true,
        latest_frame_age_seconds: 1.4,
      }))
      .mockResolvedValueOnce(jsonResponse({ count: 1, detection_active: true }));

    await expect(testSecurePiConnection({ streamUrl: 'http://securepi.local:8123/video_feed' })).resolves.toMatchObject({
      ok: true,
      status: SECUREPI_CONNECTION_STATUS.CONNECTED,
      health: { status: 'online', streaming: true, cameraDescription: 'IMX500' },
      details: { visiblePeople: 1, frameAgeSeconds: 1.4, resolvedPort: '8123' },
    });
  });

  test.each([404, 405, 501])('treats people-count HTTP %s as unsupported without rejecting health', async (status) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
        status: 'online',
        camera: 'IMX500',
        streaming: true,
        latest_frame_age_seconds: 0.3,
      }))
      .mockResolvedValueOnce(jsonResponse(null, false, status));

    await expect(testSecurePiConnection({ streamUrl: 'http://securepi.local:8123/video_feed' })).resolves.toMatchObject({
      ok: true,
      status: SECUREPI_CONNECTION_STATUS.CONNECTED,
      people: null,
      peopleCountSupported: false,
      details: { visiblePeople: null, frameAgeSeconds: 0.3 },
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://securepi.local:8123/health',
      'http://securepi.local:8123/people-count',
    ]);
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/snapshot'))).toBe(false);
  });

  test('keeps valid health connected when the optional people-count fetch throws a CORS TypeError', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
        status: 'online',
        camera: 'IMX500',
        streaming: true,
        latest_frame_age_seconds: 0.2,
      }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(testSecurePiConnection({ streamUrl: 'http://securepi.local:8123/video_feed' })).resolves.toMatchObject({
      ok: true,
      status: SECUREPI_CONNECTION_STATUS.CONNECTED,
      people: null,
      peopleCountSupported: false,
      details: {
        cameraDescription: 'IMX500',
        streaming: true,
        visiblePeople: null,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('still reports unreachable when the authoritative health fetch throws TypeError', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(testSecurePiConnection({ streamUrl: 'http://securepi.local:8123/video_feed' })).resolves.toMatchObject({
      ok: false,
      status: SECUREPI_CONNECTION_STATUS.UNREACHABLE,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('treats streaming false as degraded and rejects a non-boolean streaming field', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ status: 'online', streaming: false }))
      .mockResolvedValueOnce(jsonResponse(null, false, 404))
      .mockResolvedValueOnce(jsonResponse({ status: 'online', streaming: 'yes' }));

    await expect(testSecurePiConnection({ streamUrl: 'http://securepi.local:8123/video_feed' })).resolves.toMatchObject({
      ok: true,
      status: SECUREPI_CONNECTION_STATUS.STALE,
      details: { streaming: false },
    });
    await expect(testSecurePiConnection({ streamUrl: 'http://securepi.local:8123/video_feed' })).resolves.toMatchObject({
      ok: false,
      status: SECUREPI_CONNECTION_STATUS.INVALID_RESPONSE,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test('checks health before people-count and sends no JWT, edge token, or credentials', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ status: 'ok', camera: 'Sony IMX500', device_id: 'securepi-01', zone: 'Loading Bay' }))
      .mockResolvedValueOnce(jsonResponse({ count: 3, detection_active: true, age_seconds: 1.2 }));

    await expect(testSecurePiConnection({ streamUrl: 'http://securepi.local:5001/video_feed' })).resolves.toMatchObject({
      ok: true,
      status: SECUREPI_CONNECTION_STATUS.CONNECTED,
      details: { visiblePeople: 3, detectionActive: true, resolvedPort: '5001' },
    });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://securepi.local:5001/health',
      'http://securepi.local:5001/people-count',
    ]);
    for (const [, options] of fetchMock.mock.calls) {
      expect(options.credentials).toBe('omit');
      expect(options.headers).toBeUndefined();
      expect(JSON.stringify(options)).not.toMatch(/authorization|bearer|jwt|edge_ingest_token/i);
    }
  });

  test('does not request people-count after failed health validation', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ status: 'unknown' }));
    await expect(testSecurePiConnection({ streamUrl: 'http://securepi.local:7000/video_feed' })).resolves.toMatchObject({
      ok: false,
      status: SECUREPI_CONNECTION_STATUS.INVALID_RESPONSE,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('reports stale frames as degraded while retaining safe details', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ status: 'ok' }))
      .mockResolvedValueOnce(jsonResponse({ count: 1, detection_active: false, age_seconds: 12.4 }));
    await expect(testSecurePiConnection({ streamUrl: 'https://securepi.local/video_feed' })).resolves.toMatchObject({
      ok: true,
      status: SECUREPI_CONNECTION_STATUS.STALE,
      details: { visiblePeople: 1, frameAgeSeconds: 12.4 },
    });
  });

  test('uses AbortController timeout classification', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    await expect(testSecurePiConnection({
      streamUrl: 'http://securepi.local:5001/video_feed',
      timeoutMs: 5,
    })).resolves.toMatchObject({ ok: false, status: SECUREPI_CONNECTION_STATUS.TIMEOUT });
  });
});
