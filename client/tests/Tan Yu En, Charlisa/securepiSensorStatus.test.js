// Frontend tests for the SecurePi SENSOR contract — the PIR/ultrasonic telemetry that
// raspberry-pi4/sensor_bridge.py publishes and the Security Camera page's inspection
// workflow depends on. securepiStream.test.js covers URL resolution and camera health;
// this file covers normalizeSensorStatus and how sensor data reaches a caller.
//
// These are deterministic jsdom tests: they pin the normalisation contract, not a real
// Arduino, serial link, or PIR sensor.
import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  SECUREPI_CONNECTION_STATUS,
  deriveSecurePiEndpoints,
  normalizeSensorStatus,
  testSecurePiConnection,
} from '../../src/utils/securepiStream';

beforeEach(() => {
  vi.restoreAllMocks();
});

const STREAM_URL = 'http://securepi.local:8081/video_feed';

const jsonResponse = (body, ok = true, status = ok ? 200 : 500) => ({
  ok,
  status,
  json: vi.fn().mockResolvedValue(body),
});

// A realistic sensor_bridge payload for an idle, connected device.
const idleSensor = {
  connected: true,
  pir_ready: true,
  pir: false,
  distance_cm: 88.5,
  baseline_distance_cm: 90,
  distance_change_cm: 1.5,
  object_close: false,
  trigger: '',
  inspection_active: false,
  after_hours: false,
};

describe('deriveSecurePiEndpoints — sensor endpoint', () => {
  test.each([
    ['http://securepi.local:8081/video_feed', 'http://securepi.local:8081'],
    ['https://camera.example.test/mjpeg', 'https://camera.example.test'],
  ])('derives /sensor_status from the stream origin for %s', (streamUrl, origin) => {
    expect(deriveSecurePiEndpoints(streamUrl)).toMatchObject({
      valid: true,
      sensorStatusUrl: `${origin}/sensor_status`,
    });
  });

  test('an invalid stream URL yields no sensor endpoint', () => {
    expect(deriveSecurePiEndpoints('not a url').sensorStatusUrl).toBeUndefined();
  });
});

describe('normalizeSensorStatus — rejected inputs', () => {
  test.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'pir=true'],
    ['a number', 42],
    ['an array', [{ pir: true }]],
  ])('%s is not a sensor reading', (_label, input) => {
    expect(normalizeSensorStatus(input)).toBeNull();
  });

  test('an empty object still normalises, with every optional field absent', () => {
    expect(normalizeSensorStatus({})).toEqual({
      connected: true,
      pir_ready: null,
      pir: null,
      motion: null,
      distance_cm: null,
      baseline_distance_cm: null,
      distance_change_cm: null,
      object_close: null,
      trigger: '',
      inspection_active: null,
      inspection_remaining_seconds: null,
      after_hours: null,
      inspection_id: '',
      inspection_cycle_id: '',
    });
  });
});

describe('normalizeSensorStatus — motion and PIR aliasing', () => {
  test('an explicit pir reading also populates motion', () => {
    expect(normalizeSensorStatus({ pir: true })).toMatchObject({ pir: true, motion: true });
  });

  test('a device that reports only motion back-fills pir', () => {
    expect(normalizeSensorStatus({ motion: true })).toMatchObject({ pir: true, motion: true });
  });

  test('pir and motion are kept independent when the device sends both', () => {
    expect(normalizeSensorStatus({ pir: true, motion: false })).toMatchObject({ pir: true, motion: false });
  });

  test('a non-boolean pir is discarded rather than coerced to true', () => {
    expect(normalizeSensorStatus({ pir: 'HIGH' })).toMatchObject({ pir: null, motion: null });
  });

  test('pir false is preserved and never confused with "absent"', () => {
    expect(normalizeSensorStatus({ pir: false })).toMatchObject({ pir: false, motion: false });
  });
});

describe('normalizeSensorStatus — connection and boolean flags', () => {
  test('connected defaults to true when the device omits it', () => {
    expect(normalizeSensorStatus({ pir: false }).connected).toBe(true);
  });

  test('an explicit connected:false is preserved (bridge disabled / serial down)', () => {
    expect(normalizeSensorStatus({ connected: false }).connected).toBe(false);
  });

  test.each(['pir_ready', 'object_close', 'inspection_active', 'after_hours'])(
    '%s accepts booleans and rejects anything else',
    (field) => {
      expect(normalizeSensorStatus({ [field]: true })[field]).toBe(true);
      expect(normalizeSensorStatus({ [field]: false })[field]).toBe(false);
      expect(normalizeSensorStatus({ [field]: 'yes' })[field]).toBeNull();
      expect(normalizeSensorStatus({ [field]: 1 })[field]).toBeNull();
    }
  );
});

