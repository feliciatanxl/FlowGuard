// Frontend unit tests — the QR scanner service (Phase 2 + 5).
// Exercises the REAL startQrScan: BarcodeDetector-first decoding, ZXing
// fallback, cloud snapshot fallback, duplicate suppression, and full cleanup.
// @zxing/browser and BarcodeDetector are mocked so no real camera is needed.
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

const zx = vi.hoisted(() => ({ result: null, stop: vi.fn() }));
vi.mock("@zxing/browser", () => ({
  BrowserQRCodeReader: class {
    async decodeFromConstraints(_constraints, _video, cb) {
      if (zx.result) cb({ getText: () => zx.result });
      return { stop: zx.stop };
    }
  },
}));

import {
  startQrScan,
  preloadQrScanner,
  isBarcodeDetectorSupported,
  captureVideoFrameJpeg,
  SCANNER_STATE,
  DECODER_SOURCE,
} from "../../src/utils/gateCamera";

// A controllable fake BarcodeDetector: detectImpl() decides each frame's result.
let detectImpl = () => [];
class FakeBarcodeDetector {
  constructor(opts) { this.opts = opts; }
  async detect() { return detectImpl(); }
}

const fakeVideo = () => ({ videoWidth: 640, videoHeight: 480, srcObject: null, play: vi.fn().mockResolvedValue(undefined) });

const fakeStream = () => {
  const track = { stop: vi.fn(), getSettings: () => ({ deviceId: "cam-1", width: 1280, height: 720, frameRate: 30 }) };
  return { getTracks: () => [track], getVideoTracks: () => [track], _track: track };
};

const waitFor = async (assertion, timeout = 1500) => {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try { assertion(); return; } catch (e) {
      if (Date.now() - start > timeout) throw e;
      await new Promise((r) => setTimeout(r, 15));
    }
  }
};

let getUserMedia;

beforeEach(() => {
  zx.result = null;
  zx.stop.mockClear();
  detectImpl = () => [];
  getUserMedia = vi.fn().mockResolvedValue(fakeStream());
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  // Stub a working canvas for captureVideoFrameJpeg (jsdom has no 2D backend).
  vi.spyOn(document, "createElement").mockImplementation((tag) => {
    if (tag === "canvas") {
      return { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toDataURL: () => "data:image/jpeg;base64,ZmFrZQ==" };
    }
    return { tagName: tag };
  });
  window.BarcodeDetector = FakeBarcodeDetector;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.BarcodeDetector;
});

describe("decoder capability detection", () => {
  test("isBarcodeDetectorSupported reflects window.BarcodeDetector", () => {
    expect(isBarcodeDetectorSupported()).toBe(true);
    delete window.BarcodeDetector;
    expect(isBarcodeDetectorSupported()).toBe(false);
  });

  test("preloadQrScanner resolves without throwing", async () => {
    await expect(preloadQrScanner()).resolves.toBeDefined();
  });
});

describe("captureVideoFrameJpeg", () => {
  test("returns a JPEG data URL from a live frame, null when no frame", () => {
    expect(captureVideoFrameJpeg(fakeVideo())).toMatch(/^data:image\/jpeg/);
    expect(captureVideoFrameJpeg({ videoWidth: 0 })).toBeNull();
  });
});

