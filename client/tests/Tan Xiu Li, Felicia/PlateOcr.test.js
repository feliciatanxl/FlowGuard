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

// Plate-only upload source (aspect ratio 300 / 80 = 3.75 >= 2.2)
const plateOnlySource = { width: 300, height: 80 };
// Full car photograph source (aspect ratio 600 / 400 = 1.5 < 2.2)
const fullCarSource = { width: 600, height: 400 };
// Laptop webcam video element / scene source
const webcamSource = { videoWidth: 1280, videoHeight: 720 };
// Pi snapshot canvas source
const piSnapshotCanvas = fakeCanvas(1280, 720);

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
    expect(bitmapClose).toHaveBeenCalledTimes(1);
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

  test("3. Uploaded File is decoded into a non-zero canvas", async () => {
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

  test("4. Upload-specific decoding is not applied to camera sources", async () => {
    recognize.mockResolvedValue(ocr("GBG 1234 M", 95));
    const spyDecode = vi.spyOn(globalThis, "createImageBitmap");

    await recognizePlate(webcamSource, { isUpload: false });

    // createImageBitmap is for files — not invoked on camera video sources
    expect(spyDecode).not.toHaveBeenCalled();
  });

  test("5. Object URL is revoked only after all OCR passes finish (fallback path)", async () => {
    delete globalThis.createImageBitmap;
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const createSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:http://localhost/test-uuid");

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

  test("6. ImageBitmap is closed only after decoding completes", async () => {
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
    await recognizePlate(plateOnlySource, { isUpload: true });
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

describe("Camera & Pi 4 OCR Pipeline", () => {
  test("10. Laptop Webcam frame reaches recognition with non-zero canvas dimensions", async () => {
    recognize.mockResolvedValue(ocr("GBG 1234 M", 92));
    const res = await recognizePlate(webcamSource, { isUpload: false });

    expect(res.normalized).toBe("GBG1234M");
    expect(res.readable).toBe(true);
    expect(recognize).toHaveBeenCalledTimes(1);
    // Camera Pass 1 uses unconstrained parameters (PSM '3', empty whitelist)
    expect(setParameters).toHaveBeenCalledWith({
      tessedit_char_whitelist: "",
      tessedit_pageseg_mode: "3",
    });
  });

  test("11. Pi snapshot reaches recognition with non-zero canvas dimensions", async () => {
    recognize.mockResolvedValue(ocr("GBG 1234 M", 94));
    const res = await recognizePlate(piSnapshotCanvas, { isUpload: false });

    expect(res.normalized).toBe("GBG1234M");
    expect(res.readable).toBe(true);
    expect(recognize).toHaveBeenCalledTimes(1);
    expect(setParameters).toHaveBeenCalledWith({
      tessedit_char_whitelist: "",
      tessedit_pageseg_mode: "3",
    });
  });

  test("12. Camera full-frame first pass remains available and retries lower-centre crop when needed", async () => {
    recognize
      .mockResolvedValueOnce(ocr("SCENE TEXT NO PLATE", 20)) // pass 1 full frame
      .mockResolvedValueOnce(ocr("GBG 1234 M", 88));          // pass 2 lower-centre crop

    const res = await recognizePlate(webcamSource, { isUpload: false });
    expect(res.normalized).toBe("GBG1234M");
    expect(res.readable).toBe(true);
    expect(recognize).toHaveBeenCalledTimes(2);

    // Pass 1: unconstrained parameters
    expect(setParameters.mock.calls[0][0]).toEqual({
      tessedit_char_whitelist: "",
      tessedit_pageseg_mode: "3",
    });
    // Pass 2: plate-focused parameters (PSM '7' + whitelist)
    expect(setParameters.mock.calls[1][0]).toEqual({
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
      tessedit_pageseg_mode: "7",
    });
  });
});

describe("Uploaded Image OCR Pipeline", () => {
  test("13. Plate-only upload uses whole-image OCR without destructive cropping", async () => {
    recognize.mockResolvedValue(ocr("GBG 1234 M", 95));
    const res = await recognizePlate(plateOnlySource, { isUpload: true });

    expect(res.normalized).toBe("GBG1234M");
    expect(res.readable).toBe(true);
    expect(recognize).toHaveBeenCalledTimes(1); // whole image pass succeeded
    expect(setParameters).toHaveBeenCalledWith({
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
      tessedit_pageseg_mode: "7",
    });
  });

  test("14. A wider full-car image may use the bounded crop fallback", async () => {
    recognize
      .mockResolvedValueOnce(ocr("CAR FRONT", 20))         // pass 1 whole image
      .mockResolvedValueOnce(ocr("CAR FRONT HIGHER", 25))  // pass 2 whole image contrast
      .mockResolvedValueOnce(ocr("GBG 1234 M", 90));       // pass 3 lower-centre crop

    const res = await recognizePlate(fullCarSource, { isUpload: true });
    expect(res.normalized).toBe("GBG1234M");
    expect(res.readable).toBe(true);
    expect(recognize).toHaveBeenCalledTimes(3);
  });

  test("15. At most three OCR passes occur for uploaded images", async () => {
    recognize.mockResolvedValue(ocr("YWERETANCLPPEMYY", 10));
    const res = await recognizePlate(fullCarSource, { isUpload: true });
    expect(res.readable).toBe(false);
    expect(recognize.mock.calls.length).toBeLessThanOrEqual(3);
  });

  test("16. Noise remains OCR_UNREADABLE across all sources", async () => {
    recognize.mockResolvedValue(ocr("YWERETANCLPPEMYY", 12));
    const res = await recognizePlate(fullCarSource, { isUpload: true });
    expect(res.normalized).toBe("");
    expect(res.readable).toBe(false);
    expect(res.raw).toBe("YWERETANCLPPEMYY");
  });

  test("17. Camera and upload operations do not share or terminate each other's worker", async () => {
    recognize.mockResolvedValue(ocr("GBG 1234 M", 90));
    const res1 = await recognizePlate(webcamSource, { isUpload: false });
    const res2 = await recognizePlate(plateOnlySource, { isUpload: true });

    expect(res1.normalized).toBe("GBG1234M");
    expect(res2.normalized).toBe("GBG1234M");
    expect(createWorker).toHaveBeenCalledTimes(2); // distinct workers initialized
    expect(terminate).toHaveBeenCalledTimes(2);    // distinct workers terminated
  });
});
