// Frontend tests — Gate Verification camera sources + cloud QR fallback (Phase 6).
// Additive to the existing GateVerification suite: the webcam path wires the
// cloud snapshot fallback, and a Raspberry Pi Camera Module 3 source decodes a
// snapshot via the Node /api/qr/decode proxy. Utils are mocked at the boundary.
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  startQrScan: vi.fn(async () => vi.fn()),
  startCamera: vi.fn(async () => ({ stop: vi.fn() })),
  preloadQrScanner: vi.fn(() => Promise.resolve(true)),
  fetchPiSnapshotBitmap: vi.fn(),
  recognizePlate: vi.fn(),
  post: vi.fn(),
}));

vi.mock("axios", () => ({ default: { post: h.post } }));
vi.mock("../../src/components/Sidebar", () => ({ default: () => <div data-testid="sidebar" /> }));
vi.mock("../../src/utils/plateOcr", () => ({ recognizePlate: h.recognizePlate }));
vi.mock("../../src/utils/gateCamera", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    startQrScan: h.startQrScan,
    startCamera: h.startCamera,
    preloadQrScanner: h.preloadQrScanner,
    isSecureCameraContext: () => true,
    isCameraSupported: () => true,
  };
});
vi.mock("../../src/utils/cameraSource", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    PI_CAMERA_STREAM_URL: "http://pi.test:8081/video_feed",
    fetchPiSnapshotBitmap: h.fetchPiSnapshotBitmap,
    isPiConfigured: () => true,
  };
});

import GateVerification from "../../src/pages/GateVerification";
import { SOURCE_LABELS } from "../../src/utils/cameraSource";

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

const renderPage = () => {
  localStorage.setItem("accessToken", "test-token");
  localStorage.setItem("userRole", "FM");
  return render(<MemoryRouter><GateVerification /></MemoryRouter>);
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  h.post.mockResolvedValue({ data: {} });
  h.recognizePlate.mockResolvedValue({ raw: "GBG 1234 M", normalized: "GBG1234M", confidence: 88 });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("camera-source selector", () => {
  test("offers Laptop Webcam and Raspberry Pi Camera Module 3", () => {
    renderPage();
    expect(screen.getByRole("button", { name: SOURCE_LABELS.webcam })).toBeTruthy();
    expect(screen.getByRole("button", { name: SOURCE_LABELS.pi })).toBeTruthy();
    // Default source is the webcam → the Start QR Scanner control is shown.
    expect(screen.getByRole("button", { name: /Start QR Scanner/i })).toBeTruthy();
  });

  test("preloads the scanner module on mount (no camera opened)", () => {
    renderPage();
    expect(h.preloadQrScanner).toHaveBeenCalled();
    expect(h.startQrScan).not.toHaveBeenCalled();
    expect(h.startCamera).not.toHaveBeenCalled();
  });
});

describe("webcam path wires the cloud fallback", () => {
  test("Start QR Scanner passes enableCloud + onCloudDecode to the scanner", async () => {
    renderPage();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Start QR Scanner/i })); });
    expect(h.startQrScan).toHaveBeenCalledTimes(1);
    expect(h.startQrScan).toHaveBeenCalledWith(expect.objectContaining({
      enableCloud: true,
      cloudFallbackDelayMs: expect.any(Number),
      onCloudDecode: expect.any(Function),
    }));
  });

  test("repeated pending QR starts create only one scanner stream", async () => {
    const pending = deferred();
    h.startQrScan.mockReturnValueOnce(pending.promise);
    renderPage();
    const start = screen.getByRole("button", { name: /Start QR Scanner/i });

    act(() => {
      fireEvent.click(start);
      fireEvent.click(start);
    });
    expect(h.startQrScan).toHaveBeenCalledTimes(1);

    await act(async () => { pending.resolve(vi.fn()); await pending.promise; });
  });

  test("QR and plate startup cannot overlap while QR permission is pending", async () => {
    const pending = deferred();
    h.startQrScan.mockReturnValueOnce(pending.promise);
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /Start QR Scanner/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Start Camera$/i }));
    expect(h.startQrScan).toHaveBeenCalledTimes(1);
    expect(h.startCamera).not.toHaveBeenCalled();

    await act(async () => { pending.resolve(vi.fn()); await pending.promise; });
  });

  test("source switch during a pending QR start aborts and stops the late stream", async () => {
    const pending = deferred();
    const lateTrackStop = vi.fn();
    let startSignal;
    h.startQrScan.mockImplementationOnce(({ signal }) => {
      startSignal = signal;
      return pending.promise;
    });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /Start QR Scanner/i }));
    fireEvent.click(screen.getByRole("button", { name: SOURCE_LABELS.pi }));
    expect(startSignal.aborted).toBe(true);

    await act(async () => {
      pending.resolve(() => lateTrackStop());
      await pending.promise;
    });
    expect(lateTrackStop).toHaveBeenCalledTimes(1);
  });

  test("unmount during a pending QR start aborts and stops the late stream", async () => {
    const pending = deferred();
    const lateTrackStop = vi.fn();
    let startSignal;
    h.startQrScan.mockImplementationOnce(({ signal }) => {
      startSignal = signal;
      return pending.promise;
    });
    const { unmount } = renderPage();

    fireEvent.click(screen.getByRole("button", { name: /Start QR Scanner/i }));
    unmount();
    expect(startSignal.aborted).toBe(true);

    await act(async () => {
      pending.resolve(() => lateTrackStop());
      await pending.promise;
    });
    expect(lateTrackStop).toHaveBeenCalledTimes(1);
  });

  test("unmount after QR startup stops the active scanner stream", async () => {
    const stopActiveStream = vi.fn();
    h.startQrScan.mockResolvedValueOnce(stopActiveStream);
    const { unmount } = renderPage();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Start QR Scanner/i }));
    });
    expect(stopActiveStream).not.toHaveBeenCalled();

    unmount();
    expect(stopActiveStream).toHaveBeenCalledTimes(1);
  });
});

