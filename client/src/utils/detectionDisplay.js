// Shared detection-display helpers for the Incident Dashboard side panel.
//
// These MIRROR the (module-local) helpers in pages/ObjectDetection.jsx so the incident
// detail panel formats edge-detection fields exactly like the Object Detection console.
//
// SECURITY: isRemoteSnapshot must stay byte-identical to ObjectDetection.jsx's version.
// ONLY a real http(s) URL may ever be rendered as a clickable snapshot link; a
// Raspberry Pi local path (e.g. runtime/snapshots/kitchen/pest_rat_4.jpg) must NEVER
// become an href — it isn't reachable from a browser and would be a misleading dead
// link. The Incident panel and the ObjectDetection console both rely on this guard.

export const isRemoteSnapshot = (url) =>
  typeof url === 'string' && /^https?:\/\//i.test(url.trim());

// Confidence may arrive as a 0–1 float (edge/AI alerts) or an already-scaled
// percentage. Returns an integer percent, or null when there is nothing to show.
export const confidencePercent = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  return Math.round(n <= 1 ? n * 100 : n);
};

// The specific detected object class (e.g. `rat`) for an edge detection alert, trimmed,
// or null when absent. Used so a pest incident visibly shows the animal rather than
// only the generic PEST_DETECTION incident type.
export const detectionObjectLabel = (alert) => {
  const cls = alert && alert.object_class ? String(alert.object_class).trim() : '';
  return cls || null;
};
