// Frontend unit test — plate OCR wrapper, upload decoder, and runtime diagnostics.
// tesseract.js is mocked so no WASM/model is downloaded; canvas is faked because
// jsdom has no 2D backend.
import { describe, test, expect, vi, beforeEach } from "vitest";

const recognize = vi.fn();
const setParameters = vi.fn().mockResolvedValue(undefined);
const terminate = vi.fn().mockResolvedValue(undefined);
const createWorker = vi.fn(async () => ({ recognize, setParameters, terminate }));
vi.mock("tesseract.js", () => ({ createWorker: (...args) => createWorker(...args) }));

import {
  recognizePlate,
  decodeFileToCanvas,
  getSourceInfo,
  analyzeCanvasPixels,
  classifyOcrFailure,
  preprocessToCanvas,
  PLATE_FALLBACK_CROP,
  PLATE_TIGHT_CROP,
} from "../../src/utils/plateOcr";

const realCreate = document.createElement.bind(document);
const fakeCanvas = (w = 300, h = 80, toDataUrlStr = "data:image/png;base64,fake") => ({
  width: w,
  height: h,
  toDataURL: () => toDataUrlStr,
  getContext: () => ({
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    getImageData: () => {
      const arr = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < arr.length; i += 4) {
        const v = (i / 4) % 2 === 0 ? 50 : 200;
        arr[i] = v;
        arr[i + 1] = v;
        arr[i + 2] = v;
        arr[i + 3] = 255;
      }
      return { data: arr };
    },
    putImageData: vi.fn(),
  }),
});

const plateOnlySource = { width: 300, height: 80 }; // aspect ratio 3.75 >= 2.2
const fullCarSource = { width: 600, height: 400 };  // aspect ratio 1.5 < 2.2
const webcamSource = { videoWidth: 1280, videoHeight: 720, readyState: 4 };

const ocr = (text, confidence) => ({ data: { text, confidence, words: [], symbols: [] } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(document, "createElement").mockImplementation((tag) =>
    tag === "canvas" ? fakeCanvas() : realCreate(tag)
  );
});

describe("decodeFileToCanvas", () => {
  test("Decodes image file into a canvas", async () => {
    const file = new File(["dummy-png"], "plate.png", { type: "image/png" });
    const bitmapClose = vi.fn();
    globalThis.createImageBitmap = vi.fn().mockResolvedValue({
      width: 400,
      height: 100,
      close: bitmapClose,
    });

    const canvas = await decodeFileToCanvas(file);
    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(100);
    expect(bitmapClose).toHaveBeenCalled();
  });
});

describe("getSourceInfo & Metadata Recording", () => {
  test("getSourceInfo correctly records webcam properties", () => {
    const info = getSourceInfo(webcamSource, false);
    expect(info.sourceType).toBe("Laptop Webcam");
    expect(info.srcW).toBe(1280);
    expect(info.srcH).toBe(720);
    expect(info.readyState).toBe(4);
    expect(info.isReady).toBe(true);
  });

  test("getSourceInfo correctly records upload file properties", () => {
    const file = new File(["dummy"], "plate.png", { type: "image/png" });
    const info = getSourceInfo(file, true);
    expect(info.sourceType).toBe("Upload");
    expect(info.jsObjectType).toBe("File");
    expect(info.mimeType).toBe("image/png");
    expect(info.fileSize).toBe(5);
  });
});

describe("analyzeCanvasPixels & Canvas Validation", () => {
  test("Blank / zero-sized canvas is classified unusable", () => {
    const stats = analyzeCanvasPixels({ width: 0, height: 0 });
    expect(stats.usable).toBe(false);
    expect(stats.reason).toBe("Zero dimensions");
  });

  test("Non-zero visible canvas is classified usable in test environment", () => {
    const canvas = fakeCanvas(200, 50);
    const stats = analyzeCanvasPixels(canvas);
    expect(stats.width).toBe(200);
    expect(stats.height).toBe(50);
    expect(stats.usable).toBe(true);
  });
});

