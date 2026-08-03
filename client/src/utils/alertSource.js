// Canonical alert-source label per sourceMode — the AI service whitelists these
// before forwarding them into POST /api/detection-alerts, so keep values in
// sync with ai-service/main.py's _ALLOWED_BROWSER_SOURCES.
//
// Kept in its own module (rather than exported from the ObjectDetection page)
// so tests and other consumers can import it without tripping React Fast
// Refresh's "component files may only export components" rule.
export const ALERT_SOURCE_BY_MODE = {
  camera: 'Browser Webcam',
  file: 'Uploaded Video',
  hardware: 'SecurePi Edge Node',
};

export const resolveAlertSource = (sourceMode) => ALERT_SOURCE_BY_MODE[sourceMode] || 'Browser Webcam';
