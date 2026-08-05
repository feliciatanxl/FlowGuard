// Single source of truth (backend only) for detection_type → IncidentLog type mapping —
// used by routes/zones.js (validation) and utils/detectionAlertBridge.js (alert -> incident
// type mapping), so the two can never drift apart from each other.
//
// The Vite client (client/src/pages/detectionSettingsPayload.js) keeps its own local copy
// since browser bundles cannot import server modules; its DETECTION_TYPES keys must be
// kept in sync with ZONE_DETECTION_TYPES below by hand.
//
// INCIDENT_TYPE_BY_DETECTION_TYPE is the FULL mapping and the single source of truth for
// utils/detectionAlertBridge.js. It covers BOTH:
//   * the three Detection Setup zone categories an FM can pick per zone, AND
//   * the SecurePi / edge detection categories, which are never selected per zone but are
//     inferred from the edge alert_type text (pest / restricted-zone motion / forgotten
//     belonging / item movement) so an edge alert bridges into the correct incident type.
const INCIDENT_TYPE_BY_DETECTION_TYPE = {
  // Detection Setup zone categories (selectable as MonitoringZone.detection_type):
  unattended_object: 'UNATTENDED_OBJECT',
  crowd_density: 'OVERCROWDING',
  unauthorized_access: 'UNAUTHORIZED_ACCESS',
  // SecurePi / edge detection categories (inferred from edge alert text, not per-zone):
  pest_detection: 'PEST_DETECTION',
  restricted_motion: 'RESTRICTED_MOTION',
  forgotten_belonging: 'FORGOTTEN_BELONGING',
  item_movement: 'ITEM_MOVEMENT',
};

// The subset a MonitoringZone.detection_type may be set to in Detection Setup. The edge
// categories above are inferred from alert text, never chosen per zone, so routes/zones.js
// validation must keep offering only these three (kept explicit rather than derived from
// the full map above so adding an edge category never silently widens zone validation).
const ZONE_DETECTION_TYPES = ['unattended_object', 'crowd_density', 'unauthorized_access'];

const DETECTION_TYPES = ZONE_DETECTION_TYPES;
const DEFAULT_DETECTION_TYPE = 'unattended_object';

module.exports = {
  DETECTION_TYPES,
  ZONE_DETECTION_TYPES,
  DEFAULT_DETECTION_TYPE,
  INCIDENT_TYPE_BY_DETECTION_TYPE,
};
