import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const ENV_KEYS = [
  'VITE_ENABLE_PI_CAMERA',
  'VITE_PI_CAMERA_HEALTH_URL',
  'VITE_PI_CAMERA_STREAM_URL',
  'VITE_PI_CAMERA_SNAPSHOT_URL',
];

async function loadPi(env = {}) {
  vi.resetModules();
  ENV_KEYS.forEach((key) => vi.stubEnv(key, env[key] ?? ''));
  return import('../../src/constants/piCamera');
}

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Pi camera URL validation and derivation', () => {
  test.each([
    ['http://172.20.10.4:8081/', 'http://172.20.10.4:8081'],
    ['http://raspberrypi.local:8081/', 'http://raspberrypi.local:8081'],
    ['https://example-device.internal', 'https://example-device.internal'],
  ])('normalizes a valid base URL: %s', async (value, expected) => {
    const pi = await loadPi();
    expect(pi.validatePiCameraBaseUrl(value)).toMatchObject({ valid: true, normalized: expected });
  });

  test.each([
    'javascript:alert(1)',
    'data:text/plain,no',
    'file:///tmp/camera',
    'ftp://pi.local',
    'http://user:password@pi.local:8081',
    'http://pi.local:8081/camera',
    'http://pi.local:8081?mode=test',
    'http://pi.local:8081#camera',
    'not a url',
  ])('rejects unsafe or malformed base URL: %s', async (value) => {
    const pi = await loadPi();
    expect(pi.validatePiCameraBaseUrl(value).valid).toBe(false);
  });

  test('derives health, stream, and snapshot endpoints', async () => {
    const pi = await loadPi();
    expect(pi.derivePiCameraUrls('http://pi.local:8081/')).toEqual({
      valid: true,
      error: '',
      baseUrl: 'http://pi.local:8081',
      healthUrl: 'http://pi.local:8081/health',
      streamUrl: 'http://pi.local:8081/video_feed',
      snapshotUrl: 'http://pi.local:8081/snapshot',
    });
  });
});

describe('runtime and VITE configuration resolution', () => {
  const envConfig = {
    VITE_ENABLE_PI_CAMERA: 'true',
    VITE_PI_CAMERA_HEALTH_URL: 'http://env-pi.local:8081/health',
    VITE_PI_CAMERA_STREAM_URL: 'http://env-pi.local:8081/video_feed',
    VITE_PI_CAMERA_SNAPSHOT_URL: 'http://env-pi.local:8081/snapshot',
  };

  test('valid runtime URL overrides VITE endpoints and is normalized', async () => {
    localStorage.setItem('flowguard.piCameraBaseUrl', 'http://runtime-pi.local:8081/');
    const pi = await loadPi(envConfig);
    expect(pi.getResolvedPiCameraConfig()).toMatchObject({
      source: 'runtime',
      baseUrl: 'http://runtime-pi.local:8081',
      healthUrl: 'http://runtime-pi.local:8081/health',
      streamUrl: 'http://runtime-pi.local:8081/video_feed',
      snapshotUrl: 'http://runtime-pi.local:8081/snapshot',
    });
  });

  test('save rejects invalid runtime URL and stores only a valid normalized base URL', async () => {
    const pi = await loadPi();
    expect(pi.saveRuntimePiCameraBaseUrl('http://pi.local:8081?secret=no').ok).toBe(false);
    expect(localStorage.getItem(pi.PI_CAMERA_STORAGE_KEY)).toBeNull();

    const saved = pi.saveRuntimePiCameraBaseUrl('http://pi.local:8081/');
    expect(saved.ok).toBe(true);
    expect(localStorage.getItem(pi.PI_CAMERA_STORAGE_KEY)).toBe('http://pi.local:8081');
    expect([...Array(localStorage.length)].map((_, i) => localStorage.key(i))).toEqual([
      pi.PI_CAMERA_STORAGE_KEY,
    ]);
  });

  test('reset removes only the runtime override and falls back to environment', async () => {
    localStorage.setItem('unrelated.setting', 'keep-me');
    localStorage.setItem('flowguard.piCameraBaseUrl', 'http://runtime-pi.local:8081');
    const pi = await loadPi(envConfig);
    const result = pi.clearRuntimePiCameraBaseUrl();
    expect(localStorage.getItem(pi.PI_CAMERA_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem('unrelated.setting')).toBe('keep-me');
    expect(result).toMatchObject({ source: 'environment', baseUrl: 'http://env-pi.local:8081' });
  });

  test('no runtime or VITE URLs produces an unconfigured state', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const pi = await loadPi();
    expect(pi.getResolvedPiCameraConfig()).toMatchObject({
      source: 'none',
      configured: false,
      status: 'not-configured',
    });
    await expect(pi.isPiCameraReachable()).resolves.toBe(false);
    await expect(pi.fetchPiSnapshotBitmap()).rejects.toMatchObject({ code: 'not-configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('VITE_ENABLE_PI_CAMERA=false overrides runtime configuration and prevents probes', async () => {
    localStorage.setItem('flowguard.piCameraBaseUrl', 'http://runtime-pi.local:8081');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const pi = await loadPi({ ...envConfig, VITE_ENABLE_PI_CAMERA: 'false' });
    expect(pi.getResolvedPiCameraConfig()).toMatchObject({ enabled: false, configured: false, status: 'disabled' });
    await expect(pi.isPiCameraReachable()).resolves.toBe(false);
    await expect(pi.isPiCameraReachableCached()).resolves.toBe(false);
    await expect(pi.testPiCameraConnection({ baseUrl: 'http://manual-pi.local:8081' })).resolves.toMatchObject({
      ok: false,
      status: 'disabled',
    });
    await expect(pi.fetchPiSnapshotBitmap()).rejects.toMatchObject({ code: 'disabled' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('health probing and snapshot cancellation', () => {
  test('health probe succeeds only for a healthy Camera Module 3 response', async () => {
    localStorage.setItem('flowguard.piCameraBaseUrl', 'http://pi.local:8081');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok', camera: 'Pi Camera Module 3', sequence: 4 }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const pi = await loadPi();
    await expect(pi.testPiCameraConnection()).resolves.toMatchObject({ ok: true, status: 'success' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://pi.local:8081/health',
      expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) })
    );
  });

  test('random successful HTTP response is classified as unexpected', async () => {
    localStorage.setItem('flowguard.piCameraBaseUrl', 'http://pi.local:8081');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok', service: 'not-a-camera' }),
    }));
    const pi = await loadPi();
    await expect(pi.testPiCameraConnection()).resolves.toMatchObject({
      ok: false,
      status: 'unexpected-response',
    });
  });

  test('external AbortSignal cancels an active Pi snapshot fetch', async () => {
    localStorage.setItem('flowguard.piCameraBaseUrl', 'http://pi.local:8081');
    vi.stubGlobal('fetch', vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    })));
    const pi = await loadPi();
    const controller = new AbortController();
    const request = pi.fetchPiSnapshotBitmap({ signal: controller.signal, timeoutMs: 10000 });
    controller.abort();
    await expect(request).rejects.toMatchObject({ code: 'aborted' });
  });

  test('permission-like browser failure is safely classified without exposing internals', async () => {
    localStorage.setItem('flowguard.piCameraBaseUrl', 'http://pi.local:8081');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Blocked by local network permission')));
    const pi = await loadPi();
    await expect(pi.testPiCameraConnection()).resolves.toMatchObject({
      ok: false,
      status: 'permission-required',
    });
  });
});
