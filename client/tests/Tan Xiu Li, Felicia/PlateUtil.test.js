// Frontend unit test — shared Singapore-plate normalisation (browser copy).
import { describe, test, expect } from "vitest";
import {
  normalizePlate, platesMatch, isPlausiblePlate, extractPlateCandidate,
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
