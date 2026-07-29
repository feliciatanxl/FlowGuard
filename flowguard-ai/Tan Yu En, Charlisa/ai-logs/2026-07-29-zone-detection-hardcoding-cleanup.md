# AI Log — Zone / Detection Settings Hardcoding Cleanup
**Date:** 2026-07-29
**Branch:** feature/object-detection-space-v2
**Tool:** Claude Code (Sonnet 5)

---

## Task 1 — Audit zone form for hardcoded values

**Prompt:** "so for my zones in object detection are there any areas in the form that are
hardcoded"

**Response summary:** Delegated the audit to an Explore subagent to search the Detection
Setup / zones feature across frontend, backend, and the AI service without narrating my
own duplicate searches. The agent (and this reply, synthesizing its findings) reported:
(1) the `detection_type` enum duplicated independently across
`client/src/pages/detectionSettingsPayload.js`, `server/routes/zones.js`, and
`server/utils/detectionAlertBridge.js`, kept in sync only by a comment; (2) the
`severity` enum duplicated across the same frontend file, `zones.js`, and the Sequelize
ENUM in `server/models/MonitoringZone.js`; (3) per-detection-type defaults (thresholds,
monitored classes) baked into the frontend bundle rather than served from config; (4) the
AI-service's `DEFAULT_ZONE_THRESHOLD_SEC = 300` fallback in `ai-service/zone_rules.py`
hardcoded with no env override; (5) `/api/zones` and `/api/cameras` URLs hardcoded inline
in `DetectionSettings.jsx` rather than centralized. Noted this is a rules/threshold-based
zone form, not a polygon-coordinate editor, so no hardcoded resolution/dimension/default
-shape issues exist. Ended by asking whether to consolidate the two duplicated enums into
a shared source of truth.

**Outcome:** Accepted as the input to Task 2 — the user's next message scoped a cleanup
directly against these findings (items 1 and 4 specifically), confirming the audit's
priorities without further correction.

---

## Task 2 — Clean up the hardcoding without changing behavior

**Prompt:** A tightly scoped cleanup request: (1) make `DEFAULT_ZONE_THRESHOLD_SEC` in
`ai-service/zone_rules.py` read from an environment variable, keeping `300` as the
fallback for missing/invalid values, updating `.env.example`, without breaking existing
tests or deployments; (2) reduce the duplicated `detection_type` constants by creating a
shared backend source of truth (explicitly: don't import server files into the Vite
client, keep the frontend copy local with a sync comment, don't add a new API endpoint
unless genuinely necessary); (3) explicitly leave the severity ENUM, severity dropdown,
per-type frontend defaults, `assigned_team`, `detection_type` runtime behavior, and
existing routes untouched; (4) preserve all existing zone-rule fields
(`density_threshold`, `alert_cooldown_seconds`, `monitored_classes`, `severity`,
`unattended_threshold_seconds`, `detection_enabled`, SecurePi zone-config polling); (5)
add focused tests for the env override, invalid-env fallback, detection-type validation,
and the alert-bridge mapping; (6) run the relevant test/build suites and report exact
files changed, what was centralized, what remains duplicated, test results, and any
deployment steps.

**Response summary:** Read `zone_rules.py`, `zones.js`, `detectionAlertBridge.js`,
`detectionSettingsPayload.js`, and the existing test suites first to find the smallest
safe change. Changes made:
- `ai-service/zone_rules.py` — `DEFAULT_ZONE_THRESHOLD_SEC` now computed once at import
  time via `_read_default_zone_threshold_sec()`, reading `os.getenv`, falling back to
  `300` on missing/non-numeric/non-positive values; same constant name/shape so all
  existing imports and tests keep working unmodified.
- `ai-service/.env.example` — documented the new optional `DEFAULT_ZONE_THRESHOLD_SEC`.
- New `server/config/detectionTypes.js` — single backend source of truth exporting
  `DETECTION_TYPES`, `DEFAULT_DETECTION_TYPE`, `INCIDENT_TYPE_BY_DETECTION_TYPE`.
- `server/routes/zones.js` and `server/utils/detectionAlertBridge.js` — now import from
  that shared config instead of each holding an independent copy;
  `DEFAULT_INCIDENT_TYPE` is now derived from the map instead of a second hardcoded
  string, so it can't drift from it.
- `client/src/pages/detectionSettingsPayload.js` — left the values untouched, only added
  a comment pointing at `server/config/detectionTypes.js` as the thing to keep it in sync
  with (per the "don't import server into Vite" and "keep frontend local" constraints).
  Deliberately did not add a new config-serving API endpoint, as it wasn't necessary for
  a three-value enum.
- New tests: `ai-service/tests/test_zone_threshold_env.py` (missing/valid/invalid/
  zero-or-negative env var, and that `error_config` actually uses the override),
  `server/tests/Tan Yu En, Charlisa/detection-types-config.test.js` (shared config
  module's shape), and a `test.each` added to the existing `detection-setup.test.js`
  explicitly asserting all three detection types are still accepted.
- Ran `python tests/test_zone_resolution.py` (11 passed) and
  `test_zone_threshold_env.py` (5 passed); `npx jest` for the full server suite (23
  suites / 321 tests passed); `npx vite build` for the client (clean, pre-existing
  chunk-size warning only). Reported the full file list, what stayed intentionally
  duplicated (frontend `DETECTION_TYPES` labels/defaults, `SEVERITIES` arrays, the
  Sequelize ENUM), and that no migration or deployment step is required beyond
  optionally setting the new env var.

**Outcome:** No explicit accept/edit/reject yet — the user's next message moved directly
to requesting this session log rather than reacting to the cleanup itself.
