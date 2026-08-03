// Unified Raspberry Pi Camera Module 3 configuration and browser transport.
//
// Resolution order:
//   1. validated runtime base URL in localStorage
//   2. validated VITE_PI_CAMERA_* build-time endpoints
//   3. unconfigured -> laptop webcam fallback
//
// Runtime storage contains only the normalized device base URL. Camera frames,
// credentials, tokens, recognition results, and other sensitive data never
// belong in this module or its storage entry.

export const PI_CAMERA_STORAGE_KEY = 'flowguard.piCameraBaseUrl';
export const PI_CAMERA_CONFIG_EVENT = 'flowguard:pi-camera-config-changed';

export const PI_CONNECTION_STATUS = Object.freeze({
  SUCCESS: 'success',
  DISABLED: 'disabled',
  NOT_CONFIGURED: 'not-configured',
  INVALID_URL: 'invalid-url',
  ABORTED: 'aborted',
  UNREACHABLE: 'unreachable',
  PERMISSION_REQUIRED: 'permission-required',
  UNEXPECTED_RESPONSE: 'unexpected-response',
});

export const PI_CONFIG_SOURCE = Object.freeze({
  RUNTIME: 'runtime',
  ENVIRONMENT: 'environment',
  NONE: 'none',
});

export const CAMERA_SOURCES = Object.freeze({
  PI: 'pi',
  WEBCAM: 'webcam',
});

export const CAMERA_STATUS_MESSAGES = Object.freeze({
  PI_CONNECTED: 'Pi Gate Camera connected',
  PI_UNAVAILABLE: 'Pi Camera unavailable — using laptop webcam fallback',
  WEBCAM_ACTIVE: 'Laptop webcam active',
});

const ENV = import.meta.env || {};
const PI_EXPLICITLY_DISABLED =
  String(ENV.VITE_ENABLE_PI_CAMERA ?? '').trim().toLowerCase() === 'false';

const ENDPOINT_PATHS = Object.freeze({
  healthUrl: '/health',
  streamUrl: '/video_feed',
  snapshotUrl: '/snapshot',
});

const BASE_URL_ERROR =
  'Enter an HTTP or HTTPS device base URL with no credentials, path, query, or fragment.';

function storageForBrowser() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Validate and normalize a Pi base URL. */
export function validatePiCameraBaseUrl(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return { valid: false, normalized: '', error: 'Pi Camera Base URL is required.' };

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { valid: false, normalized: '', error: BASE_URL_ERROR };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, normalized: '', error: 'Only http:// and https:// Pi camera URLs are allowed.' };
  }
  if (parsed.username || parsed.password) {
    return { valid: false, normalized: '', error: 'Credentials must not be embedded in the Pi camera URL.' };
  }
  if (parsed.search) {
    return { valid: false, normalized: '', error: 'The Pi camera base URL must not include a query string.' };
  }
  if (parsed.hash) {
    return { valid: false, normalized: '', error: 'The Pi camera base URL must not include a fragment.' };
  }
  if (parsed.pathname && parsed.pathname !== '/') {
    return { valid: false, normalized: '', error: 'Enter the device base URL without an endpoint path.' };
  }

  return { valid: true, normalized: parsed.origin, error: '' };
}

export function normalizePiCameraBaseUrl(value) {
  const result = validatePiCameraBaseUrl(value);
  return result.valid ? result.normalized : '';
}

export function derivePiCameraUrls(baseUrl) {
  const validation = validatePiCameraBaseUrl(baseUrl);
  if (!validation.valid) return { valid: false, error: validation.error };
  const base = validation.normalized;
  return {
    valid: true,
    error: '',
    baseUrl: base,
    healthUrl: `${base}${ENDPOINT_PATHS.healthUrl}`,
    streamUrl: `${base}${ENDPOINT_PATHS.streamUrl}`,
    snapshotUrl: `${base}${ENDPOINT_PATHS.snapshotUrl}`,
  };
}

