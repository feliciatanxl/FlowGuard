// Frontend unit tests — the shared Singapore booking datetime helpers.
// These implement the wall-clock ⇄ UTC contract and must be independent of the
// machine timezone the tests happen to run under.
import { describe, test, expect } from "vitest";
import {
  singaporeLocalInputToIso,
  isoToSingaporeLocalInput,
  formatSingaporeBookingDateTime,
  singaporeDateKey,
  getSingaporeTodayDateKey,
} from "../../src/constants/datetime";

describe("singaporeLocalInputToIso", () => {
  test("datetime-local Singapore value → correct UTC ISO", () => {
    // 6:01 PM Singapore = 10:01 UTC.
    expect(singaporeLocalInputToIso("2026-07-27T18:01")).toBe("2026-07-27T10:01:00.000Z");
  });

  test("midnight-adjacent value keeps the intended Singapore instant", () => {
    expect(singaporeLocalInputToIso("2026-07-27T00:30")).toBe("2026-07-26T16:30:00.000Z");
  });

  test("empty input → '' and unparseable → null", () => {
    expect(singaporeLocalInputToIso("")).toBe("");
    expect(singaporeLocalInputToIso("nope")).toBeNull();
  });
});

describe("isoToSingaporeLocalInput", () => {
  test("UTC API value → correct Singapore datetime-local value", () => {
    expect(isoToSingaporeLocalInput("2026-07-27T10:01:00.000Z")).toBe("2026-07-27T18:01");
  });

  test("round-trips with singaporeLocalInputToIso", () => {
    const local = "2026-12-31T23:45";
    expect(isoToSingaporeLocalInput(singaporeLocalInputToIso(local))).toBe(local);
  });

  test("missing input → ''", () => {
    expect(isoToSingaporeLocalInput("")).toBe("");
    expect(isoToSingaporeLocalInput(null)).toBe("");
  });
});

describe("formatSingaporeBookingDateTime", () => {
  test('renders "27 Jul 2026, 6:01 PM" for a UTC instant', () => {
    expect(formatSingaporeBookingDateTime("2026-07-27T10:01:00.000Z")).toBe("27 Jul 2026, 6:01 PM");
  });

  test("a late-evening Singapore slot never rolls into the next day", () => {
    // 11:30 PM SG = 15:30 UTC, still 27 Jul in Singapore.
    expect(formatSingaporeBookingDateTime("2026-07-27T15:30:00.000Z")).toBe("27 Jul 2026, 11:30 PM");
  });

  test("missing input → the em-dash fallback", () => {
    expect(formatSingaporeBookingDateTime(null)).toBe("—");
    expect(formatSingaporeBookingDateTime("bad")).toBe("—");
  });
});

describe("singaporeDateKey", () => {
  test("returns the Singapore calendar day of a UTC instant", () => {
    // 10:01 UTC = 18:01 SG on the 27th.
    expect(singaporeDateKey("2026-07-27T10:01:00.000Z")).toBe("2026-07-27");
    // 17:00 UTC = 01:00 SG next day.
    expect(singaporeDateKey("2026-07-27T17:00:00.000Z")).toBe("2026-07-28");
  });
});

describe("getSingaporeTodayDateKey", () => {
  test("resolves 'today' in Singapore, NOT in UTC", () => {
    // 20:00 UTC on 27 Jul is already 04:00 on 28 Jul in Singapore.
    const instant = new Date("2026-07-27T20:00:00.000Z");
    expect(getSingaporeTodayDateKey(instant)).toBe("2026-07-28");
    // The naive UTC approach the task warns against would wrongly say the 27th.
    expect(instant.toISOString().slice(0, 10)).toBe("2026-07-27");
  });

  test("format is YYYY-MM-DD", () => {
    expect(getSingaporeTodayDateKey(new Date("2026-07-27T02:00:00.000Z"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
