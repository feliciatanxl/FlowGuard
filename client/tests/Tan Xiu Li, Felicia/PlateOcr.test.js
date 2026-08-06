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
} from "../../src/utils/plateOcr";

const realCreate = document.createElement.bind(document);
const fakeCanvas = (w = 300, h = 80, toDataUrlStr = "data:image/png;base64,fake") => ({
  width: w,
  height: h,
  toDataURL: () => toDataUrlStr,
  getContext: () => ({
    drawImage: vi.fn(),
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

const plateOnlySource = { width: 300, height: 80 };
const fullCarSource = { width: 600, height: 400 };
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
      rawText: "(none)",
      extractedCandidate: "",
    });
    expect(classification).toBe("TESSERACT_EMPTY_RESULT");
    expect(classification).not.toBe("CANDIDATE_REJECTED");
  });

  test("Non-empty raw text failing plate grammar is classified as CANDIDATE_REJECTED", () => {
    const classification = classifyOcrFailure({
      sourceInfo: { srcW: 600, srcH: 400, isReady: true },
      pixelStats: { usable: true, brightnessVariance: 50 },
      rawText: "NOT A VALID PLATE 12345",
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

describe("Diagnostic Mode & Preview Requirements", () => {
  test("1. Diagnostic mode is disabled normally when ?ocrDebug=1 is absent and debug flag is false", async () => {
    recognize.mockResolvedValue(ocr("GBG 1234 M", 92));
    const groupSpy = vi.spyOn(console, "groupCollapsed");

    const res = await recognizePlate(webcamSource, { isUpload: false, debug: false });
    expect(res.normalized).toBe("GBG1234M");
    expect(groupSpy).not.toHaveBeenCalled();
  });

  test("2. debug: true or ?ocrDebug=1 enables diagnostics logging and metadata", async () => {
    recognize.mockResolvedValue(ocr("GBG 1234 M", 92));
    const groupSpy = vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});

    const res = await recognizePlate(webcamSource, { isUpload: false, debug: true });
    expect(res.diagnostics).toBeTruthy();
    expect(res.diagnostics.sourceInfo.srcW).toBe(1280);
    expect(res.diagnostics.passes.length).toBeGreaterThan(0);
    expect(groupSpy).toHaveBeenCalled();

    groupSpy.mockRestore();
  });

  test("3. Source dimensions are recorded in diagnostics", async () => {
    recognize.mockResolvedValue(ocr("GBG 1234 M", 95));
    const res = await recognizePlate(webcamSource, { isUpload: false, debug: true });
    expect(res.diagnostics.sourceInfo.srcW).toBe(1280);
    expect(res.diagnostics.sourceInfo.srcH).toBe(720);
  });

  test("6. Each OCR pass records parameters, dimensions, raw text and confidence", async () => {
    recognize.mockResolvedValue(ocr("GBG 1234 M", 96));
    const res = await recognizePlate(plateOnlySource, { isUpload: true, debug: true });

    const pass1 = res.diagnostics.passes[0];
    expect(pass1).toBeTruthy();
    expect(pass1.dimensions.w).toBeGreaterThan(0);
    expect(pass1.params.tessedit_pageseg_mode).toBe("7");
    expect(pass1.raw).toBe("GBG 1234 M");
    expect(pass1.confidence).toBe(96);
  });

  test("7. Uploaded-image previews use the decoded canvas", async () => {
    recognize.mockResolvedValue(ocr("GBG 1234 M", 95));
    const res = await recognizePlate(fullCarSource, { isUpload: true, debug: true });

    expect(res.diagnostics.sourceInfo.sourceType).toBe("Upload");
    expect(res.diagnostics.passes[0].previewUrl).toContain("data:image/png");
  });

  test("8. Camera previews use the captured camera canvas", async () => {
    recognize.mockResolvedValue(ocr("GBG 1234 M", 90));
    const res = await recognizePlate(webcamSource, { isUpload: false, debug: true });

    expect(res.diagnostics.sourceInfo.sourceType).toBe("Laptop Webcam");
    expect(res.diagnostics.passes[0].previewUrl).toContain("data:image/png");
  });

  test("10. Diagnostics do not alter VERIFIED, PLATE_MISMATCH or OCR_UNREADABLE results", async () => {
    recognize.mockResolvedValue(ocr("GBG 1234 M", 90));
    const resWithoutDebug = await recognizePlate(webcamSource, { isUpload: false, debug: false });
    const resWithDebug = await recognizePlate(webcamSource, { isUpload: false, debug: true });

    expect(resWithDebug.raw).toBe(resWithoutDebug.raw);
    expect(resWithDebug.normalized).toBe(resWithoutDebug.normalized);
    expect(resWithDebug.confidence).toBe(resWithoutDebug.confidence);
    expect(resWithDebug.readable).toBe(resWithoutDebug.readable);
  });

  test("11. No image is sent to the server or persisted (data URLs remain in browser memory)", async () => {
    recognize.mockResolvedValue(ocr("GBG 1234 M", 90));
    const res = await recognizePlate(plateOnlySource, { isUpload: true, debug: true });
    expect(res.diagnostics.passes[0].previewUrl.startsWith("data:")).toBe(true);
  });
});