describe("classifyOcrFailure Rules", () => {
  test("Raw text (none) or empty string is classified as TESSERACT_EMPTY_RESULT, NEVER CANDIDATE_REJECTED", () => {
    const classification = classifyOcrFailure({
      sourceInfo: { srcW: 600, srcH: 400, isReady: true },
      pixelStats: { usable: true, brightnessVariance: 50 },
      passes: [{ raw: "" }, { raw: "" }],
      rawText: "",
      extractedCandidate: "",
    });
    expect(classification).toBe("TESSERACT_EMPTY_RESULT");
    expect(classification).not.toBe("CANDIDATE_REJECTED");
  });

  test("Non-empty raw text failing plate grammar is classified as CANDIDATE_REJECTED", () => {
    const classification = classifyOcrFailure({
      sourceInfo: { srcW: 600, srcH: 400, isReady: true },
      pixelStats: { usable: true, brightnessVariance: 50 },
      passes: [{ raw: "EE" }],
      rawText: "EE",
      extractedCandidate: "",
    });
    expect(classification).toBe("CANDIDATE_REJECTED");
  });

  test("Unusable canvas is classified as BLANK_OR_UNIFORM_CANVAS", () => {
    const classification = classifyOcrFailure({
      sourceInfo: { srcW: 600, srcH: 400, isReady: true },
      pixelStats: { usable: false, reason: "Mostly transparent" },
    });
    expect(classification).toBe("BLANK_OR_UNIFORM_CANVAS");
  });
});

