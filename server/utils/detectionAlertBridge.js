// Shared helper for mapping a detection alert onto the IncidentLog row created
// alongside it — used by BOTH server/routes/detectionAlerts.js (AI engine + manual
// FM/Staff alerts) and server/routes/edgeDetectionAlerts.js (SecurePi edge alerts), so
// a crowd/person-count alert and an unattended-object alert never collapse onto the
// same incident type just because one route forgot the mapping.
//
// NOTE on naming: IncidentLog.status is misleadingly named — it stores the incident
// TYPE (UNATTENDED_OBJECT / OVERCROWDING / UNAUTHORIZED_ACCESS / ...), not a workflow
// state (that's IncidentLog.resolutionStatus). Preserved as-is rather than renamed, to
// avoid an unrelated schema/consumer redesign — every reader (IncidentDashboard.jsx)
// already expects this field to hold the type.
//
// Only values the Incident Dashboard's own "Log Incident" dropdown already understands
// (client/src/pages/IncidentDashboard.jsx) are ever returned.
//
// INCIDENT_TYPE_BY_DETECTION_TYPE comes from ../config/detectionTypes, the backend's
// single source of truth for detection_type values (shared with routes/zones.js).
const { INCIDENT_TYPE_BY_DETECTION_TYPE, DEFAULT_DETECTION_TYPE } = require('../config/detectionTypes');
// (client/src/pages/IncidentDashboard.jsx) are ever returned — including the SecurePi
// edge types PEST_DETECTION / RESTRICTED_MOTION / FORGOTTEN_BELONGING / ITEM_MOVEMENT,
// which were added to that dropdown alongside this mapping.
const DEFAULT_INCIDENT_TYPE = INCIDENT_TYPE_BY_DETECTION_TYPE[DEFAULT_DETECTION_TYPE];

// Resolves the IncidentLog type for a detection alert. Prefers an explicit
// Detection Setup detection_type (zone.detection_type) when the caller has one on
// hand; otherwise falls back to reading the alert's own alert_type/object_class text,
// since most detection alerts (AI-engine person-count/unattended-object alerts) don't
// carry an explicit detection_type today.
//
// Text-fallback ORDER matters and is deliberate: the specific edge categories (pest,
// restricted-zone motion, forgotten belonging, item movement) are matched BEFORE the
// generic person/crowd heuristic so a pest sighting or after-hours motion event is
// never mislabeled as OVERCROWDING or collapsed into UNATTENDED_OBJECT.
function resolveIncidentType({ alert_type, object_class, detection_type } = {}) {
    if (detection_type && INCIDENT_TYPE_BY_DETECTION_TYPE[detection_type]) {
        return INCIDENT_TYPE_BY_DETECTION_TYPE[detection_type];
    }

    const haystack = `${alert_type || ''} ${object_class || ''}`.toLowerCase();

    if (/unauthorized/.test(haystack)) {
        return 'UNAUTHORIZED_ACCESS';
    }
    // Pests: rat/mouse/rodent/pest as whole words (never a substring of another word).
    if (/\b(rat|mouse|mice|rodent|pest)\b/.test(haystack)) {
        return 'PEST_DETECTION';
    }
    // Restricted-zone / after-hours / night MOTION (needs both the qualifier and motion,
    // or the explicit "restricted-zone" phrase) so ordinary motion isn't over-flagged.
    if ((/motion/.test(haystack) && /(restricted|after[-\s]?hours|night)/.test(haystack)) || /restricted[-\s]?zone/.test(haystack)) {
        return 'RESTRICTED_MOTION';
    }
    // Forgotten belongings: "forgotten"/"belonging", or a laptop/item explicitly "left".
    if (/forgotten|belonging/.test(haystack) || /\b(laptop|item|bag)\s+left\b/.test(haystack)) {
        return 'FORGOTTEN_BELONGING';
    }
    // Item movement: picked up / set down / item moved.
    if (/picked up|set down|item moved|item movement/.test(haystack)) {
        return 'ITEM_MOVEMENT';
    }
    // Person/crowd-count alerts read like "Critical: Person Detected" or
    // "Warning: 3 People Detected" (see ai-service/main.py::_maybe_fire_person_alert).
    if (/\b(person|people)\b[\s\S]*detected/.test(haystack) || /crowd|density|overcrowd/.test(haystack)) {
        return 'OVERCROWDING';
    }
    return DEFAULT_INCIDENT_TYPE;
}

module.exports = { resolveIncidentType, INCIDENT_TYPE_BY_DETECTION_TYPE, DEFAULT_INCIDENT_TYPE };
