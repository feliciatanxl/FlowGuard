// Frontend unit tests — shared camera-source abstraction (Phase 1).
// Source vocabulary, consistent "Raspberry Pi Camera Module 3" labelling,
// standardised webcam constraints, and safe stream start/stop.
import { describe, test, expect, vi, afterEach } from "vitest";

import {
  CAMERA_SOURCE,
  SOURCE_STATE,
  SOURCE_LABELS,
  sourceLabel,
  FALLBACK_REASON,
  fallbackMessage,
  isPiConfigured,
  QR_WEBCAM_CONSTRAINTS,
  FACE_WEBCAM_CONSTRAINTS,
  isSecureCameraContext,
  isCameraSupported,
  mapGetUserMediaError,
  stopStream,
  startWebcamStream,
} from "../../src/utils/cameraSource";

afterEach(() => {
  vi.unstubAllGlobals();
  try { delete navigator.mediaDevices; } catch { /* ignore */ }
});

describe("source vocabulary + labels", () => {
  test("exposes the four frame sources", () => {
    expect(CAMERA_SOURCE.PI).toBe("pi");
    expect(CAMERA_SOURCE.WEBCAM).toBe("webcam");
    expect(CAMERA_SOURCE.UPLOAD).toBe("upload");
    expect(CAMERA_SOURCE.MANUAL).toBe("manual");
  });

  test("labels standardise the Raspberry Pi as Camera Module 3 (never Module 2)", () => {
    expect(SOURCE_LABELS.pi).toBe("Raspberry Pi Camera Module 3");
    expect(SOURCE_LABELS.webcam).toBe("Laptop Webcam");
    expect(SOURCE_LABELS.upload).toBe("Photo Upload");
    expect(SOURCE_LABELS.manual).toBe("Manual Entry");
    expect(SOURCE_LABELS.simulation).toBe("Simulation");
    expect(sourceLabel("pi")).toBe("Raspberry Pi Camera Module 3");
    // Guard against a regression to "Camera Module 2".
    expect(JSON.stringify(SOURCE_LABELS)).not.toMatch(/Module 2/);
  });

  test("covers the full source lifecycle vocabulary", () => {
    for (const s of [
      "checking", "available", "unavailable", "starting",
      "active", "stopped", "error", "fallback-active",
    ]) {
      expect(Object.values(SOURCE_STATE)).toContain(s);
    }
  });
});

describe("fallback reasons", () => {
  test("every reason maps to human copy", () => {
    for (const reason of Object.values(FALLBACK_REASON)) {
      expect(typeof fallbackMessage(reason)).toBe("string");
      expect(fallbackMessage(reason).length).toBeGreaterThan(0);
    }
  });

  test("Pi fallback copy names the Camera Module 3", () => {
    expect(fallbackMessage(FALLBACK_REASON.PI_UNREACHABLE)).toMatch(/Raspberry Pi Camera Module 3/);
  });
});

describe("isPiConfigured", () => {
  test("false when no runtime or environment Pi URL is configured", () => {
    expect(isPiConfigured()).toBe(false);
  });
});

describe("standardised webcam constraints (treated as preferences)", () => {
  test("QR constraints prefer 1280x720 @ 30 fps, environment camera, no audio", () => {
    expect(QR_WEBCAM_CONSTRAINTS.video.width.ideal).toBe(1280);
    expect(QR_WEBCAM_CONSTRAINTS.video.height.ideal).toBe(720);
    expect(QR_WEBCAM_CONSTRAINTS.video.frameRate.ideal).toBe(30);
    expect(QR_WEBCAM_CONSTRAINTS.video.frameRate.max).toBe(30);
    expect(QR_WEBCAM_CONSTRAINTS.video.facingMode.ideal).toBe("environment");
    expect(QR_WEBCAM_CONSTRAINTS.audio).toBe(false);
  });

  test("face constraints use the front (user) camera", () => {
    expect(FACE_WEBCAM_CONSTRAINTS.video.facingMode).toBe("user");
    expect(FACE_WEBCAM_CONSTRAINTS.audio).toBe(false);
  });
});

describe("error mapping", () => {
  test("permission errors map to a coded 'permission' error", () => {
    expect(mapGetUserMediaError({ name: "NotAllowedError" }).code).toBe("permission");
    expect(mapGetUserMediaError({ name: "NotFoundError" }).code).toBe("no-camera");
    expect(mapGetUserMediaError({ name: "NotReadableError" }).code).toBe("in-use");
    expect(mapGetUserMediaError({ name: "Whatever" }).code).toBe("unknown");
  });
});

describe("startWebcamStream + stopStream", () => {
  const fakeTrack = () => {
    const t = { stop: vi.fn(), getSettings: () => ({ width: 1280, height: 720, frameRate: 30, facingMode: "environment" }) };
    return t;
  };

  test("acquires a stream, attaches it to the video, and returns a working stop()", async () => {
    const track = fakeTrack();
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });

    const video = { srcObject: null, play: vi.fn().mockResolvedValue(undefined) };
    const handle = await startWebcamStream(video, QR_WEBCAM_CONSTRAINTS);

    expect(getUserMedia).toHaveBeenCalledWith(QR_WEBCAM_CONSTRAINTS);
    expect(video.srcObject).toBe(stream);
    expect(handle.settings.width).toBe(1280);

    handle.stop();
    expect(track.stop).toHaveBeenCalled();
    expect(video.srcObject).toBeNull();
  });

  test("maps a permission denial to a coded error", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(Object.assign(new Error("no"), { name: "NotAllowedError" }));
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    const video = { srcObject: null, play: vi.fn() };
    await expect(startWebcamStream(video)).rejects.toMatchObject({ code: "permission" });
  });

  test("maps missing and already-in-use cameras to distinct coded errors", async () => {
    const getUserMedia = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("missing"), { name: "NotFoundError" }))
      .mockRejectedValueOnce(Object.assign(new Error("busy"), { name: "NotReadableError" }));
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    const video = { srcObject: null, play: vi.fn() };

    await expect(startWebcamStream(video)).rejects.toMatchObject({ code: "no-camera" });
    await expect(startWebcamStream(video)).rejects.toMatchObject({ code: "in-use" });
  });

  test("stops a late getUserMedia result when its source request was aborted", async () => {
    let resolveStream;
    const streamPromise = new Promise((resolve) => { resolveStream = resolve; });
    const track = fakeTrack();
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
    const getUserMedia = vi.fn().mockReturnValue(streamPromise);
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    const video = { srcObject: null, play: vi.fn() };
    const controller = new AbortController();

    const pending = startWebcamStream(video, QR_WEBCAM_CONSTRAINTS, { signal: controller.signal });
    controller.abort();
    resolveStream(stream);

    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBeNull();
    expect(video.play).not.toHaveBeenCalled();
  });

  test("stopStream is null-safe and stops every track", () => {
    const track = fakeTrack();
    const video = { srcObject: { getTracks: () => [track] } };
    stopStream(video);
    expect(track.stop).toHaveBeenCalled();
    expect(video.srcObject).toBeNull();
    // No throw with nothing to stop.
    expect(() => stopStream(null)).not.toThrow();
  });
});

describe("context guards (jsdom localhost is a secure context)", () => {
  test("secure context + camera support detection", () => {
    expect(isSecureCameraContext()).toBe(true);
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: () => {} } });
    expect(isCameraSupported()).toBe(true);
  });
});
