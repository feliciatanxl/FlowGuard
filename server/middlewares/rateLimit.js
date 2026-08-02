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
//   - Keying: AFTER verifyToken a limiter keys by the VERIFIED req.user.id, so
//     separate authenticated users never share a quota. BEFORE auth (router-wide
//     / pre-auth limiters) it keys by the client IP. We NEVER decode a Bearer
//     token to pick a key — an unverified/forged JWT must not be able to choose
//     or rotate a rate-limit identity; verifyToken stays the only thing that
//     trusts a token.
//   - Trusted internal service-to-service calls (the Python AI engine, via the
//     shared AI_SERVICE_KEY header) are never throttled by the read/write/AI
//     limiters.
//   - Standard RateLimit-* + Retry-After headers; one consistent, safe 429 JSON
//     body that never echoes the key, IP or token.
//   - Every threshold is env-tunable with generous, polling-safe defaults
//     (see PART 2 frequency analysis in the security report).
//
// SCOPE / DEPLOYMENT CAVEAT: the default store is express-rate-limit's in-memory
// MemoryStore. Counters live in a SINGLE Node process and are NOT shared across
// instances. On Cloud Run each instance (and each cold start) keeps its own
// counters, so the effective limit is per-instance, not global — this is
// suitable for STAGING / single-instance use only. It is NOT distributed rate
// limiting. For globally-enforced limits across autoscaled instances, back these
// same limiters with a shared store (e.g. rate-limit-redis) — the factory below
// already isolates that as a one-line change. MemoryStore resets counters each
// window, so it does not retain every client key forever.

const { rateLimit } = require('express-rate-limit');

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

// Rate-limit key. When a limiter runs AFTER verifyToken, req.user.id is the
// VERIFIED account id and each authenticated user gets its own bucket. When it
// runs before auth (router-wide / pre-auth limiters), req.user is unset and we
// key by the client IP. We deliberately do NOT read or decode the Authorization
// header here: an unverified/forged JWT must never be able to select or rotate a
// rate-limit identity. Only verifyToken trusts tokens.
const keyByUserOrIp = (req) =>
  (req.user && req.user.id != null) ? `u:${req.user.id}` : ipKey(req);

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

// Public liveness/readiness probes. Cloud Run and external monitors ordinarily
// issue only a handful per minute, so 120/min/IP leaves substantial probe and
// rollout headroom while bounding abusive database-backed readiness traffic.
const healthPolicy = Object.freeze({
  windowMs: num(process.env.RATE_LIMIT_HEALTH_WINDOW_MS, 1 * MIN),
  max: num(process.env.RATE_LIMIT_HEALTH_MAX, 120),
});
const healthLimiter = makeLimiter({
  ...healthPolicy,
  keyGenerator: ipKey,
});

// Authenticated reads + dashboard/alert polling. Busiest legitimate poller does
// only a few requests/min per widget; 300/min/user leaves large headroom.
const readPolicy = Object.freeze({
  windowMs: num(process.env.RATE_LIMIT_READ_WINDOW_MS, 1 * MIN),
  max: num(process.env.RATE_LIMIT_READ_MAX, 300),
});
const readLimiter = makeLimiter({
  ...readPolicy,
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
const aiProxyPolicy = Object.freeze({
  windowMs: num(process.env.RATE_LIMIT_AI_WINDOW_MS, 1 * MIN),
  max: num(process.env.RATE_LIMIT_AI_MAX, 1200),
});
const aiProxyLimiter = makeLimiter({
  ...aiProxyPolicy,
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
  healthLimiter,
  readLimiter,
  writeLimiter,
  uploadLimiter,
  aiProxyLimiter,
  healthPolicy,
  readPolicy,
  aiProxyPolicy,
};
