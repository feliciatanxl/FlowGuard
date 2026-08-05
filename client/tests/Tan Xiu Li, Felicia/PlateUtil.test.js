// Frontend unit test — shared Singapore-plate normalisation (browser copy).
import { describe, test, expect } from "vitest";
import {
  normalizePlate, platesMatch, isPlausiblePlate, repairPlateCandidate, extractPlateCandidate,
} from "../../src/utils/plate";
import { isValidBookingRef, normalizeBookingRef } from "../../src/utils/gateCamera";

describe("normalizePlate (client)", () => {
  test("collapses spacing/dashes/case to one canonical string", () => {
    expect(normalizePlate("GBG 1234 M")).toBe("GBG1234M");
    expect(normalizePlate("GBG-1234M")).toBe("GBG1234M");
    expect(normalizePlate("gbg1234m")).toBe("GBG1234M");
  });
  test("is null-safe", () => {
    expect(normalizePlate(null)).toBe("");
    expect(normalizePlate(undefined)).toBe("");
  });
  test("platesMatch ignores formatting but not identity", () => {
    expect(platesMatch("GBG 1234 M", "gbg-1234m")).toBe(true);
    expect(platesMatch("GBG1234M", "GBG1284M")).toBe(false);
    expect(platesMatch("", "GBG1234M")).toBe(false);
  });
});

describe("isPlausiblePlate (client)", () => {
  test("accepts well-formed Singapore-style plates in any formatting", () => {
    expect(isPlausiblePlate("GBG1234M")).toBe(true);
    expect(isPlausiblePlate("GBG 1234 M")).toBe(true);
    expect(isPlausiblePlate("SKL9081A")).toBe(true);
    expect(isPlausiblePlate("SBA 5678 Z")).toBe(true);
    expect(isPlausiblePlate("S1A")).toBe(true);
  });
  test("rejects OCR noise, words and digit-only junk", () => {
    expect(isPlausiblePlate("YWERETANCLPPEMYY")).toBe(false);
    expect(isPlausiblePlate("TOYOTA")).toBe(false);
    expect(isPlausiblePlate("VEHICLEPLATE")).toBe(false);
    expect(isPlausiblePlate("123456789")).toBe(false);
    expect(isPlausiblePlate("")).toBe(false);
  });
});

describe("extractPlateCandidate (client)", () => {
  test("1. 'GBG 1234 M' extracts as GBG1234M", () => {
    expect(extractPlateCandidate("GBG 1234 M")).toBe("GBG1234M");
  });
  test("2. 'SKL9081A' extracts as SKL9081A", () => {
    expect(extractPlateCandidate("SKL9081A")).toBe("SKL9081A");
  });
  test("3. noisy multiline OCR containing 'SKL 9081 A' extracts SKL9081A", () => {
    const raw = "Vehicle entrance\nSKL 9081 A\nToyota";
    expect(extractPlateCandidate(raw)).toBe("SKL9081A");
  });
  test("3b. a plate embedded among other words on one line is still found", () => {
    expect(extractPlateCandidate("Vehicle SKL 9081 A ahead")).toBe("SKL9081A");
  });
  test("4. 'YWERETANCLPPEMYY' is rejected as unreadable (no candidate)", () => {
    expect(extractPlateCandidate("YWERETANCLPPEMYY")).toBe("");
  });
  test("5. spaces/hyphens/case normalise unchanged", () => {
    expect(extractPlateCandidate("gbg-1234-m")).toBe("GBG1234M");
  });
  test("6. an invalid OCR paragraph is never collapsed into one detected plate", () => {
    const raw = "TOYOTA\nVEHICLE ENTRANCE\n123456789";
    expect(extractPlateCandidate(raw)).toBe("");
  });
  test("7. a mis-read checksum letter (SBA56787) is grammar-repaired to SBA5678Z", () => {
    expect(extractPlateCandidate("SBA56787")).toBe("SBA5678Z");
  });
  test("8. the repaired plate is recovered from among surrounding noise words", () => {
    expect(extractPlateCandidate("Noise SBA56787 extra words")).toBe("SBA5678Z");
  });
  test("9. an already-valid plate is returned exactly, never re-substituted", () => {
    expect(extractPlateCandidate("SBA5678Z")).toBe("SBA5678Z");
  });
});

describe("repairPlateCandidate (client)", () => {
  test("repairs the physically-observed Z→7 checksum mis-read uniquely", () => {
    expect(repairPlateCandidate("SBA56787")).toBe("SBA5678Z");
  });
  test("leaves an already-plausible plate unchanged (no substitution)", () => {
    expect(repairPlateCandidate("SBA5678Z")).toBe("SBA5678Z");
    expect(repairPlateCandidate("SKL 9081 A")).toBe("SKL9081A");
  });
  test("returns '' for pure noise or words (nothing to repair)", () => {
    expect(repairPlateCandidate("YWERETANCLPPEMYY")).toBe("");
    expect(repairPlateCandidate("TOYOTA")).toBe("");
  });
  test("returns '' when the grammar admits MORE than one plausible plate (ambiguous)", () => {
    // "SSSA": (2,1)→"SS5A" and (1,2)→"S55A" are both valid → refuse to guess.
    expect(repairPlateCandidate("SSSA")).toBe("");
  });
  test("takes ONLY the raw value — the expected booking plate is never an input", () => {
    expect(repairPlateCandidate.length).toBe(1);
    // Same input → same output regardless of any external/booking context.
    expect(repairPlateCandidate("SBA56787", "SKL9081A")).toBe("SBA5678Z");
  });
});

describe("booking-reference validation", () => {
  test("accepts a valid FlowGuard reference in any case", () => {
    expect(isValidBookingRef("FG-ABC123")).toBe(true);
    expect(isValidBookingRef("fg-abc123")).toBe(true);
    expect(normalizeBookingRef("  fg-abc123 ")).toBe("FG-ABC123");
  });
  test("rejects arbitrary QR text", () => {
    expect(isValidBookingRef("https://evil.example/pwn")).toBe(false);
    expect(isValidBookingRef("HELLO")).toBe(false);
    expect(isValidBookingRef("")).toBe(false);
    expect(isValidBookingRef("FG-")).toBe(false);
  });
});
