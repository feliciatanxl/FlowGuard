// Frontend unit test — plate OCR wrapper & upload decoder (recognizePlate, decodeFileToCanvas).
// tesseract.js is mocked so no WASM/model is downloaded; canvas is faked because
// jsdom has no 2D backend.
import { describe, test, expect, vi, beforeEach } from "vitest";

const recognize = vi.fn();
const setParameters = vi.fn().mockResolvedValue(undefined);
const terminate = vi.fn().mockResolvedValue(undefined);
const createWorker = vi.fn(async () => ({ recognize, setParameters, terminate }));
vi.mock("tesseract.js", () => ({ createWorker: (...args) => createWorker(...args) }));

import { recognizePlate, decodeFileToCanvas } from "../../src/utils/plateOcr";

const realCreate = document.createElement.bind(document);
const fakeCanvas = (w = 300, h = 80) => ({
  width: w,
  height: h,
  getContext: () => ({
    drawImage: vi.fn(),
    getImageData: () => { throw new Error("no 2D backend"); },
    putImageData: vi.fn(),
  }),
});

// Plate-only source (aspect ratio 300 / 80 = 3.75 >= 2.2)
const plateOnlySource = { width: 300, height: 80 };
// Full car photograph source (aspect ratio 600 / 400 = 1.5 < 2.2)
const fullCarSource = { width: 600, height: 400 };

const ocr = (text, confidence) => ({ data: { text, confidence } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(document, "createElement").mockImplementation((tag) =>
    tag === "canvas" ? fakeCanvas() : realCreate(tag)
  );
});

