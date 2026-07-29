# Zone / Detection Settings Hardcoding Cleanup

**Date:** 2026-07-29
**Related:** `docs/Tan Yu En, Charlisa/camera-inventory-detection-setup-api.md`

## Why

An audit of the Detection Setup ("zones") form found two categories of hardcoding worth
fixing without changing any runtime behavior:

1. The AI service's fallback detection threshold was a fixed Python constant with no way
   to tune it per deployment.
2. The `detection_type` enum (`unattended_object`, `crowd_density`, `unauthorized_access`)
   was copy-pasted independently in three backend/frontend files, kept in sync only by a
   comment — a real risk of drift as the feature grows.

## What changed

### 1. AI-service fallback threshold is now env-configurable

`ai-service/zone_rules.py`'s `DEFAULT_ZONE_THRESHOLD_SEC` (used only when a requested
camera/zone can't be resolved to a Detection Setup rule) now reads from the
`DEFAULT_ZONE_THRESHOLD_SEC` environment variable at import time, falling back to `300`
seconds (5 minutes) if the variable is unset, non-numeric, or not positive. Documented in
`ai-service/.env.example`. Old deployments that never set the variable behave identically
to before.

### 2. Backend detection-type source of truth

New module: `server/config/detectionTypes.js`

```js
const INCIDENT_TYPE_BY_DETECTION_TYPE = {
  unattended_object: 'UNATTENDED_OBJECT',
  crowd_density: 'OVERCROWDING',
  unauthorized_access: 'UNAUTHORIZED_ACCESS',
};
const DETECTION_TYPES = Object.keys(INCIDENT_TYPE_BY_DETECTION_TYPE);
const DEFAULT_DETECTION_TYPE = 'unattended_object';
```

Both `server/routes/zones.js` (request validation) and
`server/utils/detectionAlertBridge.js` (alert → incident-type mapping) now import from
this single module instead of each holding their own copy. `DEFAULT_INCIDENT_TYPE` in the
alert bridge is derived from the map (`INCIDENT_TYPE_BY_DETECTION_TYPE[DEFAULT_DETECTION_TYPE]`)
rather than a second hardcoded string, so it can never drift from it.

### What stays intentionally duplicated

- **`client/src/pages/detectionSettingsPayload.js`** still keeps its own local
  `DETECTION_TYPES` object (labels + per-type form defaults). The Vite client bundle
  cannot import server-side modules, so this can't be fully unified without adding a new
  API endpoint — which wasn't judged necessary for a three-value enum that rarely
  changes. A comment now points at `server/config/detectionTypes.js` as the value list to
  keep it matched against by hand.
- **`SEVERITIES`** (`server/routes/zones.js`, `DetectionSettings.jsx`) and the Sequelize
  `ENUM('Low','Medium','High','Critical')` in `server/models/MonitoringZone.js` were left
  untouched — out of scope for this cleanup.

## Tests

- `ai-service/tests/test_zone_threshold_env.py` (new) — missing env var, valid override,
  non-numeric, zero/negative, and that `error_config()` actually uses the override.
- `server/tests/Tan Yu En, Charlisa/detection-types-config.test.js` (new) — shape of the
  shared config module.
- `server/tests/Tan Yu En, Charlisa/detection-setup.test.js` — added a `test.each`
  confirming all three existing detection types are still accepted by `POST /api/zones`.

All existing suites still pass: `ai-service` unit tests (16 total across both zone_rules
test files), full server Jest suite (23 suites / 321 tests), and a clean `vite build` for
the client.

## Deployment notes

No migration required. Optionally set `DEFAULT_ZONE_THRESHOLD_SEC` in the AI service's
real `.env` to override the 5-minute fallback; omitting it preserves current behavior.
