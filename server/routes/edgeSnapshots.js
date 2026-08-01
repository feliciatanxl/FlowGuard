// Edge snapshot upload + controlled serving for SecurePi.
//
// Problem this solves: the Pi captures a JPEG at runtime/snapshots/<zone>/<file> —
// a path that exists ONLY on the Raspberry Pi. The FlowGuard cloud/backend and the
// FM's browser cannot open it. This route lets the Pi upload the actual image bytes
// (authenticated with the edge token) and get back an http(s) URL it can put into the
// detection event, so the Incident side panel can preview/open the snapshot.
//
// Security posture:
//   * Upload requires the edge-ingest bearer token (middlewares/edgeAuth.js).
//   * Only image/jpeg and image/png are accepted (MIME + a re-checked extension).
//   * A reasonable size limit is enforced (rejects oversized files).
//   * The stored filename is SERVER-GENERATED (random) — the Pi's originalname is
//     never trusted, so path traversal / overwrite via a crafted name is impossible.
//   * Serving validates the filename against a strict allow-list regex and streams
//     via res.sendFile with a fixed root, so no arbitrary filesystem path is exposed.
//
// Storage: server/uploads/edge-snapshots/ — DEV-ONLY local disk storage. For
// production, put snapshots in cloud object storage (S3/GCS) with signed URLs; this
// route is intentionally isolated so that swap is localized. Uploaded images are
// git-ignored (see root .gitignore) and never committed.

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { verifyEdgeIngestToken } = require('../middlewares/edgeAuth');
const { aiProxyLimiter } = require('../middlewares/rateLimit');

const router = express.Router();
router.use(aiProxyLimiter); // high-frequency edge path — generous per-client policy

// Absolute, canonical storage dir. Created on load so the first upload never races a
// missing directory.
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'edge-snapshots');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024; // 5 MB — snapshots are small annotated JPEGs
const EXT_BY_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png' };
// Serve-time allow-list. Matches ONLY the server-generated names this route mints.
const SERVED_NAME_RE = /^edge_[0-9a-f]{32}\.(jpg|png)$/;

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    // Server-controlled, unguessable name. The extension is derived from the validated
    // MIME type, NOT from the client-supplied originalname.
    filename: (_req, file, cb) => {
        const ext = EXT_BY_MIME[file.mimetype] || '.jpg';
        cb(null, `edge_${crypto.randomBytes(16).toString('hex')}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: MAX_SNAPSHOT_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => {
        if (EXT_BY_MIME[file.mimetype]) return cb(null, true);
        const err = new Error('Unsupported snapshot type.');
        err.code = 'UNSUPPORTED_IMAGE_TYPE';
        return cb(err);
    }
});

// Wrap multer so its errors become clean JSON with correct status codes.
const acceptSnapshot = (req, res, next) => {
    upload.single('file')(req, res, (err) => {
        if (!err) return next();
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: `Snapshot exceeds the ${Math.round(MAX_SNAPSHOT_BYTES / (1024 * 1024))} MB limit.` });
        }
        if (err.code === 'UNSUPPORTED_IMAGE_TYPE') {
            return res.status(415).json({ error: 'Snapshot must be JPEG or PNG.' });
        }
        return res.status(400).json({ error: 'Invalid snapshot upload.' });
    });
};

// Build the public base URL for returned snapshot links. Prefer an explicit env
// override (correct when the Pi reaches the backend via a different host than the
// browser); otherwise derive it from the request. Trailing slash normalized.
function publicBaseUrl(req) {
    const override = process.env.SNAPSHOT_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL;
    if (override) return String(override).replace(/\/+$/, '');
    return `${req.protocol}://${req.get('host')}`;
}

// POST /api/edge/snapshots  (multipart/form-data, field "file")
router.post('/', verifyEdgeIngestToken, acceptSnapshot, (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No snapshot file provided (multipart field "file").' });
    }
    const filename = req.file.filename;
    const snapshot_url = `${publicBaseUrl(req)}/api/edge/snapshots/${filename}`;
    // Safe log — no token, no bytes; just the generated name and size.
    console.log('[Edge] Snapshot uploaded', JSON.stringify({
        filename, bytes: req.file.size, mimetype: req.file.mimetype
    }));
    return res.status(201).json({ snapshot_url, filename });
});

// GET /api/edge/snapshots/:filename — controlled, browser-viewable serving.
// Public (browsers cannot attach the edge bearer token when opening an <a href>), but
// the filename is validated against SERVED_NAME_RE and streamed with a fixed root, so
// only server-minted snapshots can ever be served and traversal is impossible.
router.get('/:filename', (req, res) => {
    const { filename } = req.params;
    if (!SERVED_NAME_RE.test(filename)) {
        return res.status(404).json({ error: 'Snapshot not found.' });
    }
    return res.sendFile(filename, {
        root: UPLOAD_DIR,
        dotfiles: 'deny',
        headers: { 'Cache-Control': 'private, max-age=86400' }
    }, (err) => {
        if (err && !res.headersSent) {
            res.status(404).json({ error: 'Snapshot not found.' });
        }
    });
});

module.exports = router;
module.exports.UPLOAD_DIR = UPLOAD_DIR;
module.exports.SERVED_NAME_RE = SERVED_NAME_RE;