describe("BarcodeDetector path", () => {
  test("decodes a valid FlowGuard ref and reports it via onResult", async () => {
    detectImpl = () => [{ rawValue: "FG-ABC123" }];
    const onResult = vi.fn();
    const stop = await startQrScan({ videoElement: fakeVideo(), onResult });
    await waitFor(() => expect(onResult).toHaveBeenCalledWith("FG-ABC123", expect.objectContaining({ decoder: DECODER_SOURCE.BARCODE_DETECTOR })));
    stop();
  });

  test("uses the standardised constraints and requests the webcam once", async () => {
    detectImpl = () => [{ rawValue: "FG-AAAA11" }];
    const onResult = vi.fn();
    const stop = await startQrScan({ videoElement: fakeVideo(), onResult });
    await waitFor(() => expect(onResult).toHaveBeenCalled());
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    const constraints = getUserMedia.mock.calls[0][0];
    expect(constraints.video.width.ideal).toBe(1280);
    expect(constraints.audio).toBe(false);
    stop();
  });

  test("an invalid QR sitting in frame is forwarded only ONCE (dedup), not every frame", async () => {
    let frames = 0;
    detectImpl = () => { frames += 1; return [{ rawValue: "not-a-flowguard-ref" }]; };
    const onResult = vi.fn();
    const stop = await startQrScan({ videoElement: fakeVideo(), onResult });
    await waitFor(() => expect(frames).toBeGreaterThan(3));
    stop();
    const invalidCalls = onResult.mock.calls.filter((c) => c[0] === "not-a-flowguard-ref");
    expect(invalidCalls.length).toBe(1);
  });

  test("stop() releases the camera track and halts scanning", async () => {
    const stream = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    detectImpl = () => [];
    const onResult = vi.fn();
    const stop = await startQrScan({ videoElement: fakeVideo(), onResult });
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    stop();
    expect(stream._track.stop).toHaveBeenCalled();
  });
});

describe("ZXing fallback (no BarcodeDetector)", () => {
  test("falls back to BrowserQRCodeReader and decodes", async () => {
    delete window.BarcodeDetector;
    zx.result = "FG-XYZ99";
    const onResult = vi.fn();
    const stop = await startQrScan({ videoElement: fakeVideo(), onResult });
    await waitFor(() => expect(onResult).toHaveBeenCalledWith("FG-XYZ99", expect.objectContaining({ decoder: DECODER_SOURCE.ZXING })));
    stop();
    expect(zx.stop).toHaveBeenCalled();
  });
});

describe("cloud snapshot fallback (Phase 5)", () => {
  test("activates after the local timeout and a valid cloud ref wins", async () => {
    detectImpl = () => []; // local never finds anything
    const onCloudDecode = vi.fn().mockResolvedValue("FG-CLOUD1");
    const onResult = vi.fn();
    const stop = await startQrScan({
      videoElement: fakeVideo(),
      onResult,
      enableCloud: true,
      cloudFallbackDelayMs: 30,
      onCloudDecode,
    });
    await waitFor(() => expect(onCloudDecode).toHaveBeenCalled(), 2000);
    await waitFor(() => expect(onResult).toHaveBeenCalledWith("FG-CLOUD1", expect.objectContaining({ decoder: DECODER_SOURCE.OPENCV_CLOUD })), 2000);
    stop();
  });

  test("no cloud requests are made when cloud fallback is disabled", async () => {
    detectImpl = () => [];
    const onCloudDecode = vi.fn().mockResolvedValue("FG-CLOUD1");
    const stop = await startQrScan({
      videoElement: fakeVideo(),
      onResult: vi.fn(),
      enableCloud: false,
      cloudFallbackDelayMs: 20,
      onCloudDecode,
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(onCloudDecode).not.toHaveBeenCalled();
    stop();
  });

  test("stop() cancels the cloud fallback loop", async () => {
    detectImpl = () => [];
    const onCloudDecode = vi.fn().mockResolvedValue(null);
    const stop = await startQrScan({
      videoElement: fakeVideo(),
      onResult: vi.fn(),
      enableCloud: true,
      cloudFallbackDelayMs: 20,
      onCloudDecode,
    });
    await waitFor(() => expect(onCloudDecode).toHaveBeenCalled(), 2000);
    stop();
    const callsAfterStop = onCloudDecode.mock.calls.length;
    await new Promise((r) => setTimeout(r, 250));
    expect(onCloudDecode.mock.calls.length).toBe(callsAfterStop);
  });
});

describe("start failure handling", () => {
  test("a getUserMedia permission denial surfaces a coded error, not a raw exception", async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    const onError = vi.fn();
    const onState = vi.fn();
    const stop = await startQrScan({ videoElement: fakeVideo(), onResult: vi.fn(), onError, onState });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "permission" }));
    expect(onState).toHaveBeenCalledWith(SCANNER_STATE.PERMISSION_DENIED);
    stop();
  });
});
