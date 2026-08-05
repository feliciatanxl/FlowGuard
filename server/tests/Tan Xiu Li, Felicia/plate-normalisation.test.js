// Backend unit test — shared Singapore-plate normalisation helper (server side).
const {
  normalizePlate, platesMatch, isPlausiblePlate, repairPlateCandidate, extractPlateCandidate,
} = require("../../utils/plate");

describe("normalizePlate", () => {
  test("strips spaces, dashes and case so common formats collapse to one string", () => {
    expect(normalizePlate("GBG 1234 M")).toBe("GBG1234M");
    expect(normalizePlate("GBG-1234M")).toBe("GBG1234M");
    expect(normalizePlate("gbg1234m")).toBe("GBG1234M");
    expect(normalizePlate("  gbg 1234-m ")).toBe("GBG1234M");
  });

  test("is null/undefined safe", () => {
    expect(normalizePlate(null)).toBe("");
    expect(normalizePlate(undefined)).toBe("");
    expect(normalizePlate("")).toBe("");
  });
});

describe("platesMatch", () => {
  test("matches across formatting differences", () => {
    expect(platesMatch("GBG 1234 M", "gbg-1234m")).toBe(true);
    expect(platesMatch("SBA1234A", "SBA 1234 A")).toBe(true);
  });

  test("does not match different plates", () => {
    expect(platesMatch("GBG1234M", "GBG1284M")).toBe(false);
  });

  test("an empty observed plate never matches (missing plate, not a match)", () => {
    expect(platesMatch("", "GBG1234M")).toBe(false);
    expect(platesMatch(null, "GBG1234M")).toBe(false);
  });
});

describe("isPlausiblePlate", () => {
  test("accepts well-formed plates and rejects OCR noise (mirrors the client)", () => {
    expect(isPlausiblePlate("GBG1234M")).toBe(true);
    expect(isPlausiblePlate("SKL 9081 A")).toBe(true);
    expect(isPlausiblePlate("SBA5678Z")).toBe(true);
    expect(isPlausiblePlate("S1A")).toBe(true);
    expect(isPlausiblePlate("YWERETANCLPPEMYY")).toBe(false);
    expect(isPlausiblePlate("TOYOTA")).toBe(false);
    expect(isPlausiblePlate("123456789")).toBe(false);
    expect(isPlausiblePlate("")).toBe(false);
  });
});

describe("extractPlateCandidate", () => {
  test("pulls a plausible plate out of noisy multiline OCR", () => {
    expect(extractPlateCandidate("Vehicle entrance\nSKL 9081 A\nToyota")).toBe("SKL9081A");
  });
  test("normalises spacing/hyphens/case", () => {
    expect(extractPlateCandidate("gbg-1234-m")).toBe("GBG1234M");
    expect(extractPlateCandidate("GBG 1234 M")).toBe("GBG1234M");
  });
  test("returns '' for OCR noise (never collapses a paragraph into a plate)", () => {
    expect(extractPlateCandidate("YWERETANCLPPEMYY")).toBe("");
    expect(extractPlateCandidate("TOYOTA\nVEHICLE ENTRANCE\n123456789")).toBe("");
    expect(extractPlateCandidate("")).toBe("");
  });
  test("grammar-repairs a mis-read checksum letter (SBA56787 → SBA5678Z)", () => {
    expect(extractPlateCandidate("SBA56787")).toBe("SBA5678Z");
    expect(extractPlateCandidate("Noise SBA56787 extra words")).toBe("SBA5678Z");
    expect(extractPlateCandidate("SBA 5678 Z")).toBe("SBA5678Z");
  });
});

describe("repairPlateCandidate (mirrors the client)", () => {
  test("uniquely repairs the physically-observed Z→7 checksum mis-read", () => {
    expect(repairPlateCandidate("SBA56787")).toBe("SBA5678Z");
  });
  test("leaves an already-plausible plate unchanged", () => {
    expect(repairPlateCandidate("SBA5678Z")).toBe("SBA5678Z");
    expect(repairPlateCandidate("GBG 1234 M")).toBe("GBG1234M");
  });
  test("returns '' for noise, words and ambiguous reconstructions", () => {
    expect(repairPlateCandidate("YWERETANCLPPEMYY")).toBe("");
    expect(repairPlateCandidate("TOYOTA")).toBe("");
    expect(repairPlateCandidate("SSSA")).toBe(""); // (2,1)→SS5A vs (1,2)→S55A → ambiguous
  });
  test("depends ONLY on the raw value — never on any expected/booking plate", () => {
    expect(repairPlateCandidate.length).toBe(1);
  });
});
