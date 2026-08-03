// Singapore-time timestamp helpers for security/attendance UI.
// Always formats in Asia/Singapore with the en-SG locale, regardless of the
// viewer's machine timezone.

const SG_TIME_ZONE = 'Asia/Singapore';

// YYYY-MM-DD calendar key of a date *in Singapore time* (en-CA gives ISO order).
const sgDateKey = (date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: SG_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);

const sgTime = (date) =>
  date
    .toLocaleTimeString('en-SG', {
      timeZone: SG_TIME_ZONE, hour: 'numeric', minute: '2-digit', hour12: true,
    })
    .replace(/\b(am|pm)\b/i, (m) => m.toUpperCase());

const sgDate = (date) =>
  date.toLocaleDateString('en-SG', {
    timeZone: SG_TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric',
  });

/**
 * Compact Singapore-time label: "Today, 9:50 PM", "Yesterday, 4:12 PM",
 * or "09 Jul 2026, 9:50 PM". `now` is injectable for tests.
 * Returns '' for missing/invalid input — callers fall back to legacy fields.
 */
export const formatSingaporeTimestamp = (value, now = new Date()) => {
  if (!value) return '';
  const date = new Date(value);
  if (isNaN(date.getTime())) return '';

  const key = sgDateKey(date);
  const todayKey = sgDateKey(now);
  const yesterdayKey = sgDateKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));

  if (key === todayKey) return `Today, ${sgTime(date)}`;
  if (key === yesterdayKey) return `Yesterday, ${sgTime(date)}`;
  return `${sgDate(date)}, ${sgTime(date)}`;
};

/** Full exact Singapore timestamp, e.g. "09 Jul 2026, 9:50:12 PM" (for tooltips/details). */
export const formatSingaporeFull = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (isNaN(date.getTime())) return '';
  const time = date
    .toLocaleTimeString('en-SG', {
      timeZone: SG_TIME_ZONE, hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
    })
    .replace(/\b(am|pm)\b/i, (m) => m.toUpperCase());
  return `${sgDate(date)}, ${time}`;
};

/** True if the timestamp falls on today's Singapore calendar date. */
export const isSingaporeToday = (value, now = new Date()) => {
  if (!value) return false;
  const date = new Date(value);
  if (isNaN(date.getTime())) return false;
  return sgDateKey(date) === sgDateKey(now);
};

/** True if the timestamp falls on yesterday's Singapore calendar date. */
export const isSingaporeYesterday = (value, now = new Date()) => {
  if (!value) return false;
  const date = new Date(value);
  if (isNaN(date.getTime())) return false;
  return sgDateKey(date) === sgDateKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));
};

// ---------------------------------------------------------------------------
// Loading-bay booking slots. These implement the shared time contract with the
// backend (server/utils/bookingDateTime.js): the user enters Singapore
// wall-clock time; the API stores/returns absolute UTC ISO instants; the UI
// always displays Singapore time. Singapore is a fixed +08:00 offset (no DST
// since 1982), so wall-clock ⇄ instant conversion uses a constant offset and
// never depends on the browser's operating-system timezone.
// ---------------------------------------------------------------------------

// Fixed Asia/Singapore offset in minutes.
const SG_OFFSET_MINUTES = 8 * 60;

// A timezone-LESS datetime-local value: 2026-07-27T18:01(:00)?
const LOCAL_INPUT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/;

/**
 * <input type="datetime-local"> value (Singapore wall clock) → UTC ISO string.
 *   "2026-07-27T18:01"  →  "2026-07-27T10:01:00.000Z"
 * Returns '' for empty input and null for an unparseable value.
 */
export const singaporeLocalInputToIso = (localValue) => {
  if (!localValue) return '';
  const m = LOCAL_INPUT_RE.exec(String(localValue).trim());
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss] = m;
  const utcMs = Date.UTC(+y, +mo - 1, +d, +hh, +mm, ss ? +ss : 0) - SG_OFFSET_MINUTES * 60000;
  const date = new Date(utcMs);
  if (isNaN(date.getTime())) return null;
  return date.toISOString();
};

/**
 * Stored UTC instant → <input type="datetime-local"> value in Singapore time.
 *   "2026-07-27T10:01:00.000Z"  →  "2026-07-27T18:01"
 * Uses Intl with an explicit Asia/Singapore zone, so it never reflects the
 * viewer's device timezone. Returns '' for missing/invalid input.
 */
