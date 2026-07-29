// Server binding configuration — works locally AND on cloud hosts.
//
// Port: cloud platforms (Render, Cloud Run, Heroku) inject PORT; local dev uses
// APP_PORT from .env; 5001 is the documented local default.
// Host: 0.0.0.0 so a deployed container accepts external traffic. Binding
// exclusively to 127.0.0.1 breaks any cloud deployment; 0.0.0.0 also works for
// local development (localhost still resolves to it).

const resolvePort = (env = process.env) =>
  Number(env.PORT || env.APP_PORT || 5001);

const resolveHost = (env = process.env) => env.HOST || '0.0.0.0';

// Parse TRUST_PROXY into the value Express's `trust proxy` setting expects.
// Env vars are ALWAYS strings, so a numeric string like "1" must be converted to
// Number(1) (a proxy hop count) — blindly Number()-ing would turn a named preset
// or subnet ("loopback", "10.0.0.0/8", "127.0.0.1,10.0.0.0/8") into NaN, so those
// are passed through unchanged for Express to parse. "true"/"false" become
// booleans. Undefined/empty → the safe single-hop default (Cloud Run / Render).
//   ""/undefined -> 1        "0" -> 0            "1" -> 1
//   "true"->true "false"->false   "loopback"/"10.0.0.0/8" -> string (as-is)
const parseTrustProxy = (value, fallback = 1) => {
  if (value === undefined || value === null) return fallback;
  const str = String(value).trim();
  if (str === '') return fallback;
  const lower = str.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  if (/^\d+$/.test(str)) return Number(str); // hop count
  return str; // named preset / IP / subnet / comma-separated list
};

module.exports = { resolvePort, resolveHost, parseTrustProxy };
