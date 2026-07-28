const positiveInteger = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

/**
 * Canonical browser-to-Node YOLO payload.
 *
 * UI camera cards use databaseId/zoneId while the Object Detection selector
 * uses id/zone_id. Both map to the one backend contract: camera_id/zone_id.
 */
export const buildAnalyzeFramePayload = (image, camera, source) => {
  const payload = { image };
  const cameraId = positiveInteger(camera?.databaseId ?? camera?.id);
  const zoneId = positiveInteger(camera?.zoneId ?? camera?.zone_id);

  if (cameraId !== null) payload.camera_id = cameraId;
  if (zoneId !== null) payload.zone_id = zoneId;
  if (typeof source === 'string' && source.trim()) payload.source = source.trim();

  return payload;
};

/** Build an Authorization header only for a real token. */
export const buildBearerHeaders = (token) => {
  if (typeof token !== 'string' || !token.trim()) return null;
  return { Authorization: `Bearer ${token.trim()}` };
};
