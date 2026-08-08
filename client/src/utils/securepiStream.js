// Browser-only helpers for the Raspberry Pi 5 / Sony IMX500 SecurePi service.
// The selected Camera Inventory stream URL is authoritative. A per-camera,
// browser-local override can take precedence so different hotspot users can
// resolve the same inventory camera without changing cloud data.

export const SECUREPI_OVERRIDE_STORAGE_PREFIX = 'flowguard.securepiStreamUrl.';
export const SECUREPI_STALE_FRAME_SECONDS = 10;

export const SECUREPI_CONNECTION_STATUS = Object.freeze({
  CONNECTED: 'connected',
  STALE: 'stale',
  TIMEOUT: 'timeout',
  UNREACHABLE: 'unreachable',
  PERMISSION_REQUIRED: 'permission-required',
  INVALID_RESPONSE: 'invalid-response',
  INVALID_URL: 'invalid-url',
  ABORTED: 'aborted',
});

const SECRET_QUERY_KEY = /(?:^|[_-])(?:access[_-]?token|api[_-]?key|auth|authorization|bearer|credential|jwt|password|secret|signature|token)(?:$|[_-])/i;
const SAFE_STATUS_VALUES = new Set(['ok', 'online', 'healthy', 'connected', 'degraded', 'stale']);
const OPTIONAL_ENDPOINT_UNSUPPORTED_STATUSES = new Set([404, 405, 501]);

const browserStorage = () => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

const overrideStorageKey = (cameraId) => (
  cameraId === undefined || cameraId === null || cameraId === ''
    ? ''
    : `${SECUREPI_OVERRIDE_STORAGE_PREFIX}${encodeURIComponent(String(cameraId))}`
);

const safeText = (value, maxLength = 120) => {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
};

const finiteNonNegative = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

export function validateSecurePiStreamUrl(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) {
    return { valid: false, normalized: '', error: 'Enter the SecurePi MJPEG stream URL.' };
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { valid: false, normalized: '', error: 'Enter a valid absolute SecurePi URL.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, normalized: '', error: 'Only http:// and https:// SecurePi URLs are allowed.' };
  }
  if (parsed.username || parsed.password) {
    return { valid: false, normalized: '', error: 'Credentials must not be embedded in the SecurePi URL.' };
  }
  if (parsed.hash) {
    return { valid: false, normalized: '', error: 'The SecurePi URL must not contain a fragment.' };
  }
  for (const key of parsed.searchParams.keys()) {
    if (SECRET_QUERY_KEY.test(key)) {
      return { valid: false, normalized: '', error: 'SecurePi URLs must not contain tokens, credentials, or secrets.' };
    }
  }

  return { valid: true, normalized: parsed.href, parsed, error: '' };
}

export const isHttpUrl = (value) => validateSecurePiStreamUrl(value).valid;

export function deriveSecurePiEndpoints(streamUrl) {
  const validation = validateSecurePiStreamUrl(streamUrl);
  if (!validation.valid) return { valid: false, error: validation.error };
  const { parsed } = validation;
  const origin = parsed.origin;
  return {
    valid: true,
    error: '',
    streamUrl: validation.normalized,
    origin,
    healthUrl: new URL('/health', origin).href,
    peopleCountUrl: new URL('/people-count', origin).href,
    sensorStatusUrl: new URL('/sensor_status', origin).href,
    snapshotUrl: new URL('/snapshot', origin).href,
    port: parsed.port || (parsed.protocol === 'https:' ? '443' : '80'),
  };
}

export function readSecurePiStreamOverride(cameraId, storage = browserStorage()) {
  const key = overrideStorageKey(cameraId);
  if (!key) return { present: false, valid: false, normalized: '', error: '' };
  let value;
  try {
    value = storage?.getItem?.(key) || '';
  } catch {
    return { present: false, valid: false, normalized: '', error: '' };
  }
  if (!value) return { present: false, valid: false, normalized: '', error: '' };
  return { present: true, ...validateSecurePiStreamUrl(value) };
}

export function saveSecurePiStreamOverride(cameraId, value, storage = browserStorage()) {
  const key = overrideStorageKey(cameraId);
  if (!key) return { ok: false, valid: false, normalized: '', error: 'Select a Camera Inventory camera first.' };
  const validation = validateSecurePiStreamUrl(value);
  if (!validation.valid) return { ok: false, ...validation };
  try {
    storage?.setItem?.(key, validation.normalized);
  } catch {
    return { ok: false, valid: false, normalized: '', error: 'The SecurePi override could not be saved in this browser.' };
  }
  if (!storage || typeof storage.setItem !== 'function') {
    return { ok: false, valid: false, normalized: '', error: 'Browser storage is unavailable.' };
  }
  return { ok: true, ...validation };
}