function baseFromEndpoint(value, expectedPath) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return { present: false, valid: true, baseUrl: '' };
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { present: true, valid: false, error: `Invalid Pi endpoint URL: ${raw}` };
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || parsed.pathname.replace(/\/$/, '') !== expectedPath
  ) {
    return { present: true, valid: false, error: `Pi endpoint must end with ${expectedPath}.` };
  }
  return { present: true, valid: true, baseUrl: parsed.origin };
}

export function readRuntimePiCameraBaseUrl(storage = storageForBrowser()) {
  let raw = '';
  try {
    raw = storage?.getItem?.(PI_CAMERA_STORAGE_KEY) || '';
  } catch {
    // Treat unavailable browser storage as an absent runtime override.
  }
  if (!raw) return { present: false, valid: false, value: '', normalized: '', error: '' };
  const validation = validatePiCameraBaseUrl(raw);
  return { present: true, value: raw, ...validation };
}

function environmentPiCameraConfig() {
  const endpoints = [
    baseFromEndpoint(ENV.VITE_PI_CAMERA_HEALTH_URL, ENDPOINT_PATHS.healthUrl),
    baseFromEndpoint(ENV.VITE_PI_CAMERA_STREAM_URL, ENDPOINT_PATHS.streamUrl),
    baseFromEndpoint(ENV.VITE_PI_CAMERA_SNAPSHOT_URL, ENDPOINT_PATHS.snapshotUrl),
  ];
  const present = endpoints.filter((entry) => entry.present);
  if (!present.length) return null;
  const invalid = present.find((entry) => !entry.valid);
  if (invalid) return { invalid: true, error: invalid.error };
  const bases = [...new Set(present.map((entry) => entry.baseUrl))];
  if (bases.length !== 1) {
    return { invalid: true, error: 'VITE Pi camera endpoints must use the same device base URL.' };
  }
  return derivePiCameraUrls(bases[0]);
}

function makeResolvedConfig({ source, status, enabled, urls, error = '' }) {
  return Object.freeze({
    source,
    status,
    enabled,
    configured: Boolean(enabled && urls?.valid),
    baseUrl: urls?.baseUrl || '',
    healthUrl: urls?.healthUrl || '',
    streamUrl: urls?.streamUrl || '',
    snapshotUrl: urls?.snapshotUrl || '',
    error,
  });
}

export function getResolvedPiCameraConfig() {
  if (PI_EXPLICITLY_DISABLED) {
    return makeResolvedConfig({
      source: PI_CONFIG_SOURCE.NONE,
      status: PI_CONNECTION_STATUS.DISABLED,
      enabled: false,
    });
  }

  const runtime = readRuntimePiCameraBaseUrl();
  if (runtime.present && runtime.valid) {
    return makeResolvedConfig({
      source: PI_CONFIG_SOURCE.RUNTIME,
      status: PI_CONNECTION_STATUS.SUCCESS,
      enabled: true,
      urls: derivePiCameraUrls(runtime.normalized),
    });
  }

  const environment = environmentPiCameraConfig();
  if (environment?.invalid) {
    return makeResolvedConfig({
      source: PI_CONFIG_SOURCE.ENVIRONMENT,
      status: PI_CONNECTION_STATUS.INVALID_URL,
      enabled: true,
      error: environment.error,
    });
  }
  if (environment?.valid) {
    return makeResolvedConfig({
      source: PI_CONFIG_SOURCE.ENVIRONMENT,
      status: PI_CONNECTION_STATUS.SUCCESS,
      enabled: true,
      urls: environment,
    });
  }

  return makeResolvedConfig({
    source: PI_CONFIG_SOURCE.NONE,
    status: PI_CONNECTION_STATUS.NOT_CONFIGURED,
    enabled: true,
  });
}

// Live ES-module bindings keep legacy consumers runtime-aware without a reload.
export let PI_CAMERA_HEALTH_URL = '';
export let PI_CAMERA_STREAM_URL = '';
export let PI_CAMERA_SNAPSHOT_URL = '';

function refreshPublicUrlBindings() {
  const config = getResolvedPiCameraConfig();
  PI_CAMERA_HEALTH_URL = config.healthUrl;
  PI_CAMERA_STREAM_URL = config.streamUrl;
  PI_CAMERA_SNAPSHOT_URL = config.snapshotUrl;
  return config;
}