describe('normalizeSensorStatus — distance and countdown values', () => {
  test.each([
    'distance_cm',
    'baseline_distance_cm',
    'distance_change_cm',
    'inspection_remaining_seconds',
  ])('%s accepts finite non-negative numbers and numeric strings', (field) => {
    expect(normalizeSensorStatus({ [field]: 42.5 })[field]).toBe(42.5);
    expect(normalizeSensorStatus({ [field]: '42.5' })[field]).toBe(42.5);
    expect(normalizeSensorStatus({ [field]: 0 })[field]).toBe(0);
  });

  test.each([
    'distance_cm',
    'baseline_distance_cm',
    'distance_change_cm',
    'inspection_remaining_seconds',
  ])('%s rejects negatives, non-numerics, and non-finite values', (field) => {
    // A negative distance is a sensor fault, not a reading — it must not reach the UI.
    expect(normalizeSensorStatus({ [field]: -1 })[field]).toBeNull();
    expect(normalizeSensorStatus({ [field]: 'far' })[field]).toBeNull();
    expect(normalizeSensorStatus({ [field]: Infinity })[field]).toBeNull();
    expect(normalizeSensorStatus({ [field]: NaN })[field]).toBeNull();
    expect(normalizeSensorStatus({ [field]: null })[field]).toBeNull();
    expect(normalizeSensorStatus({ [field]: '' })[field]).toBeNull();
  });
});

describe('normalizeSensorStatus — trigger and inspection identifiers', () => {
  test('trigger text is trimmed', () => {
    expect(normalizeSensorStatus({ trigger: '  motion  ' }).trigger).toBe('motion');
  });

  test('a non-string trigger becomes an empty string, never "[object Object]"', () => {
    expect(normalizeSensorStatus({ trigger: { kind: 'motion' } }).trigger).toBe('');
    expect(normalizeSensorStatus({ trigger: 7 }).trigger).toBe('');
  });

  test('an overlong trigger is capped so a rogue device cannot flood the UI', () => {
    const flood = 'x'.repeat(500);
    expect(normalizeSensorStatus({ trigger: flood }).trigger).toHaveLength(120);
  });

  test('inspection_id and inspection_cycle_id are cross-populated from either key', () => {
    expect(normalizeSensorStatus({ inspection_id: 'cycle-7' })).toMatchObject({
      inspection_id: 'cycle-7',
      inspection_cycle_id: 'cycle-7',
    });
    expect(normalizeSensorStatus({ inspection_cycle_id: 'cycle-8' })).toMatchObject({
      inspection_id: 'cycle-8',
      inspection_cycle_id: 'cycle-8',
    });
  });

  test('a bare cycle_id satisfies both identifier fields', () => {
    // The Security Camera page uses this value as the alert idempotency key, so it must
    // survive whichever of the three spellings the device happens to send.
    expect(normalizeSensorStatus({ cycle_id: 'meta-cycle-3' })).toMatchObject({
      inspection_id: 'meta-cycle-3',
      inspection_cycle_id: 'meta-cycle-3',
    });
  });

  test('an explicit inspection_id wins over a differing cycle_id', () => {
    expect(normalizeSensorStatus({ inspection_id: 'primary', cycle_id: 'secondary' })).toMatchObject({
      inspection_id: 'primary',
    });
  });
});

describe('normalizeSensorStatus — an active inspection cycle', () => {
  test('a full triggered reading is preserved end to end', () => {
    const reading = normalizeSensorStatus({
      connected: true,
      pir_ready: true,
      pir: true,
      distance_cm: 35,
      baseline_distance_cm: 90,
      distance_change_cm: 55,
      object_close: true,
      trigger: 'motion',
      inspection_active: true,
      inspection_remaining_seconds: 12,
      after_hours: true,
      inspection_id: 'securepi-01:cycle:42',
    });

    expect(reading).toEqual({
      connected: true,
      pir_ready: true,
      pir: true,
      motion: true,
      distance_cm: 35,
      baseline_distance_cm: 90,
      distance_change_cm: 55,
      object_close: true,
      trigger: 'motion',
      inspection_active: true,
      inspection_remaining_seconds: 12,
      after_hours: true,
      inspection_id: 'securepi-01:cycle:42',
      inspection_cycle_id: 'securepi-01:cycle:42',
    });
  });
});