export function clearSecurePiStreamOverride(cameraId, storage = browserStorage()) {
  const key = overrideStorageKey(cameraId);
  try {
    if (key) storage?.removeItem?.(key);
  } catch {
    // A blocked storage API behaves like an absent local override.
  }
}

// Resolution order: browser-local override for this camera, selected Camera
// Inventory stream_url, development-only environment fallback, then empty.
export const getHardwareStreamUrl = (selectedCamera, envStreamUrl = '', localOverrideUrl = '') => {
  const storedOverride = localOverrideUrl
    ? validateSecurePiStreamUrl(localOverrideUrl)
    : readSecurePiStreamOverride(selectedCamera?.id);
  if (storedOverride.valid) return storedOverride.normalized;

  const inventory = validateSecurePiStreamUrl(selectedCamera?.stream_url);
  if (inventory.valid) return inventory.normalized;

  const environment = validateSecurePiStreamUrl(envStreamUrl);
  return environment.valid ? environment.normalized : '';
};

export const getHardwareHealthUrl = (streamUrl, envHealthUrl = '') => {
  const explicit = validateSecurePiStreamUrl(envHealthUrl);
  if (explicit.valid) return explicit.normalized;
  return deriveSecurePiEndpoints(streamUrl).healthUrl || '';
};

export const getHardwarePeopleCountUrl = (streamUrl, envPeopleCountUrl = '') => {
  const explicit = validateSecurePiStreamUrl(envPeopleCountUrl);
  if (explicit.valid) return explicit.normalized;
  return deriveSecurePiEndpoints(streamUrl).peopleCountUrl || '';
};

export const getHardwareSnapshotUrl = (streamUrl) => deriveSecurePiEndpoints(streamUrl).snapshotUrl || '';

function makeResult(status, details = {}) {
  return {
    ok: status === SECUREPI_CONNECTION_STATUS.CONNECTED || status === SECUREPI_CONNECTION_STATUS.STALE,
    status,
    ...details,
  };
}

function createRequestControl(externalSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const onExternalAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) onExternalAbort();
  else externalSignal?.addEventListener?.('abort', onExternalAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    didTimeOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      externalSignal?.removeEventListener?.('abort', onExternalAbort);
    },
  };
}

async function localNetworkPermissionState() {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) return 'unknown';
  for (const name of ['local-network', 'local-network-access']) {
    try {
      const result = await navigator.permissions.query({ name });
      if (result?.state) return result.state;
    } catch {
      // Try both browser permission names, then use the safe failure fallback.
    }
  }
  return 'unknown';
}

async function classifyFailure(error, { signal, timedOut }) {
  if (signal?.aborted && !timedOut) return makeResult(SECUREPI_CONNECTION_STATUS.ABORTED);
  if (timedOut) return makeResult(SECUREPI_CONNECTION_STATUS.TIMEOUT);
  if (error?.name === 'AbortError') return makeResult(SECUREPI_CONNECTION_STATUS.ABORTED);
  const permission = await localNetworkPermissionState();
  const message = String(error?.message || '').toLowerCase();
  if (permission === 'denied' || /local.?network|private.?network|mixed.?content|permission|security|blocked|cors/.test(message)) {
    return makeResult(SECUREPI_CONNECTION_STATUS.PERMISSION_REQUIRED);
  }
  return makeResult(SECUREPI_CONNECTION_STATUS.UNREACHABLE);
}