function notifyConfigurationChanged(config) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent(PI_CAMERA_CONFIG_EVENT, { detail: config }));
}

export function saveRuntimePiCameraBaseUrl(value, storage = storageForBrowser()) {
  const validation = validatePiCameraBaseUrl(value);
  if (!validation.valid) return { ok: false, ...validation };
  if (!storage || typeof storage.setItem !== 'function') {
    return { ok: false, valid: false, normalized: '', error: 'Browser storage is unavailable, so the Pi camera URL cannot be saved.' };
  }
  try {
    storage.setItem(PI_CAMERA_STORAGE_KEY, validation.normalized);
  } catch {
    return { ok: false, valid: false, normalized: '', error: 'The Pi camera URL could not be saved in this browser.' };
  }
  const config = refreshPublicUrlBindings();
  notifyConfigurationChanged(config);
  resetPiAvailabilityCache();
  return { ok: true, ...validation, config };
}

export function clearRuntimePiCameraBaseUrl(storage = storageForBrowser()) {
  try {
    storage?.removeItem?.(PI_CAMERA_STORAGE_KEY);
  } catch {
    // A blocked storage API behaves like no runtime override.
  }
  const config = refreshPublicUrlBindings();
  notifyConfigurationChanged(config);
  resetPiAvailabilityCache();
  return config;
}

export function subscribeToPiCameraConfig(listener) {
  if (typeof window === 'undefined' || typeof listener !== 'function') return () => {};
  const handler = (event) => listener(event.detail || getResolvedPiCameraConfig());
  window.addEventListener(PI_CAMERA_CONFIG_EVENT, handler);
  return () => window.removeEventListener(PI_CAMERA_CONFIG_EVENT, handler);
}

refreshPublicUrlBindings();

export const PI_UNAVAILABLE_COOLDOWN_MS = 10000;
let piUnavailableUntil = 0;
let lastProbeResult = null;

export function markPiUnavailable(now = Date.now()) {
  piUnavailableUntil = now + PI_UNAVAILABLE_COOLDOWN_MS;
}

export function isPiInCooldown(now = Date.now()) {
  return now < piUnavailableUntil;
}

export function resetPiAvailabilityCache() {
  piUnavailableUntil = 0;
  lastProbeResult = null;
}

function makeResult(status, details = {}) {
  return { ok: status === PI_CONNECTION_STATUS.SUCCESS, status, ...details };
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
    timedOut: () => timedOut,
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
      // Try the legacy permission name, then fall back to message heuristics.
    }
  }
  return 'unknown';
}

async function classifyRequestFailure(error, { externalSignal, timedOut }) {
  if (externalSignal?.aborted) return makeResult(PI_CONNECTION_STATUS.ABORTED);
  if (timedOut) return makeResult(PI_CONNECTION_STATUS.UNREACHABLE, { reason: 'timeout' });
  if (error?.name === 'AbortError') return makeResult(PI_CONNECTION_STATUS.ABORTED);

  const message = String(error?.message || '').toLowerCase();
  const permissionState = await localNetworkPermissionState();
  const securityHint = /local.?network|private.?network|mixed.?content|permission|security|blocked|cors/.test(message);
  if (permissionState === 'denied' || securityHint) {
    return makeResult(PI_CONNECTION_STATUS.PERMISSION_REQUIRED, {
      reason: 'browser-security',
    });
  }
  return makeResult(PI_CONNECTION_STATUS.UNREACHABLE, { reason: 'network' });
}