describe("Raspberry Pi Camera Module 3 snapshot path", () => {
  test("captures a Pi snapshot, decodes it via /api/qr/decode, and fills the reference", async () => {
    // Fake Pi bitmap + a working canvas (jsdom has no 2D backend).
    h.fetchPiSnapshotBitmap.mockResolvedValue({ width: 200, height: 150, close: vi.fn() });
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag) =>
      tag === "canvas"
        ? { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toDataURL: () => "data:image/jpeg;base64,UGk=" }
        : realCreate(tag)
    );
    h.post.mockResolvedValue({ data: { success: true, bookingRef: "FG-PI0001", decoder: "opencv-cloud" } });

    renderPage();
    // Switch source to the Pi.
    fireEvent.click(screen.getByRole("button", { name: SOURCE_LABELS.pi }));
    const capture = screen.getByRole("button", { name: /Capture QR from Raspberry Pi Camera Module 3/i });
    await act(async () => { fireEvent.click(capture); });

    expect(h.fetchPiSnapshotBitmap).toHaveBeenCalled();
    const [url, payload] = h.post.mock.calls[0];
    expect(url).toMatch(/\/api\/qr\/decode$/);
    expect(payload.image).toMatch(/^data:image\/jpeg/);
    expect(screen.getByLabelText("Booking reference").value).toBe("FG-PI0001");
    expect(screen.getByText(/Booking reference set/i)).toBeTruthy();
  });

  test("falls back to the webcam when the Pi snapshot is unreachable", async () => {
    h.fetchPiSnapshotBitmap.mockRejectedValue(new Error("pi offline"));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: SOURCE_LABELS.pi }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Capture QR from Raspberry Pi Camera Module 3/i })); });
    // Reverted to the webcam source → Start QR Scanner is back, and a friendly
    // (non-exception) message is shown.
    expect(screen.getByRole("button", { name: /Start QR Scanner/i })).toBeTruthy();
    expect(screen.getByText(/Raspberry Pi Camera Module 3 is unreachable/i)).toBeTruthy();
  });

  test("distinguishes local-network permission from an unreachable Pi", async () => {
    h.fetchPiSnapshotBitmap.mockRejectedValue(
      Object.assign(new Error("browser blocked private network access"), { code: "permission-required" })
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: SOURCE_LABELS.pi }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Capture QR from Raspberry Pi Camera Module 3/i }));
    });

    expect(screen.getAllByText(/Local-network permission/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/browser blocked private network access/i)).toBeNull();
  });

  test("a stale Pi decode result cannot update the selected source or booking", async () => {
    const close = vi.fn();
    const decode = deferred();
    h.fetchPiSnapshotBitmap.mockResolvedValue({ width: 200, height: 150, close });
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag) =>
      tag === "canvas"
        ? { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toDataURL: () => "data:image/jpeg;base64,UGk=" }
        : realCreate(tag)
    );
    h.post.mockReturnValueOnce(decode.promise);
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: SOURCE_LABELS.pi }));
    fireEvent.click(screen.getByRole("button", { name: /Capture QR from Raspberry Pi Camera Module 3/i }));
    await act(async () => { await Promise.resolve(); });
    expect(h.post).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: SOURCE_LABELS.webcam }));

    await act(async () => {
      decode.resolve({ data: { success: true, bookingRef: "FG-STALE1" } });
      await decode.promise;
    });
    expect(close).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Booking reference").value).toBe("");
    expect(h.startQrScan).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Stop Scanner/i })).toBeTruthy();
  });

  test("a stale pending Pi snapshot is closed without starting decode", async () => {
    const snapshot = deferred();
    const close = vi.fn();
    h.fetchPiSnapshotBitmap.mockReturnValueOnce(snapshot.promise);
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag) =>
      tag === "canvas"
        ? { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toDataURL: () => "data:image/jpeg;base64,UGk=" }
        : realCreate(tag)
    );
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: SOURCE_LABELS.pi }));
    fireEvent.click(screen.getByRole("button", { name: /Capture QR from Raspberry Pi Camera Module 3/i }));
    const snapshotSignal = h.fetchPiSnapshotBitmap.mock.calls[0][0].signal;
    expect(snapshotSignal.aborted).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: SOURCE_LABELS.webcam }));
    expect(snapshotSignal.aborted).toBe(true);

    await act(async () => {
      snapshot.resolve({ width: 200, height: 150, close });
      await snapshot.promise;
    });
    expect(close).toHaveBeenCalledTimes(1);
    expect(h.post).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Booking reference").value).toBe("");
  });

  test("unmount aborts an active Pi snapshot and removes the MJPEG preview", async () => {
    const snapshot = deferred();
    h.fetchPiSnapshotBitmap.mockReturnValueOnce(snapshot.promise);
    const { unmount } = renderPage();

    fireEvent.click(screen.getByRole("button", { name: SOURCE_LABELS.pi }));
    expect(screen.getByAltText(/Raspberry Pi Camera Module 3 live preview/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Capture QR from Raspberry Pi Camera Module 3/i }));
    const snapshotSignal = h.fetchPiSnapshotBitmap.mock.calls[0][0].signal;
    unmount();

    expect(snapshotSignal.aborted).toBe(true);
    expect(screen.queryByAltText(/Raspberry Pi Camera Module 3 live preview/i)).toBeNull();

    await act(async () => {
      snapshot.resolve({ width: 200, height: 150, close: vi.fn() });
      await snapshot.promise;
    });
  });

  test("switching from Pi removes the MJPEG preview source", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: SOURCE_LABELS.pi }));
    expect(screen.getByAltText(/Raspberry Pi Camera Module 3 live preview/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: SOURCE_LABELS.webcam }));
    expect(screen.queryByAltText(/Raspberry Pi Camera Module 3 live preview/i)).toBeNull();
  });

  test("Pi plate bitmap closes even when OCR throws", async () => {
    const close = vi.fn();
    h.fetchPiSnapshotBitmap.mockResolvedValue({ width: 200, height: 150, close });
    h.recognizePlate.mockRejectedValueOnce(new Error("OCR failed safely"));
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag) =>
      tag === "canvas"
        ? { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }) }
        : realCreate(tag)
    );
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /Plate camera source: Raspberry Pi Camera Module 3/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Capture Plate from Raspberry Pi Camera Module 3/i }));
    });

    expect(close).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/OCR failed safely/i)).toBeTruthy();
  });
});
