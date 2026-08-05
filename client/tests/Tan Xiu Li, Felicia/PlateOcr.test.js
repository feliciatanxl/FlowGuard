// Frontend unit test — plate OCR wrapper (recognizePlate).
// tesseract.js is mocked so no WASM/model is downloaded; canvas is faked because
// jsdom has no 2D backend. Verifies that recognizePlate returns ONLY a plausible
// plate, keeps the raw text for troubleshooting, and runs at most two OCR passes.
import { describe, test, expect, vi, beforeEach } from "vitest";

const recognize = vi.fn();
vi.mock("tesseract.js", () => ({ recognize: (...args) => recognize(...args) }));

import { recognizePlate } from "../../src/utils/plateOcr";

const realCreate = document.createElement.bind(document);
const fakeCanvas = () => ({
  width: 0,
  height: 0,
  getContext: () => ({
    drawImage: vi.fn(),
    // Force the grayscale/contrast path to be skipped (best-effort, wrapped in try/catch).
    getImageData: () => { throw new Error("no 2D backend"); },
    putImageData: vi.fn(),
  }),
});

// A plain (non-canvas) source so recognizePlate goes through preprocessToCanvas.
const source = { width: 100, height: 100 };
const ocr = (text, confidence) => ({ data: { text, confidence } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(document, "createElement").mockImplementation((tag) =>
    tag === "canvas" ? fakeCanvas() : realCreate(tag)
  );
});

describe("recognizePlate", () => {
  test("returns a plausible plate from the first pass and marks it readable", async () => {
    recognize.mockResolvedValue(ocr("SKL 9081 A", 91));
    const res = await recognizePlate(source);
    expect(res.normalized).toBe("SKL9081A");
    expect(res.readable).toBe(true);
    expect(res.raw).toBe("SKL 9081 A");
    expect(res.confidence).toBe(91);
    expect(recognize).toHaveBeenCalledTimes(1); // no second pass needed
  });

  test("garbage first pass triggers ONE bounded crop pass that recovers the plate", async () => {
    recognize
      .mockResolvedValueOnce(ocr("YWERETANCLPPEMYY", 30)) // full frame — noise
      .mockResolvedValueOnce(ocr("SKL 9081 A", 80));       // lower-centre crop — plate
    const res = await recognizePlate(source);
    expect(res.normalized).toBe("SKL9081A");
    expect(res.readable).toBe(true);
    expect(res.raw).toBe("SKL 9081 A");
    expect(res.confidence).toBe(80);
    expect(recognize).toHaveBeenCalledTimes(2); // at most two passes
  });

  test("noise in both passes is unreadable, retains raw, and never collapses to a plate", async () => {
    recognize.mockResolvedValue(ocr("YWERETANCLPPEMYY", 12));
    const res = await recognizePlate(source);
    expect(res.normalized).toBe("");
    expect(res.readable).toBe(false);
    expect(res.raw).toBe("YWERETANCLPPEMYY"); // kept for FM troubleshooting
    expect(recognize).toHaveBeenCalledTimes(2); // exactly two passes, no unbounded retries
  });

  test("a caller-provided crop is respected and never triggers a second pass", async () => {
    recognize.mockResolvedValue(ocr("nothing here", 20));
    const res = await recognizePlate(source, { crop: { x: 0, y: 0, w: 1, h: 1 } });
    expect(res.readable).toBe(false);
    expect(res.normalized).toBe("");
    expect(recognize).toHaveBeenCalledTimes(1); // crop given → single pass
  });
});