export async function testPiCameraConnection({ baseUrl, timeoutMs = 3500, signal } = {}) {
  if (PI_EXPLICITLY_DISABLED) {
    return makeResult(PI_CONNECTION_STATUS.DISABLED);
  }

  let config;
  if (baseUrl !== undefined) {
    const urls = derivePiCameraUrls(baseUrl);
    if (!urls.valid) return makeResult(PI_CONNECTION_STATUS.INVALID_URL, { error: urls.error });
    config = { enabled: true, configured: true, ...urls };
  } else {
    config = getResolvedPiCameraConfig();
  }

  if (!config.enabled) return makeResult(PI_CONNECTION_STATUS.DISABLED);
  if (config.status === PI_CONNECTION_STATUS.INVALID_URL) {
    return makeResult(PI_CONNECTION_STATUS.INVALID_URL, { error: config.error });
  }
  if (!config.configured || !config.healthUrl) {
    return makeResult(PI_CONNECTION_STATUS.NOT_CONFIGURED);
  }

  const request = createRequestControl(signal, timeoutMs);
  try {
    const response = await fetch(config.healthUrl, {
      cache: 'no-store',
      signal: request.signal,
    });
    if (!response.ok) {
      return makeResult(PI_CONNECTION_STATUS.UNEXPECTED_RESPONSE, { httpStatus: response.status });
    }
    let body;
    try {
      body = await response.json();
    } catch {
      return makeResult(PI_CONNECTION_STATUS.UNEXPECTED_RESPONSE);
    }
    if (body?.status !== 'ok' || body?.camera !== 'Pi Camera Module 3') {
      return makeResult(PI_CONNECTION_STATUS.UNEXPECTED_RESPONSE);
    }
    return makeResult(PI_CONNECTION_STATUS.SUCCESS, { health: body });
  } catch (error) {
    return classifyRequestFailure(error, {
      externalSignal: signal,
      timedOut: request.timedOut(),
    });
  } finally {
    request.cleanup();
  }
}

export async function probePiCamera(options = {}) {
  return testPiCameraConnection(options);
}

export async function isPiCameraReachable(timeoutMs = 3500, options = {}) {
  const result = await testPiCameraConnection({ ...options, timeoutMs });
  lastProbeResult = result;
  return result.ok;
}

export async function isPiCameraReachableCached(now = Date.now(), options = {}) {
  const config = getResolvedPiCameraConfig();
  if (!config.enabled || !config.configured) return false;
  if (isPiInCooldown(now)) return false;
  const result = await testPiCameraConnection(options);
  lastProbeResult = result;
  if (!result.ok) markPiUnavailable();
  else piUnavailableUntil = 0;
  return result.ok;
}

export function getLastPiProbeResult() {
  return lastProbeResult;
}

export async function fetchPiSnapshotBitmap(timeoutOrOptions = 4000) {
  const options = typeof timeoutOrOptions === 'number'
    ? { timeoutMs: timeoutOrOptions }
    : (timeoutOrOptions || {});
  const { timeoutMs = 4000, signal } = options;
  const config = getResolvedPiCameraConfig();
  if (!config.enabled) {
    const error = new Error('Pi camera is disabled.');
    error.code = PI_CONNECTION_STATUS.DISABLED;
    throw error;
  }
  if (!config.configured || !config.snapshotUrl) {
    const error = new Error('Pi camera is not configured.');
    error.code = PI_CONNECTION_STATUS.NOT_CONFIGURED;
    throw error;
  }

  const request = createRequestControl(signal, timeoutMs);
  try {
    const separator = config.snapshotUrl.includes('?') ? '&' : '?';
    const response = await fetch(`${config.snapshotUrl}${separator}t=${Date.now()}`, {
      cache: 'no-store',
      signal: request.signal,
    });
    if (!response.ok) {
      const error = new Error(`Pi snapshot returned HTTP ${response.status}.`);
      error.code = PI_CONNECTION_STATUS.UNEXPECTED_RESPONSE;
      throw error;
    }
    const blob = await response.blob();
    return await createImageBitmap(blob);
  } catch (error) {
    if (Object.values(PI_CONNECTION_STATUS).includes(error?.code)) throw error;
    const result = await classifyRequestFailure(error, {
      externalSignal: signal,
      timedOut: request.timedOut(),
    });
    const safeError = new Error(
      result.status === PI_CONNECTION_STATUS.PERMISSION_REQUIRED
        ? 'Local-network permission may be required to reach the Pi camera.'
        : result.status === PI_CONNECTION_STATUS.ABORTED
          ? 'Pi snapshot request was cancelled.'
          : 'Pi camera is unreachable.'
    );
    safeError.code = result.status;
    throw safeError;
  } finally {
    request.cleanup();
  }
}
