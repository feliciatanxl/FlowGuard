const express = require('express');
const router = express.Router();
const { aiProxyLimiter } = require('../middlewares/rateLimit');
router.use(aiProxyLimiter); // high-frequency frame analysis + people-count polling
const axios = require('axios');
const { verifyToken, requireRole } = require('../middlewares/auth');
const { aiServiceHeaders } = require('../services/aiServiceAuth');

// Authenticated proxy for the AI service's YOLO endpoints. The browser used to
// call FastAPI directly (via the Vite/Nginx "/ai" proxy); the AI service is now
// deployed PRIVATE on Cloud Run, so all object-detection traffic flows
// Browser -> Node (JWT/RBAC) -> AI service (Google ID token + service key).
// FACE_AI_URL is the BASE url of the AI service; paths are appended.
const FACE_AI_URL = () => process.env.FACE_AI_URL || 'http://127.0.0.1:8501';

// Base64 data-URL frames are ~1.33x the JPEG size; same ceiling as the
// facial-recognition routes.
const MAX_IMAGE_CHARS = 8 * 1024 * 1024;

// Same audience as the Object Detection dashboard's other data (zones,
// cameras, detection alerts): FM and Staff.
const allowDetectionRoles = [verifyToken, requireRole('FM', 'Staff')];

const respondAiError = (res, err, serviceLabel) => {
  const isConnError = !err.response &&
    ['ECONNREFUSED', 'ECONNABORTED', 'ETIMEDOUT', 'ENOTFOUND'].includes(err.code);
  if (isConnError) {
    return res.status(503).json({ error: `${serviceLabel} is offline. Please try again shortly.` });
  }
  if (err.response) {
    const status = err.response.status === 400 ? 400 : 502;
    return res.status(status).json({ error: `${serviceLabel} returned an error.` });
  }
  console.error(`${serviceLabel} proxy error:`, err.message);
  return res.status(502).json({ error: `${serviceLabel} returned an error.` });
};

// GET /api/yolo/people-count — live people count from the latest analyzed frame.
router.get('/people-count', ...allowDetectionRoles, async (_req, res) => {
  try {
    const baseUrl = FACE_AI_URL();
    const aiResponse = await axios.get(`${baseUrl}/api/yolo/people-count`, {
      timeout: 8000,
      headers: await aiServiceHeaders(baseUrl)
    });
    const { count = 0, detection_active = false, camera_status = 'unknown' } = aiResponse.data || {};
    return res.status(200).json({ count, detection_active, camera_status });
  } catch (err) {
    return respondAiError(res, err, 'Object detection service');
  }
});

// POST /api/yolo/analyze-frame — forward one browser-captured frame for YOLO
// analysis. Only whitelisted fields are forwarded; the AI reply is passed
// through as-is (it contains no identity data — see ai-service/main.py).
router.post('/analyze-frame', ...allowDetectionRoles, async (req, res) => {
  const { image, camera_id, zone_id, source } = req.body || {};
  if (typeof image !== 'string' || !image.startsWith('data:image/')) {
    return res.status(400).json({ error: 'A base64 data-URL image is required.' });
  }
  if (image.length > MAX_IMAGE_CHARS) {
    return res.status(413).json({ error: 'Image payload too large.' });
  }

  const payload = { image };
  if (camera_id !== undefined && camera_id !== null && camera_id !== '') payload.camera_id = Number(camera_id);
  if (zone_id !== undefined && zone_id !== null && zone_id !== '') payload.zone_id = Number(zone_id);
  if (typeof source === 'string' && source) payload.source = source;

  try {
    const baseUrl = FACE_AI_URL();
    const aiResponse = await axios.post(`${baseUrl}/api/yolo/analyze-frame`, payload, {
      timeout: 20000,
      headers: await aiServiceHeaders(baseUrl)
    });
    return res.status(200).json(aiResponse.data || {});
  } catch (err) {
    return respondAiError(res, err, 'Object detection service');
  }
});

module.exports = router;
