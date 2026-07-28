// Central, route-aware API rate limiting.
//
// Built on `express-rate-limit`, the established middleware the CodeQL
// "Missing rate limiting" query (js/missing-rate-limiting) recognises, so
// applying these limiters clears those alerts AND gives real DoS/abuse
// protection. Do not hand-roll per-route counters — use the named policies
// below (or `makeLimiter`) so behaviour stays consistent and maintainable.
//
// Design:
//   - One policy per risk class (auth, password-reset, public lookup,
//     authenticated read/poll, authenticated write, upload/image, AI proxy).
//   - Authenticated requests are keyed by user id so separate users never
//     share a quota; unauthenticated requests fall back to the client IP.
//   - Trusted internal service-to-service calls (the Python AI engine, via the
//     shared AI_SERVICE_KEY header) are never throttled by the read/write/AI
//     limiters.
//   - Standard RateLimit-* + Retry-After headers; one consistent, safe 429 JSON
//     body that never echoes the key, IP or token.
//   - Every threshold is env-tunable with generous, polling-safe defaults
//     (see PART 2 frequency analysis in the security report).
//   - Bounded memory: express-rate-limit's MemoryStore resets counters each
//     window instead of retaining every client key forever.

const { rateLimit } = require('express-rate-limit');
const jwt = require('jsonwebtoken');

const MIN = 60 * 1000;

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

// Consistent, safe 429 body — never leaks the rate-limit key, IP or token.
const TOO_MANY_BODY = { message: 'Too many requests. Please try again later.' };
const sendTooMany = (req, res) => res.status(429).json(TOO_MANY_BODY);

// Normalised client IP key. (This express-rate-limit build does not export the
// ipKeyGenerator helper, so we normalise the common IPv4-mapped-IPv6 form
// ourselves; the full address is otherwise used as-is, which only ever makes
// limiting stricter, never looser.)
const ipKey = (req) => {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  return `ip:${String(ip).replace(/^::ffff:/, '')}`;
};

// Is this a trusted internal service call (the Python AI engine posting alerts,
// refreshing caches, decoding QR)? Such callers present the shared
// AI_SERVICE_KEY and must not be throttled alongside browser traffic.
const isInternalService = (req) => {
  const key = req.headers['x-service-key'];
  return Boolean(key && process.env.AI_SERVICE_KEY && key === process.env.AI_SERVICE_KEY);
};

// Best-effort user id from the Bearer token for BUCKETING ONLY. This can run
// before verifyToken, so we only decode (never trust) the token to pick a key.
// A forged id merely lands in its own bucket — it never grants access, because
// verifyToken still checks the signature and the database. Falls back to IP.
const keyByUserOrIp = (req) => {
  if (req.user && req.user.id != null) return `u:${req.user.id}`;
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token) {
    try {
      const decoded = jwt.decode(token);
      if (decoded && decoded.id != null) return `u:${decoded.id}`;
    } catch {
      /* fall through to IP */
    }
  }
  return ipKey(req);
};

// Factory. Every limiter shares the same handler/headers so the 429 path is
// identical everywhere. `validate: false` silences express-rate-limit's dev
// proxy warnings — trust proxy is configured narrowly in index.js and we supply
// our own IP-safe key function.
const makeLimiter = ({ windowMs, max, keyGenerator = keyByUserOrIp, skipInternalService = false } = {}) =>
  rateLimit({
    windowMs,
    limit: max,
    standardHeaders: true, // RateLimit-* + Retry-After
    legacyHeaders: false,
    keyGenerator,
    ...(skipInternalService ? { skip: isInternalService } : {}),
    handler: sendTooMany,
    validate: false,
  });

// ---- Named production policies (env-tunable, polling-safe defaults) --------

// Auth (login/register): brute-force surface → strict, per IP.
const authLimiter = makeLimiter({
  windowMs: num(process.env.RATE_LIMIT_AUTH_WINDOW_MS, 15 * MIN),
  max: num(process.env.RATE_LIMIT_AUTH_MAX, 30),
  keyGenerator: ipKey,
});

// Password reset (forgot/reset): strict, per IP. Default 5/15min preserves the
// original forgot-password contract (and its test).
const passwordResetLimiter = makeLimiter({
  windowMs: num(process.env.RATE_LIMIT_RESET_WINDOW_MS, 15 * MIN),
  max: num(process.env.RATE_LIMIT_RESET_MAX, 5),
  keyGenerator: ipKey,
});

// Public unauthenticated lookups (e.g. GET /api/bookings/:ref for the driver
// pass, which polls every 12s → 5/min).
const publicLookupLimiter = makeLimiter({
  windowMs: num(process.env.RATE_LIMIT_PUBLIC_WINDOW_MS, 1 * MIN),
  max: num(process.env.RATE_LIMIT_PUBLIC_MAX, 60),
  keyGenerator: ipKey,
});

// Authenticated reads + dashboard/alert polling. Busiest legitimate poller does
// only a few requests/min per widget; 300/min/user leaves large headroom.
const readLimiter = makeLimiter({
  windowMs: num(process.env.RATE_LIMIT_READ_WINDOW_MS, 1 * MIN),
  max: num(process.env.RATE_LIMIT_READ_MAX, 300),
  skipInternalService: true,
});

// Authenticated writes (create/update/delete). Moderate.
const writeLimiter = makeLimiter({
  windowMs: num(process.env.RATE_LIMIT_WRITE_WINDOW_MS, 1 * MIN),
  max: num(process.env.RATE_LIMIT_WRITE_MAX, 120),
  skipInternalService: true,
});

// Upload / image enrolment — expensive, low-frequency (3-image enrol, manual
// evaluate). Tighter to protect the AI service from concurrency abuse.
const uploadLimiter = makeLimiter({
  windowMs: num(process.env.RATE_LIMIT_UPLOAD_WINDOW_MS, 1 * MIN),
  max: num(process.env.RATE_LIMIT_UPLOAD_MAX, 40),
  skipInternalService: true,
});

// AI proxy / high-frequency recognition + QR. GateScanner runs a 250ms track
// loop (240/min) + 1s recognition loop (60/min) → ~300/min/user at peak; the QR
// cloud fallback is capped at ≤1/s. 1200/min/user covers peak with ~4x headroom.
const aiProxyLimiter = makeLimiter({
  windowMs: num(process.env.RATE_LIMIT_AI_WINDOW_MS, 1 * MIN),
  max: num(process.env.RATE_LIMIT_AI_MAX, 1200),
  skipInternalService: true,
});

// Backward-compatible factory kept for existing imports:
//   createRateLimiter({ windowMs, max, keyFn })  (used by routes/user.js).
// Now backed by express-rate-limit; default is the strict per-IP reset policy.
const createRateLimiter = ({ windowMs = 15 * MIN, max = 5, keyFn } = {}) =>
  makeLimiter({
    windowMs,
    max,
    keyGenerator: keyFn ? (req) => String(keyFn(req) ?? ipKey(req)) : ipKey,
  });

module.exports = {
  // factory + helpers
  createRateLimiter,
  makeLimiter,
  keyByUserOrIp,
  ipKey,
  isInternalService,
  // named policies
  authLimiter,
  passwordResetLimiter,
  publicLookupLimiter,
  readLimiter,
  writeLimiter,
  uploadLimiter,
  aiProxyLimiter,
};
