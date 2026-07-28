// Node proxy for the authenticated Cloud QR snapshot decoder.
//
// The FM's browser (or an FM capturing a Raspberry Pi Camera Module 3 snapshot)
// POSTs a single still here; this route forwards it to the FastAPI OpenCV
// decoder and returns the CANDIDATE booking reference it reports.
//
// It is a DECODE helper only — it never verifies a booking, grants/denies
// access, mutates booking status, writes GateAccessLog, or opens a barrier. The
// authoritative gate decision stays with POST /api/bookings/gate-verification.
// The frontend never calls FastAPI directly; all AI traffic goes through Node.
const express = require('express');
const router = express.Router();
const axios = require('axios');
const { verifyToken, requireRole } = require('../middlewares/auth');
const { aiServiceHeaders } = require('../services/aiServiceAuth');

// FACE_AI_URL is the BASE url of the AI service; the QR path is appended.
const FACE_AI_URL = () => process.env.FACE_AI_URL || 'http://127.0.0.1:8501';

// Base64 data-URL stills are ~1.33x the JPEG size; 8 MB of text comfortably
// covers a 1024px snapshot and rejects abuse before we forward anything.
const MAX_IMAGE_CHARS = 8 * 1024 * 1024;

// FM-gated: the Gate Verification page runs under an FM session.
router.post('/decode', verifyToken, requireRole('FM'), async (req, res) => {
  const { image } = req.body || {};
  if (typeof image !== 'string' || !image.startsWith('data:image/')) {
    return res.status(400).json({ success: false, bookingRef: null, message: 'A base64 data-URL image is required.' });
  }
  if (image.length > MAX_IMAGE_CHARS) {
    return res.status(413).json({ success: false, bookingRef: null, message: 'Image payload too large.' });
  }

  try {
    const aiResponse = await axios.post(`${FACE_AI_URL()}/api/qr/decode`, { image }, {
      timeout: 15000,
      headers: await aiServiceHeaders(FACE_AI_URL()),
    });
    // Pass the candidate result straight through (never persisted here).
    return res.status(200).json(aiResponse.data || { success: false, bookingRef: null });
  } catch (err) {
    const status = err.response?.status;
    // A 4xx from the AI service is a validation/decoding rejection — surface a
    // sanitized message (never the raw upstream stack).
    if (status && status >= 400 && status < 500) {
      return res.status(status).json({
        success: false,
        bookingRef: null,
        message: err.response?.data?.detail || 'The image could not be decoded.',
      });
    }
    // Cold start / network / 5xx: non-fatal. Local scanning + manual entry stay
    // available on the client, so respond 503 without leaking internals.
    console.error('QR decode proxy error:', err.message);
    return res.status(503).json({
      success: false,
      bookingRef: null,
      message: 'The cloud QR decoder is unavailable. Local scanning and manual entry remain available.',
    });
  }
});

module.exports = router;