async function readJson(response) {
  if (!response.ok) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function normalizeSensorStatus(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const pir = typeof body.pir === 'boolean' ? body.pir : typeof body.motion === 'boolean' ? body.motion : null;
  const motion = typeof body.motion === 'boolean' ? body.motion : pir;
  return {
    connected: body.connected ?? true,
    pir_ready: typeof body.pir_ready === 'boolean' ? body.pir_ready : null,
    pir,
    motion,
    distance_cm: finiteNonNegative(body.distance_cm),
    baseline_distance_cm: finiteNonNegative(body.baseline_distance_cm),
    distance_change_cm: finiteNonNegative(body.distance_change_cm),
    object_close: typeof body.object_close === 'boolean' ? body.object_close : null,
    trigger: safeText(body.trigger),
    inspection_active: typeof body.inspection_active === 'boolean' ? body.inspection_active : null,
    inspection_remaining_seconds: finiteNonNegative(body.inspection_remaining_seconds),
    after_hours: typeof body.after_hours === 'boolean' ? body.after_hours : null,
    inspection_id: safeText(body.inspection_id || body.inspection_cycle_id || body.cycle_id),
    inspection_cycle_id: safeText(body.inspection_cycle_id || body.inspection_id || body.cycle_id),
  };
}

function normalizeHealth(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const status = safeText(body.status, 24).toLowerCase();
  if (!SAFE_STATUS_VALUES.has(status)) return null;
  if (body.detection_active !== undefined && typeof body.detection_active !== 'boolean') return null;
  if (body.streaming !== undefined && typeof body.streaming !== 'boolean') return null;
  const frameAgeSeconds = finiteNonNegative(
    body.latest_frame_age_seconds ?? body.frame_age_seconds ?? body.age_seconds
  );
  const frameAgeMs = finiteNonNegative(body.frameAgeMs ?? body.frame_age_ms);
  const sensor = normalizeSensorStatus(body.sensor) || normalizeSensorStatus(body);
  return {
    status,
    stale: status === 'stale' || status === 'degraded' || body.stale === true || body.streaming === false,
    streaming: typeof body.streaming === 'boolean' ? body.streaming : null,
    detectionActive: typeof body.detection_active === 'boolean' ? body.detection_active : null,
    deviceId: safeText(body.device_id),
    zone: safeText(body.zone || body.zone_name),
    cameraDescription: safeText(body.camera_description || body.camera || body.description),
    frameAgeSeconds: frameAgeSeconds ?? (frameAgeMs === null ? null : frameAgeMs / 1000),
    sensor,
  };
}

function normalizePeopleCount(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const count = finiteNonNegative(body.count ?? body.people_count ?? body.visible_people);
  if (count === null) return null;
  if (body.detection_active !== undefined && typeof body.detection_active !== 'boolean') return null;
  return {
    count: Math.floor(count),
    detectionActive: typeof body.detection_active === 'boolean' ? body.detection_active : false,
    deviceId: safeText(body.device_id),
    zone: safeText(body.zone || body.zone_name),
    frameAgeSeconds: finiteNonNegative(
      body.latest_frame_age_seconds ?? body.frame_age_seconds ?? body.age_seconds
    ),
  };
}

export async function testSecurePiConnection({
  streamUrl,
  timeoutMs = 3500,
  signal,
  probePeopleCount = true,
  probeSensorStatus = true,
} = {}) {
  const endpoints = deriveSecurePiEndpoints(streamUrl);
  if (!endpoints.valid) {
    return makeResult(SECUREPI_CONNECTION_STATUS.INVALID_URL, { error: endpoints.error });
  }

  const request = createRequestControl(signal, timeoutMs);
  const fetchOptions = {
    cache: 'no-store',
    credentials: 'omit',
    signal: request.signal,
  };

  try {
    const healthResponse = await fetch(endpoints.healthUrl, fetchOptions);
    const health = normalizeHealth(await readJson(healthResponse));
    if (!health) {
      return makeResult(SECUREPI_CONNECTION_STATUS.INVALID_RESPONSE, { endpoints });
    }

    let sensor = health.sensor;
    if (!sensor && probeSensorStatus && endpoints.sensorStatusUrl) {
      try {
        const sensorResponse = await fetch(endpoints.sensorStatusUrl, fetchOptions);
        if (sensorResponse.ok) {
          sensor = normalizeSensorStatus(await readJson(sensorResponse));
        }
      } catch (error) {
        if (error?.name !== 'TypeError') throw error;
      }
    }

    let people = null;
    let peopleCountSupported = false;
    if (probePeopleCount) {
      try {
        const countResponse = await fetch(endpoints.peopleCountUrl, fetchOptions);
        if (!OPTIONAL_ENDPOINT_UNSUPPORTED_STATUSES.has(countResponse.status)) {
          people = normalizePeopleCount(await readJson(countResponse));
          if (!people) {
            return makeResult(SECUREPI_CONNECTION_STATUS.INVALID_RESPONSE, { endpoints, health });
          }
          peopleCountSupported = true;
        }
      } catch (error) {
        if (error?.name !== 'TypeError') throw error;
      }
    }

    const frameAgeSeconds = people?.frameAgeSeconds ?? health.frameAgeSeconds;
    const stale = health.stale
      || (frameAgeSeconds !== null && frameAgeSeconds > SECUREPI_STALE_FRAME_SECONDS);
    return makeResult(
      stale ? SECUREPI_CONNECTION_STATUS.STALE : SECUREPI_CONNECTION_STATUS.CONNECTED,
      {
        endpoints,
        health,
        people,
        peopleCountSupported,
        details: {
          cameraDescription: health.cameraDescription,
          deviceId: people?.deviceId || health.deviceId,
          zone: people?.zone || health.zone,
          detectionActive: people?.detectionActive ?? health.detectionActive ?? false,
          visiblePeople: people?.count ?? null,
          frameAgeSeconds,
          streaming: health.streaming,
          sensor,
          resolvedPort: endpoints.port,
        },
      }
    );
  } catch (error) {
    return classifyFailure(error, {
      signal,
      timedOut: request.didTimeOut(),
    });
  } finally {
    request.cleanup();
  }
}
