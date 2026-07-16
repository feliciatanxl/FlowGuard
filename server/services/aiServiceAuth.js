// Service-to-service authentication headers for calls to the Python AI service.
//
// On Cloud Run the AI service is deployed PRIVATE (no unauthenticated access),
// so every Node -> AI request must carry a Google-signed ID token whose
// audience is the AI service's URL. Cloud Run's IAM layer verifies the token
// (the Node service account needs roles/run.invoker on the AI service) BEFORE
// the request reaches FastAPI. The application-level X-AI-Service-Key header
// is kept as defence in depth — FastAPI still validates it itself.
//
// The ID token comes from the GCE/Cloud Run METADATA SERVER using the
// service's ATTACHED service account — no service-account JSON key file is
// ever present in the repo, image, or environment.
//
// Local development: the metadata server only exists on Google infrastructure.
// We only attempt to fetch a token when running on Cloud Run (K_SERVICE is set
// by the platform) or when AI_ID_TOKEN=force is set for testing. Everywhere
// else the headers contain only X-AI-Service-Key, so `npm run dev` needs no
// Google credentials at all.

const axios = require('axios');

const METADATA_IDENTITY_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity';

// audience -> { token, expiresAtMs }
const tokenCache = new Map();
// Refresh 60s before expiry so a token never dies mid-request.
const EXPIRY_SKEW_MS = 60 * 1000;

const shouldUseIdToken = (env = process.env) => {
  if (env.AI_ID_TOKEN === 'off') return false;   // explicit opt-out
  if (env.AI_ID_TOKEN === 'force') return true;  // testing override
  return Boolean(env.K_SERVICE);                 // set by Cloud Run itself
};

// The Cloud Run audience is the receiving service's URL origin (never a path).
const audienceFor = (targetUrl) => new URL(targetUrl).origin;

const decodeExpiryMs = (idToken) => {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
};

async function fetchIdToken(audience) {
  const cached = tokenCache.get(audience);
  if (cached && Date.now() < cached.expiresAtMs - EXPIRY_SKEW_MS) {
    return cached.token;
  }
  const response = await axios.get(METADATA_IDENTITY_URL, {
    params: { audience },
    headers: { 'Metadata-Flavor': 'Google' },
    timeout: 3000,
    responseType: 'text',
    // axios would otherwise JSON-parse; the body is the raw JWT string.
    transformResponse: [(data) => data]
  });
  const token = String(response.data || '').trim();
  if (!token) throw new Error('Metadata server returned an empty identity token.');
  tokenCache.set(audience, { token, expiresAtMs: decodeExpiryMs(token) });
  return token;
}

/**
 * Headers for a Node -> AI-service request.
 * Always includes X-AI-Service-Key (app-level shared secret, defence in depth).
 * On Cloud Run also includes `Authorization: Bearer <Google ID token>` for the
 * private-service IAM check. A metadata-server failure is surfaced as a thrown
 * error ONLY on Cloud Run (where a missing token means a guaranteed 401/403);
 * locally no token is ever attempted.
 */
async function aiServiceHeaders(targetUrl, env = process.env) {
  const headers = { 'X-AI-Service-Key': env.AI_SERVICE_KEY || '' };
  if (!shouldUseIdToken(env)) return headers;
  const token = await fetchIdToken(audienceFor(targetUrl));
  headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

// Test hook — never used by production code paths.
const _clearTokenCache = () => tokenCache.clear();

module.exports = { aiServiceHeaders, shouldUseIdToken, audienceFor, _clearTokenCache };