describe('testSecurePiConnection — sensor data surfaced from /health', () => {
  test('an embedded sensor block is normalised onto the connection details', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
        status: 'ok',
        camera: 'Pi Camera Module 3',
        streaming: true,
        latest_frame_age_seconds: 0.2,
        sensor: { ...idleSensor, pir: true, trigger: 'motion', inspection_active: true },
      }))
      .mockResolvedValueOnce(jsonResponse(null, false, 404));

    const result = await testSecurePiConnection({ streamUrl: STREAM_URL });

    expect(result).toMatchObject({
      ok: true,
      status: SECUREPI_CONNECTION_STATUS.CONNECTED,
      details: {
        sensor: {
          connected: true,
          pir: true,
          motion: true,
          trigger: 'motion',
          inspection_active: true,
          distance_cm: 88.5,
        },
      },
    });
  });

  test('a sensor bridge reporting connected:false still yields a healthy camera', async () => {
    // The camera and the sensor bridge fail independently — a dead Arduino must not
    // black out the video feed's status.
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
        status: 'ok',
        streaming: true,
        latest_frame_age_seconds: 0.1,
        sensor: { connected: false, last_error: 'Sensor bridge disabled' },
      }))
      .mockResolvedValueOnce(jsonResponse(null, false, 404));

    const result = await testSecurePiConnection({ streamUrl: STREAM_URL });

    expect(result.status).toBe(SECUREPI_CONNECTION_STATUS.CONNECTED);
    expect(result.details.sensor).toMatchObject({ connected: false });
  });

  test('health carrying sensor fields at the top level is still read as a sensor reading', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
        status: 'ok',
        streaming: true,
        latest_frame_age_seconds: 0.1,
        pir: true,
        distance_cm: 30,
      }))
      .mockResolvedValueOnce(jsonResponse(null, false, 404));

    const result = await testSecurePiConnection({ streamUrl: STREAM_URL });

    expect(result.details.sensor).toMatchObject({ pir: true, motion: true, distance_cm: 30 });
  });

  test('a stale camera frame does not discard the sensor reading', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
        status: 'ok',
        streaming: true,
        latest_frame_age_seconds: 45,
        sensor: { ...idleSensor, pir: true },
      }))
      .mockResolvedValueOnce(jsonResponse(null, false, 404));

    const result = await testSecurePiConnection({ streamUrl: STREAM_URL });

    expect(result.status).toBe(SECUREPI_CONNECTION_STATUS.STALE);
    expect(result.ok).toBe(true);
    expect(result.details.sensor).toMatchObject({ pir: true });
  });

  test('an invalid health body is rejected before any sensor value is trusted', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ status: 'meltdown', sensor: { pir: true } }));

    const result = await testSecurePiConnection({ streamUrl: STREAM_URL });

    expect(result.status).toBe(SECUREPI_CONNECTION_STATUS.INVALID_RESPONSE);
    expect(result.details).toBeUndefined();
  });

  test('no sensor request is issued while /health already answers the question', async () => {
    // Pins current behaviour: normalizeHealth always derives a sensor reading from the
    // health body, so the separate /sensor_status probe never fires from this helper.
    // If that changes, this test should be updated deliberately rather than by accident.
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
        status: 'ok',
        streaming: true,
        latest_frame_age_seconds: 0.1,
        sensor: idleSensor,
      }))
      .mockResolvedValueOnce(jsonResponse(null, false, 404));

    await testSecurePiConnection({ streamUrl: STREAM_URL });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://securepi.local:8081/health',
      'http://securepi.local:8081/people-count',
    ]);
  });

  test('sensor probing can be switched off without affecting camera health', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
        status: 'ok',
        streaming: true,
        latest_frame_age_seconds: 0.1,
        sensor: idleSensor,
      }));

    const result = await testSecurePiConnection({
      streamUrl: STREAM_URL,
      probeSensorStatus: false,
      probePeopleCount: false,
    });

    expect(result.status).toBe(SECUREPI_CONNECTION_STATUS.CONNECTED);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('the sensor probe never attaches credentials or a bearer token', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
        status: 'ok',
        streaming: true,
        latest_frame_age_seconds: 0.1,
        sensor: idleSensor,
      }))
      .mockResolvedValueOnce(jsonResponse(null, false, 404));

    await testSecurePiConnection({ streamUrl: STREAM_URL });

    for (const [, options] of fetchMock.mock.calls) {
      expect(options).toMatchObject({ cache: 'no-store', credentials: 'omit' });
      expect(options.headers).toBeUndefined();
    }
  });
});
