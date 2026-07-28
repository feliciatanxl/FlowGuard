// Environment-based CORS allowlist that FAILS CLOSED in production/staging.
//
// Origins come from:
//   FRONTEND_URL     — canonical frontend origin used by generated links
//   CLIENT_URL       — the primary frontend origin (localhost:5173 in dev,
//                      the Cloud Run/Vercel URL when deployed)
//   ALLOWED_ORIGINS  — optional comma-separated extras (e.g. LAN dev origins
//                      like http://192.168.1.20:5173, a preview deployment)
//
// Behaviour:
//   - Production/staging (NODE_ENV=production|staging): ONLY the exact,
//     normalised configured origins are allowed. Nothing configured →
//     FAIL CLOSED: browser (Origin-bearing) requests are denied and a clear
//     configuration error is logged. A wildcard is NEVER used.
//   - Development (any other NODE_ENV): the configured origins are allowed;
//     when nothing is configured we allow a fixed set of localhost dev origins
//     (still an explicit allowlist — never a wildcard) so `npm run dev` works
//     with zero configuration.
//   - Requests with no Origin header (curl, server-to-server, the Python AI
//     engine) always pass through; CORS only governs browsers.
//   - An arbitrary Origin is never reflected, and credentials are never enabled
//     (FlowGuard authenticates with a Bearer JWT, not cookies), so a wildcard is
//     never combined with credentials.

const normalizeOrigin = (origin) => String(origin || '').trim().replace(/\/+$/, '');

// Localhost origins allowed ONLY in development when nothing is configured.
const DEV_DEFAULT_ORIGINS = [
  'http://localhost:5173', // Vite dev server
  'http://127.0.0.1:5173',
  'http://localhost:4173', // Vite preview
];

const isProductionLike = (env = process.env) => {
  const mode = String(env.NODE_ENV || '').toLowerCase();
  return mode === 'production' || mode === 'staging';
};

// PURE: exactly the configured origins, trimmed + de-duplicated. No environment
// defaults are injected here so this stays a faithful view of configuration.
const buildAllowedOrigins = (env = process.env) => {
  const origins = [env.FRONTEND_URL, env.CLIENT_URL, ...(env.ALLOWED_ORIGINS || '').split(',')]
    .map(normalizeOrigin)
    .filter(Boolean);
  return [...new Set(origins)];
};

// Build an allowlist-checking origin function. Never reflects an arbitrary
// origin, never returns a wildcard.
const originChecker = (allowed) => (origin, callback) => {
  // Non-browser callers send no Origin header — let them through.
  if (!origin || allowed.includes(normalizeOrigin(origin))) {
    return callback(null, true);
  }
  return callback(null, false); // browser gets no CORS headers → blocked
};

const buildCorsOptions = (env = process.env) => {
  const allowed = buildAllowedOrigins(env);

  if (allowed.length > 0) {
    return { origin: originChecker(allowed) };
  }

  // Nothing configured.
  if (isProductionLike(env)) {
    // FAIL CLOSED — never fall back to a wildcard in a deployed environment.
    // Only no-Origin (server-to-server) callers get through; every browser
    // origin is denied until FRONTEND_URL/CLIENT_URL/ALLOWED_ORIGINS is set.
    // eslint-disable-next-line no-console
    console.error(
      '[CORS] No allowed origins are configured in a production/staging environment. ' +
      'Set FRONTEND_URL, CLIENT_URL or ALLOWED_ORIGINS. All browser-origin requests are being DENIED until configured.'
    );
    return { origin: originChecker([]) };
  }

  // Development zero-config convenience: an explicit localhost allowlist (NOT a
  // wildcard), so credentials could be safely enabled later if ever needed.
  return { origin: originChecker(DEV_DEFAULT_ORIGINS) };
};

module.exports = { buildAllowedOrigins, buildCorsOptions, normalizeOrigin, isProductionLike, DEV_DEFAULT_ORIGINS };