describe("decodeFileToCanvas", () => {
  test("1. A PNG File is decoded before OCR begins", async () => {
    const file = new File(["dummy-png-content"], "plate.png", { type: "image/png" });
    const bitmapClose = vi.fn();
    globalThis.createImageBitmap = vi.fn().mockResolvedValue({
      width: 400,
      height: 100,
      close: bitmapClose,
    });

    const canvas = await decodeFileToCanvas(file);
    expect(canvas).toBeTruthy();
    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(100);
    expect(globalThis.createImageBitmap).toHaveBeenCalledWith(file);
    expect(bitmapClose).toHaveBeenCalledTimes(1); // closed in finally
  });

  test("2. A JPEG File is decoded before OCR begins", async () => {
    const file = new File(["dummy-jpeg-content"], "plate.jpg", { type: "image/jpeg" });
    const bitmapClose = vi.fn();
    globalThis.createImageBitmap = vi.fn().mockResolvedValue({
      width: 500,
      height: 120,
      close: bitmapClose,
    });

    const canvas = await decodeFileToCanvas(file);
    expect(canvas).toBeTruthy();
    expect(canvas.width).toBe(500);
    expect(canvas.height).toBe(120);
    expect(bitmapClose).toHaveBeenCalledTimes(1);
  });

  test("3. OCR receives a non-zero decoded canvas", async () => {
    const file = new File(["png"], "plate.png", { type: "image/png" });
    globalThis.createImageBitmap = vi.fn().mockResolvedValue({
      width: 320,
      height: 90,
      close: vi.fn(),
    });

    const canvas = await decodeFileToCanvas(file);
    expect(canvas.width).toBeGreaterThan(0);
    expect(canvas.height).toBeGreaterThan(0);
  });

  test("4. OCR does not receive an unresolved File when a canvas is required", async () => {
    recognize.mockResolvedValue(ocr("GBG 1234 M", 95));
    const file = new File(["png"], "plate.png", { type: "image/png" });
    globalThis.createImageBitmap = vi.fn().mockResolvedValue({
      width: 300,
      height: 80,
      close: vi.fn(),
    });

    const res = await recognizePlate(file);
    expect(res.normalized).toBe("GBG1234M");
    // Recognize received a canvas, not the raw File
    const passInput = recognize.mock.calls[0][0];
    expect(passInput).not.toBe(file);
    expect(typeof passInput.getContext).toBe("function");
  });

  test("5. Object URL is revoked only after all OCR passes finish (fallback path)", async () => {
    delete globalThis.createImageBitmap; // force HTMLImageElement fallback path
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const createSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:http://localhost/test-uuid");

    // Mock Image load
    const realImage = globalThis.Image;
    globalThis.Image = class {
      constructor() {
        this.naturalWidth = 400;
        this.naturalHeight = 100;
        setTimeout(() => { this.onload?.(); }, 0);
      }
    };

    const file = new File(["png-bytes"], "plate.png", { type: "image/png" });
    await decodeFileToCanvas(file);

    expect(createSpy).toHaveBeenCalledWith(file);
    expect(revokeSpy).toHaveBeenCalledTimes(1);

    globalThis.Image = realImage;
  });

  test("6. ImageBitmap is closed only after all OCR passes finish", async () => {
    const file = new File(["png"], "plate.png", { type: "image/png" });
    const bitmapClose = vi.fn();
    globalThis.createImageBitmap = vi.fn().mockResolvedValue({
      width: 400,
      height: 100,
      close: bitmapClose,
    });

    await decodeFileToCanvas(file);
    expect(bitmapClose).toHaveBeenCalledTimes(1);
  });

  test("7. Worker termination happens after recognition completes", async () => {
    recognize.mockResolvedValue(ocr("SKL 9081 A", 90));
    await recognizePlate(plateOnlySource);
    expect(recognize).toHaveBeenCalledTimes(1);
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  test("8. Failed decode produces the processing-error state", async () => {
    const invalidFile = { type: "text/plain" };
    await expect(decodeFileToCanvas(invalidFile)).rejects.toThrow(
      "The uploaded image could not be processed. Please select a valid PNG or JPEG."
    );
  });

  test("9. Zero-sized decoded image produces the processing-error state", async () => {
    const file = new File(["bad"], "empty.png", { type: "image/png" });
    globalThis.createImageBitmap = vi.fn().mockResolvedValue({
      width: 0,
      height: 0,
      close: vi.fn(),
    });

    await expect(decodeFileToCanvas(file)).rejects.toThrow(
      "The uploaded image could not be processed. Please select a valid PNG or JPEG."
    );
  });
});

describe("recognizePlate", () => {
  test("10. A plate-only GBG 1234M upload prioritises the whole-image single-line pass", async () => {
    recognize.mockResolvedValue(ocr("GBG 1234 M", 95));
    const res = await recognizePlate(plateOnlySource);

    expect(res.normalized).toBe("GBG1234M");
    expect(res.readable).toBe(true);
    expect(res.raw).toBe("GBG 1234 M");
    expect(res.confidence).toBe(95);
    expect(recognize).toHaveBeenCalledTimes(1); // single pass succeeded
    expect(setParameters).toHaveBeenCalledWith({
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
      tessedit_pageseg_mode: "7",
    });
  });

  test("11. GBG 1234M normalises to GBG1234M", async () => {
    recognize.mockResolvedValue(ocr("GBG  1234  M", 88));
    const res = await recognizePlate(plateOnlySource);
    expect(res.normalized).toBe("GBG1234M");
  });

  test("12. A plate-only wide image is not incorrectly lower-centre cropped", async () => {
    recognize.mockResolvedValue(ocr("YWERETANCLPPEMYY", 10)); // noise
    const res = await recognizePlate(plateOnlySource); // aspect ratio 300/80 = 3.75 >= 2.2

    expect(res.normalized).toBe("");
    expect(res.readable).toBe(false);
    // At most 2 passes run for a wide image (pass 1 and pass 2 whole image), pass 3 (lower-centre crop) skipped!
    expect(recognize.mock.calls.length).toBeLessThanOrEqual(2);
  });

  test("13. A wider full-car image may use the bounded crop fallback", async () => {
    recognize
      .mockResolvedValueOnce(ocr("CAR FRONT", 20))         // pass 1 whole image
      .mockResolvedValueOnce(ocr("CAR FRONT HIGHER", 25))  // pass 2 whole image contrast
      .mockResolvedValueOnce(ocr("GBG 1234 M", 90));       // pass 3 lower-centre crop

    const res = await recognizePlate(fullCarSource); // aspect ratio 600/400 = 1.5 < 2.2
    expect(res.normalized).toBe("GBG1234M");
    expect(res.readable).toBe(true);
    expect(recognize).toHaveBeenCalledTimes(3); // 3 passes total
  });

  test("14. At most three OCR passes occur for uploaded images", async () => {
    recognize.mockResolvedValue(ocr("YWERETANCLPPEMYY", 10));
    const res = await recognizePlate(fullCarSource);
    expect(res.readable).toBe(false);
    expect(recognize.mock.calls.length).toBeLessThanOrEqual(3); // at most 3
  });

  test("15. Noise remains OCR_UNREADABLE", async () => {
    recognize.mockResolvedValue(ocr("YWERETANCLPPEMYY", 12));
    const res = await recognizePlate(fullCarSource);
    expect(res.normalized).toBe("");
    expect(res.readable).toBe(false);
    expect(res.raw).toBe("YWERETANCLPPEMYY");
  });

  test("16. Ambiguous candidates remain OCR_UNREADABLE", async () => {
    recognize.mockResolvedValue(ocr("SSSA", 30));
    const res = await recognizePlate(fullCarSource);
    expect(res.normalized).toBe("");
    expect(res.readable).toBe(false);
  });

  test("17. The booking's expected plate is never passed into OCR extraction", async () => {
    recognize.mockResolvedValue(ocr("GBG 1234 M", 90));
    // recognizePlate takes only source and optional crop options — never any booking reference or expected plate
    const res = await recognizePlate(plateOnlySource);
    expect(res.normalized).toBe("GBG1234M");
  });
});
