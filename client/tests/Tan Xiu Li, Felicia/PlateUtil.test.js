// Frontend unit test — shared Singapore-plate normalisation (browser copy).
import { describe, test, expect } from "vitest";
import { normalizePlate, platesMatch } from "../../src/utils/plate";
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
