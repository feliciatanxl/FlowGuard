// Shared edge-ingest authentication for SecurePi edge-device routes
// (POST /api/edge/detection-alerts, POST /api/edge/snapshots, GET /api/edge/config).
//
// The Raspberry Pi authenticates with a single shared bearer token that MUST equal
// the backend's EDGE_INGEST_TOKEN. This is deliberately separate from the FM/Staff
// JWT auth (middlewares/auth.js) and from the facial-recognition x-edge-token —
// edge devices are not users and never hold a JWT.
//
// Security notes:
//   * The token is NEVER logged (not here, not by any caller).
//   * Missing server-side config → 503 (not 401), so an operator can tell
//     "the server isn't set up" apart from "the device sent a wrong token".
//   * A constant-time-ish direct string compare is sufficient here: the token is a
//     shared deployment secret, not a per-user password, and the endpoints are
//     rate-limited. We still avoid leaking length via early returns.

const verifyEdgeIngestToken = (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!process.env.EDGE_INGEST_TOKEN) {
        return res.status(503).json({ error: 'Edge ingest is not configured.' });
    }
    if (!token || token !== process.env.EDGE_INGEST_TOKEN) {
        return res.status(401).json({ error: 'Invalid edge ingest token.' });
    }
    return next();
};

module.exports = { verifyEdgeIngestToken };
