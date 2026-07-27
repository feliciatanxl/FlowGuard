// Frontend tests — FM-only Loading Bay Gate Verification page.
// Camera, QR and OCR are mocked at the util boundary so no physical camera is
// needed; axios is mocked so no server is hit.
import React from "react";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => {
  const store = { onResult: null, onError: null };
  const qrStop = vi.fn();
  const plateStop = vi.fn();
  return {
    store, qrStop, plateStop,
    startQrScan: vi.fn(async ({ onResult, onError }) => { store.onResult = onResult; store.onError = onError; return qrStop; }),
    startCamera: vi.fn(async () => ({ stop: plateStop })),
    recognizePlate: vi.fn(async () => ({ raw: "gbg 1234 m", normalized: "GBG1234M", confidence: 88 })),
    post: vi.fn(),
  };
});

vi.mock("axios", () => ({ default: { post: h.post } }));
vi.mock("../../src/components/Sidebar", () => ({ default: () => <div data-testid="sidebar" /> }));
vi.mock("../../src/utils/plateOcr", () => ({ recognizePlate: h.recognizePlate }));
vi.mock("../../src/utils/gateCamera", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    startQrScan: h.startQrScan,
    startCamera: h.startCamera,
    isSecureCameraContext: () => true,
    isCameraSupported: () => true,
  };
});

import GateVerification from "../../src/pages/GateVerification";

const renderPage = (role = "FM") => {
  localStorage.setItem("accessToken", "test-token");
  localStorage.setItem("userRole", role);
  return render(<MemoryRouter><GateVerification /></MemoryRouter>);
};

const clickStartQr = async () => {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Start QR Scanner/i })); });
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  h.store.onResult = null;
  h.store.onError = null;
  h.post.mockResolvedValue({ data: {} });
});

afterEach(cleanup);

describe("Access control", () => {
  test("1. Non-FM roles see a restricted message, FM sees the tool", () => {
    renderPage("Tenant");
    expect(screen.getByText(/restricted to Facilities Managers/i)).toBeTruthy();
    cleanup();
    renderPage("FM");
    expect(screen.getByRole("tab", { name: /Automatic Verification/i })).toBeTruthy();
  });
});

describe("Camera lifecycle", () => {
  test("2. camera does NOT start automatically on load", () => {
    renderPage();
    expect(h.startQrScan).not.toHaveBeenCalled();
    expect(h.startCamera).not.toHaveBeenCalled();
  });

  test("3. QR scanner starts only after the button is pressed", async () => {
    renderPage();
    expect(h.startQrScan).not.toHaveBeenCalled();
    await clickStartQr();
    expect(h.startQrScan).toHaveBeenCalledTimes(1);
  });

  test("6. camera tracks are released on Stop and on unmount", async () => {
    const { unmount } = renderPage();
    await clickStartQr();
    fireEvent.click(screen.getByRole("button", { name: /Stop Scanner/i }));
    expect(h.qrStop).toHaveBeenCalled();

    // And again if the page unmounts while scanning.
    h.qrStop.mockClear();
    await clickStartQr();
    unmount();
    expect(h.qrStop).toHaveBeenCalled();
  });

  test("7. a permission failure surfaces a message and manual mode stays available", async () => {
    h.startQrScan.mockImplementationOnce(async ({ onError }) => {
      onError({ code: "permission", message: "Camera permission was denied. Allow camera access or switch to manual verification." });
      return h.qrStop;
    });
    renderPage();
    await clickStartQr();
    expect(await screen.findByText(/permission was denied/i)).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Manual Verification/i })).toBeTruthy();
  });
});

describe("QR result handling", () => {
  test("4. a valid FlowGuard QR fills the booking reference", async () => {
    renderPage();
    await clickStartQr();
    act(() => { h.store.onResult("FG-ABC123"); });
    expect(screen.getByLabelText("Booking reference").value).toBe("FG-ABC123");
    expect(screen.getByText(/Booking reference set/i)).toBeTruthy();
  });

  test("5. an invalid QR is rejected and does not fill the reference", async () => {
    renderPage();
    await clickStartQr();
    act(() => { h.store.onResult("https://evil.example/pwn"); });
    expect(screen.getByLabelText("Booking reference").value).toBe("");
    expect(screen.getByText(/Unrecognised QR/i)).toBeTruthy();
  });
});

describe("PoC OCR", () => {
  test("8. OCR result is shown normalised with confidence", async () => {
    renderPage();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Start Camera/i })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Capture & Read Plate/i })); });
    expect(await screen.findByText("GBG1234M")).toBeTruthy(); // normalised
    expect(screen.getByText(/88%/)).toBeTruthy();             // confidence
    expect(h.recognizePlate).toHaveBeenCalled();
  });
});

