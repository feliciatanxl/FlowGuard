// Canonical booking date/time handling for Smart Logistics.
//
// The contract (see also client/src/constants/datetime.js):
//   * Users pick loading-bay slots as Singapore WALL-CLOCK time.
//   * PostgreSQL stores absolute UTC instants; the API returns ISO-8601.
//   * Every UI / WhatsApp display formats explicitly in Asia/Singapore.
//
// This module must NEVER depend on process.env.TZ or the host machine timezone
// (Cloud Run runs in UTC; a Singapore laptop runs in +08). Singapore has had a
// fixed +08:00 offset with NO daylight saving since 1982, so a timezone-less
// wall-clock value can be converted with a constant offset, and all display
// goes through Intl with an explicit timeZone.

const SG_TIME_ZONE = 'Asia/Singapore';
const SG_OFFSET_MS = 8 * 60 * 60 * 1000; // Asia/Singapore: fixed +08:00, no DST

// Business rule for Smart Logistics loading-bay slots: every booking window must be
// between 1 and 2 hours. Both bounds are INCLUSIVE — exactly 60 and exactly 120 minutes
// are valid; 59 and 121 minutes are not. Kept here (backend, timezone-independent) so it
// is authoritative regardless of anything the frontend does.
const MIN_BOOKING_MINUTES = 60;
const MAX_BOOKING_MINUTES = 120;
const MS_PER_MINUTE = 60 * 1000;

// A trailing timezone designator: "…Z" or "…+08:00" / "…-0500".
const HAS_TZ = /([zZ])$|([+-]\d{2}:?\d{2})$/;
// A timezone-LESS datetime-local value: 2026-07-27T18:01(:00)(.000)?
const LOCAL_DT = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/;

/**
 * Parse a single booking datetime input into an absolute UTC Date, without
 * depending on the host timezone.
 *   - null / '' / undefined            → { ok: true, date: null }  (slot optional)
 *   - explicit-offset ISO ("…Z" / "…+08:00")
 *                                       → the represented instant, preserved
 *   - timezone-less "2026-07-27T18:01"  → interpreted as Asia/Singapore wall clock
 *   - a Date instance                   → passed through (validated)
 *   - anything unparseable              → { ok: false }
 */
function parseBookingDateTime(input) {
  if (input === null || input === undefined || input === '') {
    return { ok: true, date: null };
  }
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? { ok: false } : { ok: true, date: input };
  }

  const str = String(input).trim();
  if (!str) return { ok: true, date: null };

  const local = LOCAL_DT.exec(str);
  if (local && !HAS_TZ.test(str)) {
    // Timezone-less wall clock → interpret explicitly as Singapore time.
    const [, y, mo, d, hh, mm, ss] = local;
    const utcMs = Date.UTC(
      Number(y), Number(mo) - 1, Number(d),
      Number(hh), Number(mm), ss ? Number(ss) : 0,
    ) - SG_OFFSET_MS;
    const date = new Date(utcMs);
    return Number.isNaN(date.getTime()) ? { ok: false } : { ok: true, date };
  }

  // Explicit offset, date-only, or other ISO — the instant is unambiguous.
  const date = new Date(str);
  return Number.isNaN(date.getTime()) ? { ok: false } : { ok: true, date };
}

/**
 * Normalise a booking body's slot window. Returns either { error } (caller
 * should respond 400) or { slot_start, slot_end } as Date|null instances ready
 * for validation, conflict checks and Sequelize.
 */
function normalizeSlots(body = {}) {
  const start = parseBookingDateTime(body.slot_start);
  if (!start.ok) return { error: 'slot_start is not a valid date/time.' };
  const end = parseBookingDateTime(body.slot_end);
  if (!end.ok) return { error: 'slot_end is not a valid date/time.' };
  return { slot_start: start.date, slot_end: end.date };
}

/**
 * Authoritative 1–2 hour booking-window validation. Accepts already-normalised
 * Date instants (what normalizeSlots / parseBookingDateTime return) OR raw string
 * inputs, which it will parse the same way. Returns:
 *   { ok: true, startAt, endAt, durationMinutes }  on a valid window, or
 *   { ok: false, error }                            with a clear, stable message.
 *
 * Checks (in order):
 *   - missing start                 → "slot_start and slot_end are required."
 *   - missing end                   → "slot_start and slot_end are required."
 *   - unparseable start/end         → "slot_start is not a valid date/time." / slot_end
 *   - end not after start           → "slot_end must be after slot_start."
 *   - duration below 60 minutes     → "Booking duration must be at least 1 hour."
 *   - duration above 120 minutes    → "Booking duration cannot exceed 2 hours."
 *
 * 60 and 120 minutes are both accepted (inclusive bounds).
 */
function validateBookingWindow(startAt, endAt) {
  const missingStart = startAt === null || startAt === undefined || startAt === '';
  const missingEnd = endAt === null || endAt === undefined || endAt === '';
  if (missingStart || missingEnd) {
    return { ok: false, error: 'slot_start and slot_end are required.' };
  }

  const startParsed = parseBookingDateTime(startAt);
  if (!startParsed.ok || !startParsed.date) {
    return { ok: false, error: 'slot_start is not a valid date/time.' };
  }
  const endParsed = parseBookingDateTime(endAt);
  if (!endParsed.ok || !endParsed.date) {
    return { ok: false, error: 'slot_end is not a valid date/time.' };
  }

  const start = startParsed.date;
  const end = endParsed.date;
  const durationMs = end.getTime() - start.getTime();

  if (durationMs <= 0) {
    return { ok: false, error: 'slot_end must be after slot_start.' };
  }

  const durationMinutes = durationMs / MS_PER_MINUTE;
  if (durationMinutes < MIN_BOOKING_MINUTES) {
    return { ok: false, error: 'Booking duration must be at least 1 hour.' };
  }
  if (durationMinutes > MAX_BOOKING_MINUTES) {
    return { ok: false, error: 'Booking duration cannot exceed 2 hours.' };
  }

  return { ok: true, startAt: start, endAt: end, durationMinutes };
}

// --- Display helpers (always Asia/Singapore, host-timezone independent) ---

/** "27 Jul 2026, 6:01 PM" — or '' for missing/invalid input. */
function formatSingaporeDateTime(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const datePart = date.toLocaleDateString('en-SG', {
    timeZone: SG_TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric',
  });
  const timePart = date
    .toLocaleTimeString('en-SG', {
      timeZone: SG_TIME_ZONE, hour: 'numeric', minute: '2-digit', hour12: true,
    })
    .replace(/\b(am|pm)\b/i, (m) => m.toUpperCase());
  return `${datePart}, ${timePart}`;
}

/** "6:03 PM" — time only, in Singapore; '' for missing/invalid input. */
function formatSingaporeTime(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date
    .toLocaleTimeString('en-SG', {
      timeZone: SG_TIME_ZONE, hour: 'numeric', minute: '2-digit', hour12: true,
    })
    .replace(/\b(am|pm)\b/i, (m) => m.toUpperCase());
}

module.exports = {
  SG_TIME_ZONE,
  SG_OFFSET_MS,
  MIN_BOOKING_MINUTES,
  MAX_BOOKING_MINUTES,
  parseBookingDateTime,
  normalizeSlots,
  validateBookingWindow,
  formatSingaporeDateTime,
  formatSingaporeTime,
};
