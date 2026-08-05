// Frontend unit test — plate OCR wrapper (recognizePlate).
// tesseract.js is mocked so no WASM/model is downloaded; canvas is faked because
// jsdom has no 2D backend. Verifies that recognizePlate returns ONLY a plausible
// plate, keeps the raw text for troubleshooting, and runs at most two OCR passes.
import { describe, test, expect, vi, beforeEach } from "vitest";

// recognizePlate spins up ONE transient worker (createWorker) and reuses it across
// the passes; the mock exposes that worker's recognize/terminate as spies. The
// crop retry forwards a whitelist + single-line PSM as the recognize options.
const recognize = vi.fn();
const setParameters = vi.fn();
const terminate = vi.fn().mockResolvedValue(undefined);
const createWorker = vi.fn(async () => ({ recognize, setParameters, terminate }));
vi.mock("tesseract.js", () => ({ createWorker: (...args) => createWorker(...args) }));

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
    // First pass is unconstrained (may contain surrounding text); no whitelist/PSM.
    expect(recognize.mock.calls[0][1]).toEqual({});
    expect(terminate).toHaveBeenCalledTimes(1); // transient worker torn down
  });

  test("a raw OCR value with a mis-read checksum letter is repaired to the true plate", async () => {
    // Physically-observed staging failure: SBA5678Z read as SBA56787 (Z→7).
    recognize.mockResolvedValue(ocr("SBA56787", 47));
    const res = await recognizePlate(source);
    expect(res.normalized).toBe("SBA5678Z"); // grammar-repaired, no booking involved
    expect(res.readable).toBe(true);
    expect(res.raw).toBe("SBA56787"); // raw kept verbatim for FM troubleshooting
    expect(recognize).toHaveBeenCalledTimes(1); // repaired on the first pass — no retry
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
    // The crop retry constrains Tesseract to the plate charset + single-line PSM.
    expect(recognize.mock.calls[1][1]).toEqual({
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
      tessedit_pageseg_mode: "7",
    });
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
