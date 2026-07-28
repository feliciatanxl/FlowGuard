// Frontend tests — Gate Verification camera sources + cloud QR fallback (Phase 6).
// Additive to the existing GateVerification suite: the webcam path wires the
// cloud snapshot fallback, and a Raspberry Pi Camera Module 3 source decodes a
// snapshot via the Node /api/qr/decode proxy. Utils are mocked at the boundary.
import React from "react";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  startQrScan: vi.fn(async () => vi.fn()),
  startCamera: vi.fn(async () => ({ stop: vi.fn() })),
  preloadQrScanner: vi.fn(() => Promise.resolve(true)),
  fetchPiSnapshotBitmap: vi.fn(),
  post: vi.fn(),
}));

vi.mock("axios", () => ({ default: { post: h.post } }));
vi.mock("../../src/components/Sidebar", () => ({ default: () => <div data-testid="sidebar" /> }));
vi.mock("../../src/utils/plateOcr", () => ({ recognizePlate: vi.fn() }));
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
  return { ...actual, fetchPiSnapshotBitmap: h.fetchPiSnapshotBitmap, isPiConfigured: () => true };
});

import GateVerification from "../../src/pages/GateVerification";
import { SOURCE_LABELS } from "../../src/utils/cameraSource";

const renderPage = () => {
  localStorage.setItem("accessToken", "test-token");
  localStorage.setItem("userRole", "FM");
  return render(<MemoryRouter><GateVerification /></MemoryRouter>);
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  h.post.mockResolvedValue({ data: {} });
});
afterEach(cleanup);

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
});
