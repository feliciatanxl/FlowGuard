// Mock-safe WhatsApp Cloud API service for Smart Logistics.
//
// Reads ALL credentials from environment variables only — nothing is hardcoded.
//   WHATSAPP_ENABLED            must be exactly "true" to send for real (else mock mode)
//   WHATSAPP_API_URL            e.g. https://graph.facebook.com/v20.0
//   WHATSAPP_ACCESS_TOKEN       Meta access token (preferred)
//   WHATSAPP_API_KEY            fallback token if ACCESS_TOKEN is unset
//   WHATSAPP_PHONE_NUMBER_ID    Meta phone number id
//
// Never throws — always resolves to a result object so a booking flow can't crash on it.

const { formatSingaporeDateTime, formatSingaporeTime } = require('../utils/bookingDateTime');

// Read config at call time so env changes (and tests) are picked up; token has a fallback.
function readConfig() {
  return {
    enabled: process.env.WHATSAPP_ENABLED === 'true',
    apiUrl: process.env.WHATSAPP_API_URL,
    token: process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_API_KEY,
    phoneId: process.env.WHATSAPP_PHONE_NUMBER_ID,
  };
}

// Backwards-compatible API-key mask (last 4 only).
function maskKey(key) {
  if (!key) return '(none)';
  return key.length <= 4 ? '****' : `****${key.slice(-4)}`;
}

// Access-token mask — first 6 + last 4 only.
function maskToken(token) {
  if (!token) return '(none)';
  return token.length <= 10 ? '****' : `${token.slice(0, 6)}...${token.slice(-4)}`;
}

// Phone mask — last 4 digits only.
function maskPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '(none)';
  return digits.length <= 4 ? '****' : `****${digits.slice(-4)}`;
}

// Normalize Singapore numbers: strip spaces/dashes/+, add 65 to bare 8-digit locals.
function normalizePhone(raw) {
  let p = String(raw || '').replace(/[\s-]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  p = p.replace(/\D/g, '');
  if (p.length === 8) p = `65${p}`;
  return p;
}

function isConfigured() {
  const c = readConfig();
  return c.enabled && Boolean(c.apiUrl && c.token && c.phoneId);
}

// HTTP helper: prefer global fetch (Node 18+); fall back to axios if unavailable.
async function httpPostJson(url, token, payload) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (typeof fetch === 'function') {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    let data = {};
    try { data = await res.json(); } catch { /* non-JSON body */ }
    return { ok: res.ok, status: res.status, data };
  }
  const axios = require('axios');
  try {
    const r = await axios.post(url, payload, { headers, timeout: 10000 });
    return { ok: true, status: r.status, data: r.data };
  } catch (e) {
    return { ok: false, status: e.response?.status, data: e.response?.data };
  }
}