export const isoToSingaporeLocalInput = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SG_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const bag = {};
  for (const p of parts) if (p.type !== 'literal') bag[p.type] = p.value;
  // Some engines emit "24" for midnight under hour12:false — normalise to "00".
  const hour = bag.hour === '24' ? '00' : bag.hour;
  return `${bag.year}-${bag.month}-${bag.day}T${hour}:${bag.minute}`;
};

/** Booking-slot display in Singapore time: "27 Jul 2026, 6:01 PM". */
export const formatSingaporeBookingDateTime = (value, fallback = '—') => {
  if (!value) return fallback;
  const date = new Date(value);
  if (isNaN(date.getTime())) return fallback;
  return `${sgDate(date)}, ${sgTime(date)}`;
};

// ---------------------------------------------------------------------------
// 1–2 hour booking-window rule (client mirror of server/utils/bookingDateTime.js).
// The backend stays authoritative; this only powers inline UI feedback. All maths
// go through the fixed +08:00 conversion (singaporeLocalInputToIso), never the
// browser's local timezone, so a deployed kiosk in any zone measures the same window.
// ---------------------------------------------------------------------------
export const BOOKING_MIN_MINUTES = 60;
export const BOOKING_MAX_MINUTES = 120;

/**
 * Minutes between two <input type="datetime-local"> (Singapore wall-clock) values.
 * Returns null when either value is missing or unparseable.
 */
export const bookingWindowMinutes = (startLocal, endLocal) => {
  const startIso = singaporeLocalInputToIso(startLocal);
  const endIso = singaporeLocalInputToIso(endLocal);
  if (!startIso || !endIso) return null;
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  return Number.isNaN(ms) ? null : ms / 60000;
};

/**
 * Suggest an end `minutes` after the chosen start (default 60), as a datetime-local
 * value in Singapore time. Returns '' when start is empty/unparseable.
 */
export const addSingaporeMinutesToLocalInput = (startLocal, minutes = 60) => {
  const startIso = singaporeLocalInputToIso(startLocal);
  if (!startIso) return '';
  const end = new Date(new Date(startIso).getTime() + minutes * 60000);
  return isoToSingaporeLocalInput(end.toISOString());
};

/**
 * Client mirror of validateBookingWindow — returns { ok, error, durationMinutes }
 * using the SAME messages the API returns so the UI and server never disagree.
 */
export const validateBookingWindowLocal = (startLocal, endLocal) => {
  if (!startLocal || !endLocal) {
    return { ok: false, error: 'slot_start and slot_end are required.', durationMinutes: null };
  }
  const durationMinutes = bookingWindowMinutes(startLocal, endLocal);
  if (durationMinutes === null) {
    return { ok: false, error: 'Enter a valid slot start and end.', durationMinutes: null };
  }
  if (durationMinutes <= 0) {
    return { ok: false, error: 'slot_end must be after slot_start.', durationMinutes };
  }
  if (durationMinutes < BOOKING_MIN_MINUTES) {
    return { ok: false, error: 'Booking duration must be at least 1 hour.', durationMinutes };
  }
  if (durationMinutes > BOOKING_MAX_MINUTES) {
    return { ok: false, error: 'Booking duration cannot exceed 2 hours.', durationMinutes };
  }
  return { ok: true, error: '', durationMinutes };
};

/** Human duration label: "1 h", "1 h 30 m", "45 m". '—' for missing/invalid. */
export const formatDurationMinutes = (mins) => {
  if (mins == null || Number.isNaN(mins)) return '—';
  const rounded = Math.round(mins);
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  if (h && m) return `${h} h ${m} m`;
  if (h) return `${h} h`;
  return `${m} m`;
};

/** YYYY-MM-DD Singapore calendar key for a slot (matches <input type="date">). */
export const singaporeDateKey = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (isNaN(date.getTime())) return '';
  return sgDateKey(date);
};

/**
 * Today's Singapore calendar date as YYYY-MM-DD — the Logistics default filter.
 * Resolved explicitly through Asia/Singapore, so it is correct even when the
 * browser, OS, Node or Cloud Run runs in UTC (unlike
 * `new Date().toISOString().slice(0, 10)`, which can return the wrong day near
 * Singapore midnight). `now` is injectable for deterministic tests.
 */
export const getSingaporeTodayDateKey = (now = new Date()) => sgDateKey(now);