describe("Focused Tesseract OCR Fix Tests", () => {
  test("1. Plate-only upload does not use the full-car lower-centre crop", async () => {
    recognize.mockResolvedValue(ocr("6BG1234M", 90));
    const res = await recognizePlate(plateOnlySource, { isUpload: true, debug: true });

    expect(res.diagnostics.passes.length).toBe(1);
    expect(res.diagnostics.passes[0].crop).toBeNull();
    expect(res.normalized).toBe("GBG1234M");
  });

  test("2. Plate-only passes are genuinely different", async () => {
    recognize
      .mockResolvedValueOnce(ocr("", 0))       // Pass 1 empty
      .mockResolvedValueOnce(ocr("6BG1234M", 88)); // Pass 2 succeeds

    const res = await recognizePlate(plateOnlySource, { isUpload: true, debug: true });

    expect(res.diagnostics.passes.length).toBe(2);
    expect(res.diagnostics.passes[0].passName).toContain("Pass 1");
    expect(res.diagnostics.passes[1].passName).toContain("Pass 2");
    expect(res.normalized).toBe("GBG1234M");
  });

  test("3 & 4. Original/padded/resized source dimensions remain non-zero and white padding enlarges canvas", () => {
    const source = fakeCanvas(400, 100);
    const processed = preprocessToCanvas(source, { padPx: 25, targetWidth: 800 });

    expect(processed.width).toBeGreaterThan(0);
    expect(processed.height).toBeGreaterThan(0);
    // targetWidth is 800 so scaled width is 400 (since 400 <= 800), plus 2 * 25 padding = 450
    expect(processed.width).toBe(450);
    expect(processed.height).toBe(150);
  });

  test("5. Camera full-frame first pass uses scene-appropriate PSM.AUTO (3)", async () => {
    recognize.mockResolvedValue(ocr("GBG1234M", 95));
    const res = await recognizePlate(webcamSource, { isUpload: false, debug: true });

    expect(res.diagnostics.passes[0].params.tessedit_pageseg_mode).toBe("3");
    expect(setParameters).toHaveBeenCalledWith(expect.objectContaining({ tessedit_pageseg_mode: "3" }));
  });

  test("6. Full-car upload receives bounded broad and tighter crop passes", async () => {
    recognize
      .mockResolvedValueOnce(ocr("", 0))                  // Pass 1 full scene empty
      .mockResolvedValueOnce(ocr("", 0))                  // Pass 2 broad crop empty
      .mockResolvedValueOnce(ocr("7 SKL9081A E", 85));    // Pass 3 tighter crop succeeds

    const res = await recognizePlate(fullCarSource, { isUpload: true, debug: true });

    expect(res.diagnostics.passes.length).toBe(3);
    expect(res.diagnostics.passes[1].crop).toEqual(PLATE_FALLBACK_CROP);
    expect(res.diagnostics.passes[2].crop).toEqual(PLATE_TIGHT_CROP);
    expect(res.normalized).toBe("SKL9081A");
  });

  test("7. Maximum pass count (<=3) is respected", async () => {
    recognize.mockResolvedValue(ocr("", 0));

    const res = await recognizePlate(fullCarSource, { isUpload: true, debug: true });
    expect(res.diagnostics.passes.length).toBeLessThanOrEqual(3);
  });

  test("8 & 9. Worker parameters are applied before each recognize call without contamination", async () => {
    recognize
      .mockResolvedValueOnce(ocr("", 0))
      .mockResolvedValueOnce(ocr("6BG1234M", 90));

    await recognizePlate(plateOnlySource, { isUpload: true, debug: true });

    expect(setParameters).toHaveBeenCalledTimes(2);
    // Check parameters set in each call
    expect(setParameters.mock.calls[0][0].tessedit_pageseg_mode).toBe("13");
    expect(setParameters.mock.calls[1][0].tessedit_pageseg_mode).toBe("13");
  });

  test("10. Valid GBG1234M OCR result is accepted", async () => {
    recognize.mockResolvedValue(ocr("6BG 1234 M", 92));
    const res = await recognizePlate(plateOnlySource, { isUpload: true });

    expect(res.readable).toBe(true);
    expect(res.normalized).toBe("GBG1234M");
  });

  test("11. Valid SKL9081A result is accepted", async () => {
    recognize.mockResolvedValue(ocr("SKL 9081 A", 89));
    const res = await recognizePlate(fullCarSource, { isUpload: true });

    expect(res.readable).toBe(true);
    expect(res.normalized).toBe("SKL9081A");
  });

  test("12. 'EE' remains rejected as CANDIDATE_REJECTED", async () => {
    recognize.mockResolvedValue(ocr("EE", 5));
    const res = await recognizePlate(plateOnlySource, { isUpload: true, debug: true });

    expect(res.readable).toBe(false);
    expect(res.normalized).toBe("");
    expect(res.diagnostics.classification).toBe("CANDIDATE_REJECTED");
  });

  test("13. A later non-empty result is selected for diagnostics over an earlier empty result", async () => {
    recognize
      .mockResolvedValueOnce(ocr("", 0))       // Pass 1: empty
      .mockResolvedValueOnce(ocr("EE", 45));   // Pass 2: non-empty "EE"

    const res = await recognizePlate(plateOnlySource, { isUpload: true, debug: true });

    expect(res.raw).toBe("EE");
    expect(res.diagnostics.passes[1].isSelected).toBe(true);
    expect(res.diagnostics.classification).toBe("CANDIDATE_REJECTED");
  });

  test("14. TESSERACT_EMPTY_RESULT occurs only when all passes are empty", async () => {
    recognize.mockResolvedValue(ocr("", 0));

    const res = await recognizePlate(plateOnlySource, { isUpload: true, debug: true });

    expect(res.readable).toBe(false);
    expect(res.diagnostics.classification).toBe("TESSERACT_EMPTY_RESULT");
  });

  test("15. CANDIDATE_REJECTED occurs when any pass has non-empty rejected text and no valid candidate", async () => {
    recognize.mockResolvedValue(ocr("INVALID_TEXT_123", 40));

    const res = await recognizePlate(plateOnlySource, { isUpload: true, debug: true });

    expect(res.readable).toBe(false);
    expect(res.diagnostics.classification).toBe("CANDIDATE_REJECTED");
  });

  test("16. No expected booking plate is passed into OCR", async () => {
    recognize.mockResolvedValue(ocr("6BG1234M", 90));
    await recognizePlate(plateOnlySource, { isUpload: true });

    const callArgs = setParameters.mock.calls;
    callArgs.forEach((call) => {
      const p = call[0];
      expect(JSON.stringify(p)).not.toContain("GBG1234M");
    });
  });

  test("17. Diagnostic mode does not alter access decisions", async () => {
    recognize.mockResolvedValue(ocr("GBG 1234 M", 90));
    const resWithoutDebug = await recognizePlate(webcamSource, { isUpload: false, debug: false });
    const resWithDebug = await recognizePlate(webcamSource, { isUpload: false, debug: true });

    expect(resWithDebug.raw).toBe(resWithoutDebug.raw);
    expect(resWithDebug.normalized).toBe(resWithoutDebug.normalized);
    expect(resWithDebug.confidence).toBe(resWithoutDebug.confidence);
    expect(resWithDebug.readable).toBe(resWithoutDebug.readable);
  });
});
