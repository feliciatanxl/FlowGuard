// Backend unit tests — canonical Singapore booking date/time helper.
// These must hold under ANY host timezone (the bug only appears on Cloud Run /
// UTC), so nothing here may depend on process.env.TZ.
const {
  parseBookingDateTime,
  normalizeSlots,
  formatSingaporeDateTime,
  formatSingaporeTime,
} = require("../../utils/bookingDateTime");

describe("parseBookingDateTime", () => {
  test("timezone-less datetime-local is interpreted as Singapore time", () => {
    // 6:01 PM Singapore = 10:01 UTC.
    const { ok, date } = parseBookingDateTime("2026-07-27T18:01");
    expect(ok).toBe(true);
    expect(date.toISOString()).toBe("2026-07-27T10:01:00.000Z");
  });

  test("timezone-less value with seconds also maps to Singapore time", () => {
    const { date } = parseBookingDateTime("2026-07-27T18:01:30");
    expect(date.toISOString()).toBe("2026-07-27T10:01:30.000Z");
  });

  test("near-midnight Singapore input stays on the same calendar day in UTC-8 terms", () => {
    // 11:30 PM SG on 27 Jul = 15:30 UTC on 27 Jul (must NOT roll to 28 Jul SG).
    const { date } = parseBookingDateTime("2026-07-27T23:30");
    expect(date.toISOString()).toBe("2026-07-27T15:30:00.000Z");
    expect(formatSingaporeDateTime(date)).toBe("27 Jul 2026, 11:30 PM");
  });

  test("ISO input with Z preserves the exact instant", () => {
    const { date } = parseBookingDateTime("2026-07-27T10:01:00.000Z");
    expect(date.toISOString()).toBe("2026-07-27T10:01:00.000Z");
  });

  test("ISO input with +08:00 offset preserves the exact instant", () => {
    const { date } = parseBookingDateTime("2026-07-27T18:01:00+08:00");
    expect(date.toISOString()).toBe("2026-07-27T10:01:00.000Z");
  });

  test("empty / null / undefined → ok with null date (slot is optional)", () => {
    expect(parseBookingDateTime("")).toEqual({ ok: true, date: null });
    expect(parseBookingDateTime(null)).toEqual({ ok: true, date: null });
    expect(parseBookingDateTime(undefined)).toEqual({ ok: true, date: null });
  });

  test("a Date instance passes through", () => {
    const d = new Date("2026-07-27T10:01:00.000Z");
    expect(parseBookingDateTime(d).date).toBe(d);
  });

  test("unparseable values are rejected", () => {
    expect(parseBookingDateTime("not-a-date").ok).toBe(false);
    expect(parseBookingDateTime("hello world").ok).toBe(false);
    expect(parseBookingDateTime("2026-99").ok).toBe(false);
  });
});

describe("normalizeSlots", () => {
  test("returns Date instants for a valid window", () => {
    const out = normalizeSlots({ slot_start: "2026-07-27T18:01", slot_end: "2026-07-27T18:03" });
    expect(out.error).toBeUndefined();
    expect(out.slot_start.toISOString()).toBe("2026-07-27T10:01:00.000Z");
    expect(out.slot_end.toISOString()).toBe("2026-07-27T10:03:00.000Z");
  });

  test("an invalid slot_start yields an error (route maps to 400)", () => {
    const out = normalizeSlots({ slot_start: "garbage", slot_end: "2026-07-27T18:03" });
    expect(out.error).toMatch(/slot_start/);
  });
});

describe("Singapore display formatting (host-timezone independent)", () => {
  test('formats a UTC instant as "27 Jul 2026, 6:01 PM" in Singapore', () => {
    expect(formatSingaporeDateTime("2026-07-27T10:01:00.000Z")).toBe("27 Jul 2026, 6:01 PM");
  });

  test("formats time only for a slot range end", () => {
    expect(formatSingaporeTime("2026-07-27T10:03:00.000Z")).toBe("6:03 PM");
  });

  test("missing/invalid input formats to an empty string", () => {
    expect(formatSingaporeDateTime(null)).toBe("");
    expect(formatSingaporeDateTime("nope")).toBe("");
    expect(formatSingaporeTime(undefined)).toBe("");
  });
});
