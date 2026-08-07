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
  calculateEffectiveConfidence,
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

const ocr = (text, confidence, words = []) => ({
  data: { text, confidence, words, symbols: [] },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(document, "createElement").mockImplementation((tag) =>
    tag === "canvas" ? fakeCanvas() : realCreate(tag)
  );
});

describe("calculateEffectiveConfidence Helper", () => {
  test("1. Empty trimmed OCR text always has effective confidence 0 even if engine reports high confidence", () => {
    const data = { confidence: 95, words: [{ text: "", confidence: 95 }] };
    expect(calculateEffectiveConfidence(data, "")).toBe(0);
    expect(calculateEffectiveConfidence(data, "   ")).toBe(0);
    expect(calculateEffectiveConfidence(data, "(none)")).toBe(0);
  });

  test("2 & 3. Non-empty word confidences are averaged and whitespace-only words ignored", () => {
    const data = {
      confidence: 50,
      words: [
        { text: "GBG1234M", confidence: 90 },
        { text: "   ", confidence: 10 },
        { text: "", confidence: 5 },
      ],
    };
    expect(calculateEffectiveConfidence(data, "GBG1234M")).toBe(90);
  });

  test("4. Falls back to data.confidence when raw text is non-empty and no word confidences exist", () => {
    const data = { confidence: 75, words: [] };
    expect(calculateEffectiveConfidence(data, "GBG1234M")).toBe(75);
  });

  test("5. Priority 2 TSV level 5 non-empty word token confidence takes precedence over engine data.confidence", () => {
    const data = {
      confidence: 81,
      tsv: "1\t1\t0\t0\t0\t0\t0\t0\t840\t307\t-1\t\n5\t1\t4\t1\t1\t1\t117\t44\t627\t162\t17.652969\tGBG1234M\n",
    };
    expect(calculateEffectiveConfidence(data, "GBG1234M")).toBe(17.7);
  });
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
  test("Raw text (none) or empty string is classified as TESSERACT_EMPTY_RESULT", () => {
    const classification = classifyOcrFailure({
      sourceInfo: { srcW: 600, srcH: 400, isReady: true },
      pixelStats: { usable: true, brightnessVariance: 50 },
      passes: [{ raw: "" }, { raw: "" }],
      rawText: "",
      extractedCandidate: "",
    });
    expect(classification).toBe("TESSERACT_EMPTY_RESULT");
  });

  test("Syntax-plausible candidate below MIN_ACCEPTED_CONFIDENCE is classified as LOW_CONFIDENCE_CANDIDATE", () => {
    const classification = classifyOcrFailure({
      sourceInfo: { srcW: 600, srcH: 400, isReady: true },
      pixelStats: { usable: true, brightnessVariance: 50 },
      passes: [{ raw: "GBG1234W", effectiveConfidence: 0 }],
      rawText: "GBG1234W",
      extractedCandidate: "GBG1234W",
      effectiveConfidence: 0,
    });
    expect(classification).toBe("LOW_CONFIDENCE_CANDIDATE");
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

    expect(res.diagnostics.passes[0].crop).toBeNull();
    expect(res.normalized).toBe("GBG1234M");
  });

  test("2. Low-confidence candidate (< MIN_ACCEPTED_CONFIDENCE) does NOT stop after Pass 1", async () => {
    recognize
      .mockResolvedValueOnce(ocr("6BG1234W", 0))       // Pass 1: candidate at 0% confidence
      .mockResolvedValueOnce(ocr("6BG1234M", 88));      // Pass 2: candidate at 88% confidence

    const res = await recognizePlate(plateOnlySource, { isUpload: true, debug: true });

    expect(res.diagnostics.passes.length).toBe(2); // Ran Pass 2!
    expect(res.normalized).toBe("GBG1234M");
    expect(res.readable).toBe(true);
  });

  test("3. A candidate meeting MIN_ACCEPTED_CONFIDENCE (>= 10%) stops early", async () => {
    recognize.mockResolvedValueOnce(ocr("6BG1234M", 90));

    const res = await recognizePlate(plateOnlySource, { isUpload: true, debug: true });

    expect(res.diagnostics.passes.length).toBe(1); // Stopped after Pass 1!
    expect(res.diagnostics.classification).toBe("ACCEPTED_OCR_CANDIDATE");
  });

  test("4. Full-car upload receives bounded plate-focused crops and uses PSM.AUTO for Pass 2 and Pass 3", async () => {
    recognize
      .mockResolvedValueOnce(ocr("", 0))                  // Pass 1 full scene empty
      .mockResolvedValueOnce(ocr("PUA", 47))             // Pass 2 plate-centred crop
      .mockResolvedValueOnce(ocr("GBG1234M", 47));       // Pass 3 reduced bumper crop succeeds

    const res = await recognizePlate(fullCarSource, { isUpload: true, debug: true });

    expect(res.diagnostics.passes.length).toBe(3); // Maximum 3 passes
    expect(res.diagnostics.passes[0].params.tessedit_pageseg_mode).toBe("3"); // Pass 1 is PSM.AUTO
    expect(res.diagnostics.passes[1].crop).toEqual(PLATE_FALLBACK_CROP);
    expect(res.diagnostics.passes[2].crop).toEqual(PLATE_TIGHT_CROP);
    expect(res.diagnostics.passes[1].params.tessedit_pageseg_mode).toBe("3");
    expect(res.diagnostics.passes[2].params.tessedit_pageseg_mode).toBe("3");
    expect(res.normalized).toBe("GBG1234M");
    expect(res.readable).toBe(true);
    expect(res.diagnostics.classification).toBe("ACCEPTED_OCR_CANDIDATE");
  });

  test("5. Camera full-frame first pass uses scene-appropriate PSM.AUTO (3)", async () => {
    recognize.mockResolvedValue(ocr("GBG1234M", 95));
    const res = await recognizePlate(webcamSource, { isUpload: false, debug: true });

    expect(res.diagnostics.passes[0].params.tessedit_pageseg_mode).toBe("3");
    expect(setParameters).toHaveBeenCalledWith(expect.objectContaining({ tessedit_pageseg_mode: "3" }));
  });

  test("6. Low-confidence candidate returns readable: false, preserves normalized plate, and classifies as LOW_CONFIDENCE_CANDIDATE", async () => {
    recognize.mockResolvedValue(ocr("GBG1234W", 0)); // 0% effective confidence

    const res = await recognizePlate(plateOnlySource, { isUpload: true, debug: true });

    expect(res.readable).toBe(false); // Keeps barrier closed!
    expect(res.normalized).toBe("GBG1234W"); // Preserves detected candidate for UI!
    expect(res.diagnostics.classification).toBe("LOW_CONFIDENCE_CANDIDATE");
  });

  test("7. GBG1234W is NOT automatically changed to GBG1234M without exact syntax rules", async () => {
    recognize.mockResolvedValue(ocr("GBG1234W", 80));
    const res = await recognizePlate(plateOnlySource, { isUpload: true });

    expect(res.normalized).toBe("GBG1234W");
    expect(res.normalized).not.toBe("GBG1234M");
  });

  test("8. No expected booking plate is passed into OCR", async () => {
    recognize.mockResolvedValue(ocr("6BG1234M", 90));
    await recognizePlate(plateOnlySource, { isUpload: true });

    const callArgs = setParameters.mock.calls;
    callArgs.forEach((call) => {
      const p = call[0];
      expect(JSON.stringify(p)).not.toContain("GBG1234M");
    });
  });

  test("9. All-empty result does not misleadingly display [SELECTED] and keeps barrier closed", async () => {
    recognize.mockResolvedValue(ocr("", 0)); // All passes return empty text
    const res = await recognizePlate(fullCarSource, { isUpload: true, debug: true });

    expect(res.readable).toBe(false);
    expect(res.normalized).toBe("");
    expect(res.confidence).toBe(0);
    expect(res.diagnostics.classification).toBe("TESSERACT_EMPTY_RESULT");
    expect(res.diagnostics.passes.every((p) => p.isSelected === false)).toBe(true);
  });

  test("10. Diagnostic mode does not alter access decisions", async () => {
    recognize.mockResolvedValue(ocr("GBG 1234 M", 90));
    const resWithoutDebug = await recognizePlate(webcamSource, { isUpload: false, debug: false });
    const resWithDebug = await recognizePlate(webcamSource, { isUpload: false, debug: true });

    expect(resWithDebug.raw).toBe(resWithoutDebug.raw);
    expect(resWithDebug.normalized).toBe(resWithoutDebug.normalized);
    expect(resWithDebug.confidence).toBe(resWithoutDebug.confidence);
    expect(resWithDebug.readable).toBe(resWithoutDebug.readable);
  });
});