// Core sender. Never throws — always resolves to a result object.
async function sendMessage(to, body) {
  const { enabled, apiUrl, token, phoneId } = readConfig();

  // Mock mode: WHATSAPP_ENABLED is not exactly "true".
  if (!enabled) {
    console.log(`[WhatsApp] Simulated send (WHATSAPP_ENABLED is not "true"). to=${maskPhone(to)} body="${body}"`);
    return { success: true, simulated: true, message: 'WhatsApp disabled — message simulated.' };
  }

  // Enabled but misconfigured → safe failure (do not call the API, do not crash).
  if (!apiUrl || !token || !phoneId) {
    console.error('[WhatsApp] Enabled but missing config (API_URL / token / PHONE_NUMBER_ID) — cannot send.');
    return { success: false, simulated: false, error: 'WhatsApp is enabled but credentials are incomplete.' };
  }

  const normalized = normalizePhone(to);
  const url = `${apiUrl.replace(/\/$/, '')}/${phoneId}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    to: normalized,
    type: 'text',
    text: { preview_url: false, body },
  };

  try {
    const result = await httpPostJson(url, token, payload);
    if (!result.ok) {
      const metaMsg = result.data?.error?.message || `HTTP ${result.status || 'error'}`;
      console.error(`[WhatsApp] Send failed to ${maskPhone(normalized)} (token ${maskToken(token)}): ${metaMsg}`);
      return { success: false, simulated: false, error: metaMsg };
    }
    console.log(`[WhatsApp] Sent to ${maskPhone(normalized)} (token ${maskToken(token)})`);
    return { success: true, simulated: false, message: 'WhatsApp message sent.' };
  } catch (err) {
    console.error(`[WhatsApp] Send error to ${maskPhone(normalized)} (token ${maskToken(token)}): ${err.message}`);
    return { success: false, simulated: false, error: err.message };
  }
}

// Slot text is always Singapore wall-clock time, regardless of the server's
// timezone (Cloud Run runs in UTC), so the driver reads the same "27 Jul 2026,
// 6:01 PM" that was booked — never a UTC-shifted time.
function formatSlot(booking) {
  if (!booking.slot_start) return 'your scheduled time';
  return formatSingaporeDateTime(booking.slot_start) || String(booking.slot_start);
}

function formatSlotRange(booking) {
  const start = formatSlot(booking);
  if (!booking.slot_end) return start;
  const end = formatSingaporeTime(booking.slot_end);
  return end ? `${start} – ${end}` : start;
}

// Build a driver-pass URL from a base origin + booking ref. Strips any trailing
// slash(es) so we never emit a double slash, and encodes the ref so the URL is
// always well-formed. Returns '' when either part is missing (never "undefined").
function buildDriverPassUrl(base, bookingRef) {
  const origin = String(base || '').trim().replace(/\/+$/, '');
  if (!origin || !bookingRef) return '';
  return `${origin}/driver-pass/${encodeURIComponent(bookingRef)}`;
}

// Canonical driver-pass link — used in every environment (the laptop link in dev,
// the HTTPS Cloud Run link in production). Falls back to localhost for a bare
// local demo, but fails closed in production so localhost can never leak into a
// live notification when the canonical frontend environment is misconfigured.
function driverPassLink(booking) {
  if (!booking.booking_ref) return '';
  const configuredBase = process.env.FRONTEND_URL || process.env.CLIENT_URL;
  if (!configuredBase && process.env.NODE_ENV === 'production') return '';
  const base = configuredBase || 'http://localhost:5173';
  return buildDriverPassUrl(base, booking.booking_ref);
}

// Optional LAN/phone link for LOCAL DEVELOPMENT only. Lets a driver open the pass
// on a phone that shares the laptop's Wi-Fi (localhost would point at the phone).
// Suppressed in production so a dev LAN address never leaks into a live message,
// and omitted entirely when FRONTEND_NETWORK_URL is not configured.
function driverPassNetworkLink(booking) {
  if (process.env.NODE_ENV === 'production') return '';
  if (!booking.booking_ref) return '';
  return buildDriverPassUrl(process.env.FRONTEND_NETWORK_URL, booking.booking_ref);
}

// --- Notification events (all non-throwing; simulated when WhatsApp is disabled) ---

// Booking created — full details + driver pass link(s).
function sendBookingCreated(booking) {
  const link = driverPassLink(booking);
  const networkLink = driverPassNetworkLink(booking);
  const lines = [
    'FlowGuard — Harrison Food Factory',
    `Booking ${booking.booking_ref} received.`,
    `Company: ${booking.transport_company} · Plate: ${booking.license_plate}`,
    `Bay: ${booking.loading_bay} · Slot: ${formatSlotRange(booking)}`,
  ];

  // Dev with a LAN URL configured → give both so the driver can open on a phone.
  // Otherwise keep the single canonical link exactly as before.
  if (networkLink) {
    lines.push('Driver pass:');
    lines.push(`Phone/Wi-Fi: ${networkLink}`);
    lines.push(`Laptop: ${link}`);
  } else if (link) {
    lines.push(`Driver pass: ${link}`);
  }

  lines.push('Please wait for confirmation before arriving.');
  return sendMessage(booking.driver_phone, lines.join('\n'));
}

function sendBookingConfirmed(booking) {
  return sendMessage(
    booking.driver_phone,
    `FlowGuard: Booking ${booking.booking_ref} is confirmed for ${formatSlotRange(booking)}, ${booking.loading_bay}. Please wait for the call-in and do not arrive early.`
  );
}

function sendBookingArrived(booking) {
  return sendMessage(
    booking.driver_phone,
    `FlowGuard: Arrival logged for booking ${booking.booking_ref} at ${booking.loading_bay}. Please proceed to check-in.`
  );
}

function sendBookingCompleted(booking) {
  return sendMessage(
    booking.driver_phone,
    `FlowGuard: Loading session completed for booking ${booking.booking_ref} at ${booking.loading_bay}. Thank you — safe travels.`
  );
}

function sendNextInLine(booking) {
  return sendMessage(
    booking.driver_phone,
    `FlowGuard — Harrison Food Factory: Previous vehicle has left ${booking.loading_bay}. You may proceed to the loading bay if you are ready (booking ${booking.booking_ref}).`
  );
}

function sendBookingCancelled(booking) {
  return sendMessage(
    booking.driver_phone,
    `FlowGuard: Your loading bay booking (${booking.booking_ref}) has been cancelled.`
  );
}

// ===========================================================================
// SECURITY DETECTION ALERTS (SecurePi / IMX500 / PIR edge events)
// ===========================================================================
// These are a SEPARATE message family from the driver/booking notifications
// above. They are sent to FM/security staff (WHATSAPP_SECURITY_RECIPIENTS), NOT
// to a driver phone, and they never carry booking details (driver pass, plate,
// loading bay). The message builder is a PURE function so it is directly unit-
// testable; everything that touches the network or process.env lives in the
// send helpers below it.

const SEVERITY_RANK = { Low: 1, Medium: 2, High: 3, Critical: 4 };

// Numeric rank for a severity string (0 for unknown/missing).
function severityRank(severity) {
  return SEVERITY_RANK[severity] || 0;
}

// True when `severity` is at least `min` on the Low < Medium < High < Critical
// scale. An unknown `min` is treated as Low (the most permissive floor).
function meetsMinSeverity(severity, min) {
  return severityRank(severity) >= (SEVERITY_RANK[min] || SEVERITY_RANK.Low);
}

// Maps an alert type to a security-alert heading. Accepts both the enum-style
// incident keys (PEST_DETECTION) and the human labels ("Pest Detection"); both
// normalize to the same key. Unknown types fall back to a generic heading.
function detectionAlertHeading(alertType) {
  const key = String(alertType || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  const HEADINGS = {
    PEST_DETECTION: '🚨 FlowGuard Pest Alert',
    UNATTENDED_OBJECT: '🚨 FlowGuard Unattended Item Alert',
    FORGOTTEN_BELONGING: '⚠️ FlowGuard Forgotten Belonging Alert',
    RESTRICTED_MOTION: '🚨 FlowGuard Restricted-Zone Motion Alert',
    RESTRICTED_ZONE_MOTION: '🚨 FlowGuard Restricted-Zone Motion Alert',
    ITEM_PICKED_UP: '⚠️ FlowGuard Item Movement Alert',
    ITEM_SET_DOWN: '⚠️ FlowGuard Item Movement Alert',
    ITEM_MOVEMENT: '⚠️ FlowGuard Item Movement Alert',
  };
  return { key, heading: HEADINGS[key] || '🚨 FlowGuard Detection Alert' };
}

// Light title-casing for the object label ("rat" -> "Rat", "backpack" ->
// "Backpack", "package-like object" -> "Package-like Object"). Never throws.
function titleCase(text) {
  return String(text || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Convert a 0–1 confidence into a whole-number percentage. Tolerates a value
// already expressed as a percentage (>1). Returns null when not a finite number.
function confidencePercent(confidence) {
  if (confidence === undefined || confidence === null || confidence === '') return null;
  const value = Number(confidence);
  if (!Number.isFinite(value)) return null;
  const pct = value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

// True only for a syntactically valid absolute http(s) URL. A Raspberry Pi local
// path (runtime/snapshots/...) or a file:/javascript: scheme returns false, so a
// non-remote snapshot is never presented to a phone as a tappable link.
function isValidHttpUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(String(value));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// The "duration" line label depends on the alert type so it reads naturally.
function durationLabelForKey(key) {
  if (key === 'UNATTENDED_OBJECT') return 'Unattended for';
  if (key === 'FORGOTTEN_BELONGING') return 'Left unattended for';
  return 'Duration';
}

// PURE message builder — no network, no process.env. Given a normalized alert
// object (and an optional dashboard URL), returns the exact WhatsApp text body.
// Every optional field is omitted safely when missing. Never includes tokens,
// credentials, driver phone numbers or booking details.
function buildDetectionAlertMessage(alert = {}, options = {}) {
  const {
    alert_type,
    object_class,
    severity,
    zone_name,
    camera_location,
    duration_seconds,
    occurred_at,
    timestamp,
    confidence,
    device_id,
    person_name,
    snapshot_url,
    snapshot_path,
  } = alert;

  const { heading, key } = detectionAlertHeading(alert_type);
  const lines = [heading, ''];

  if (object_class) lines.push(`Object: ${titleCase(object_class)}`);
  if (severity) lines.push(`Severity: ${severity}`);
  if (zone_name) lines.push(`Location: ${zone_name}`);
  if (camera_location) lines.push(`Camera: ${camera_location}`);

  // Only show a person line when it identifies someone real (never "UNKNOWN").
  if (person_name && String(person_name).trim().toUpperCase() !== 'UNKNOWN') {
    lines.push(`Person: ${person_name}`);
  }

  if (duration_seconds !== undefined && duration_seconds !== null && duration_seconds !== '') {
    const seconds = Number(duration_seconds);
    if (Number.isFinite(seconds)) {
      lines.push(`${durationLabelForKey(key)}: ${Math.round(seconds)} seconds`);
    }
  }

  // Timestamp is always rendered in Asia/Singapore wall-clock, regardless of the
  // server timezone (Cloud Run runs in UTC).
  const when = occurred_at || timestamp;
  const formattedWhen = when ? formatSingaporeDateTime(when) : null;
  if (formattedWhen) lines.push(`Detected: ${formattedWhen}`);

  const pct = confidencePercent(confidence);
  if (pct !== null) lines.push(`Confidence: ${pct}%`);

  if (device_id) lines.push(`Device: ${device_id}`);

  // Snapshot handling: only a valid remote URL becomes a tappable link. A local
  // edge path is acknowledged but never presented as if it were reachable.
  if (isValidHttpUrl(snapshot_url)) {
    lines.push('', `Photo: ${snapshot_url}`);
  } else if (snapshot_path || snapshot_url) {
    lines.push('', 'Photo captured on edge device; remote upload unavailable.');
  }

  const dashboardUrl = options.dashboardUrl;
  lines.push('');
  if (dashboardUrl) {
    lines.push(`Review the event in the FlowGuard dashboard:`, dashboardUrl);
  } else {
    lines.push('Review the event in the FlowGuard dashboard.');
  }

  return lines.join('\n');
}

// Canonical dashboard URL for detection alerts. Uses the same FRONTEND_URL /
// CLIENT_URL precedence as the driver-pass links, and fails closed (returns '')
// in production if neither is configured so a localhost link never leaks live.
function detectionDashboardUrl() {
  const configuredBase = process.env.FRONTEND_URL || process.env.CLIENT_URL;
  if (!configuredBase) {
    if (process.env.NODE_ENV === 'production') return '';
    return 'http://localhost:5173/object-detection';
  }
  return `${String(configuredBase).trim().replace(/\/+$/, '')}/object-detection`;
}

// Read, normalize and de-duplicate the security recipients from
// WHATSAPP_SECURITY_RECIPIENTS (comma-separated). Returns [] when unset — the
// caller then produces a safe "Skipped" result instead of throwing.
function resolveDetectionRecipients() {
  const raw = process.env.WHATSAPP_SECURITY_RECIPIENTS || '';
  const seen = new Set();
  const recipients = [];
  for (const part of raw.split(',')) {
    const normalized = normalizePhone(part);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      recipients.push(normalized);
    }
  }
  return recipients;
}

// Collapse an array of per-recipient sendMessage() results into one status:
//   Skipped   — no recipients attempted
//   Simulated — every send was simulated (WhatsApp disabled / mock mode)
//   Sent      — at least one real (non-simulated) success
//   Failed    — recipients attempted but not one succeeded
function aggregateSendResults(results) {
  if (!results.length) return { status: 'Skipped', error: null };
  const successes = results.filter((r) => r && r.success);
  if (!successes.length) {
    const firstError = results.find((r) => r && r.error);
    return { status: 'Failed', error: firstError ? firstError.error : 'WhatsApp send failed.' };
  }
  const allSimulated = successes.every((r) => r.simulated);
  return { status: allSimulated ? 'Simulated' : 'Sent', error: null };
}

// Send an already-resolved detection message to a specific recipient list.
// Builds the message once and reuses it. Never throws.
async function sendDetectionAlertToRecipients(alert, recipients) {
  const list = Array.isArray(recipients) ? recipients : [];
  if (!list.length) {
    return { status: 'Skipped', recipientCount: 0, error: null, results: [] };
  }
  const body = buildDetectionAlertMessage(alert, { dashboardUrl: detectionDashboardUrl() });
  const results = [];
  for (const to of list) {
    // sequential keeps the (already generous) AI-proxy rate window predictable
    // and avoids a burst against Meta's API for a handful of security numbers.
    results.push(await sendMessage(to, body));
  }
  const { status, error } = aggregateSendResults(results);
  return { status, recipientCount: list.length, error, results };
}

// High-level entry point used by the edge route. Resolves the configured
// security recipients, then sends. Returns a safe result object (never throws);
// a "Skipped" status when no recipients are configured.
async function sendDetectionAlert(alert) {
  const recipients = resolveDetectionRecipients();
  return sendDetectionAlertToRecipients(alert, recipients);
}

module.exports = {
  sendMessage,
  sendBookingCreated,
  sendBookingConfirmed,
  sendBookingArrived,
  sendBookingCompleted,
  sendNextInLine,
  sendBookingCancelled,
  isConfigured,
  normalizePhone,
  driverPassLink,
  driverPassNetworkLink,
  buildDriverPassUrl,
  // Security detection alerts (separate family from booking notifications)
  buildDetectionAlertMessage,
  resolveDetectionRecipients,
  sendDetectionAlertToRecipients,
  sendDetectionAlert,
  severityRank,
  meetsMinSeverity,
  detectionDashboardUrl,
  _maskKey: maskKey,
  _maskToken: maskToken,
  _maskPhone: maskPhone,
};
