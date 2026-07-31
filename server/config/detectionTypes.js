// Single source of truth (backend only) for Detection Setup's `detection_type` values —
// used by routes/zones.js (validation) and utils/detectionAlertBridge.js (alert -> incident
// type mapping), so the two can never drift apart from each other.
//
// The Vite client (client/src/pages/detectionSettingsPayload.js) keeps its own local copy
// since browser bundles cannot import server modules; its DETECTION_TYPES keys must be
// kept in sync with INCIDENT_TYPE_BY_DETECTION_TYPE's keys below by hand.
const INCIDENT_TYPE_BY_DETECTION_TYPE = {
  unattended_object: 'UNATTENDED_OBJECT',
  crowd_density: 'OVERCROWDING',
  unauthorized_access: 'UNAUTHORIZED_ACCESS',
};

const DETECTION_TYPES = Object.keys(INCIDENT_TYPE_BY_DETECTION_TYPE);
const DEFAULT_DETECTION_TYPE = 'unattended_object';

module.exports = { DETECTION_TYPES, DEFAULT_DETECTION_TYPE, INCIDENT_TYPE_BY_DETECTION_TYPE };