describe("Decision states", () => {
  const gotoManualAndVerify = async (data, { ref = "FG-ABC123", plate = "GBG 1234M" } = {}) => {
    h.post.mockResolvedValueOnce({ data });
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: /Manual Verification/i }));
    fireEvent.change(screen.getByLabelText("Booking reference"), { target: { value: ref } });
    fireEvent.change(screen.getByLabelText("Observed vehicle plate"), { target: { value: plate } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Verify Entry/i })); });
  };

  test("9. a match shows the GRANTED state", async () => {
    await gotoManualAndVerify({
      access: "GRANTED", reasonCode: "VERIFIED", plateMatched: true,
      expectedPlate: "GBG1234M", observedPlate: "GBG1234M",
      manualReviewRequired: false, overrideUsed: false,
      booking: { booking_ref: "FG-ABC123", loading_bay: "Bay A", status: "Arrived" },
    });
    expect(await screen.findByText("ACCESS GRANTED")).toBeTruthy();
    expect(screen.getByText(/Match/)).toBeTruthy();
    expect(screen.getByText(/Proceed to Bay A/i)).toBeTruthy();
  });

  test("10. a mismatch shows DENIED + manual-review with an override box", async () => {
    await gotoManualAndVerify({
      access: "DENIED", reasonCode: "PLATE_MISMATCH", plateMatched: false,
      expectedPlate: "GBG1234M", observedPlate: "GBG9999Z", manualReviewRequired: true,
      booking: { booking_ref: "FG-ABC123", loading_bay: "Bay A", status: "Confirmed" },
    }, { plate: "GBG 9999Z" });
    expect(await screen.findByText("ACCESS DENIED")).toBeTruthy();
    expect(screen.getByText(/Manual verification required/i)).toBeTruthy();
    expect(screen.getByLabelText("Override reason")).toBeTruthy();
  });

  test("13. server reason codes drive the displayed copy (TOO_EARLY)", async () => {
    await gotoManualAndVerify({
      access: "DENIED", reasonCode: "TOO_EARLY", plateMatched: true,
      expectedPlate: "GBG1234M", observedPlate: "GBG1234M", manualReviewRequired: false,
      booking: { booking_ref: "FG-ABC123", loading_bay: "Bay A", status: "Confirmed" },
    });
    expect(await screen.findByText(/earlier than the approved arrival window/i)).toBeTruthy();
  });
});

describe("Manual mode + override", () => {
  test("11. the manual form posts the right payload", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: /Manual Verification/i }));
    fireEvent.change(screen.getByLabelText("Booking reference"), { target: { value: "FG-ABC123" } });
    fireEvent.change(screen.getByLabelText("Observed vehicle plate"), { target: { value: "gbg 1234 m" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Verify Entry/i })); });

    expect(h.post).toHaveBeenCalledTimes(1);
    const [url, payload] = h.post.mock.calls[0];
    expect(url).toMatch(/\/api\/bookings\/gate-verification$/);
    expect(payload).toEqual(expect.objectContaining({
      action: "entry", bookingRef: "FG-ABC123", observedPlate: "GBG1234M",
      verificationMode: "manual", plateSource: "manual", manualOverride: false,
    }));
  });

  test("12. override requires a reason before it re-submits", async () => {
    h.post.mockResolvedValueOnce({ data: {
      access: "DENIED", reasonCode: "PLATE_MISMATCH", plateMatched: false,
      expectedPlate: "GBG1234M", observedPlate: "GBG9999Z", manualReviewRequired: true,
      booking: { booking_ref: "FG-ABC123", loading_bay: "Bay A", status: "Confirmed" },
    } });
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: /Manual Verification/i }));
    fireEvent.change(screen.getByLabelText("Booking reference"), { target: { value: "FG-ABC123" } });
    fireEvent.change(screen.getByLabelText("Observed vehicle plate"), { target: { value: "GBG 9999Z" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Verify Entry/i })); });
    await screen.findByText("ACCESS DENIED");
    expect(h.post).toHaveBeenCalledTimes(1);

    // Empty reason → blocked, no second request.
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Authorise Manual Override/i })); });
    expect(screen.getByText(/reason is required/i)).toBeTruthy();
    expect(h.post).toHaveBeenCalledTimes(1);

    // With a reason → re-submits with the override flag.
    h.post.mockResolvedValueOnce({ data: {
      access: "GRANTED", reasonCode: "VERIFIED", overrideUsed: true, plateMatched: false,
      expectedPlate: "GBG1234M", observedPlate: "GBG9999Z", manualReviewRequired: false,
      booking: { booking_ref: "FG-ABC123", loading_bay: "Bay A", status: "Arrived" },
    } });
    fireEvent.change(screen.getByLabelText("Override reason"), { target: { value: "Plate obscured by mud; visual ID confirmed" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Authorise Manual Override/i })); });

    expect(h.post).toHaveBeenCalledTimes(2);
    const lastPayload = h.post.mock.calls[1][1];
    expect(lastPayload).toEqual(expect.objectContaining({
      manualOverride: true, overrideReason: "Plate obscured by mud; visual ID confirmed", verificationMode: "manual",
    }));
    expect(await screen.findByText("ACCESS GRANTED — MANUAL OVERRIDE")).toBeTruthy();
  });
});

describe("No image persistence", () => {
  test("14. capturing + verifying never writes images to localStorage/sessionStorage", async () => {
    h.post.mockResolvedValueOnce({ data: {
      access: "GRANTED", reasonCode: "VERIFIED", plateMatched: true,
      expectedPlate: "GBG1234M", observedPlate: "GBG1234M", manualReviewRequired: false,
      booking: { booking_ref: "FG-ABC123", loading_bay: "Bay A", status: "Arrived" },
    } });
    renderPage();
    // Run an OCR capture...
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Start Camera/i })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Capture & Read Plate/i })); });
    await screen.findByText("GBG1234M");
    // ...set a reference and verify.
    fireEvent.change(screen.getByLabelText("Booking reference"), { target: { value: "FG-ABC123" } });
    fireEvent.click(screen.getByRole("button", { name: /Use reference/i }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Verify Entry/i })); });
    await screen.findByText("ACCESS GRANTED");

    // sessionStorage is untouched; localStorage holds only the auth keys the test set.
    expect(sessionStorage.length).toBe(0);
    expect(new Set(Object.keys(localStorage))).toEqual(new Set(["accessToken", "userRole"]));
    const blob = JSON.stringify(localStorage) + JSON.stringify(sessionStorage);
    expect(blob.toLowerCase()).not.toContain("data:image");
    expect(blob.toLowerCase()).not.toContain("base64");
  });
});
