// Frontend test — the Gate Verification decision panel shows the booking slot
// in Singapore time, consistent with the Logistics table and Driver Pass.
import React from "react";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("axios", () => ({ default: { post: h.post } }));
vi.mock("../../src/components/Sidebar", () => ({ default: () => <div data-testid="sidebar" /> }));
vi.mock("../../src/utils/plateOcr", () => ({ recognizePlate: vi.fn() }));
vi.mock("../../src/utils/gateCamera", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, startQrScan: vi.fn(), startCamera: vi.fn(), isSecureCameraContext: () => true, isCameraSupported: () => true };
});

import GateVerification from "../../src/pages/GateVerification";

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem("accessToken", "test-token");
  localStorage.setItem("userRole", "FM");
});
afterEach(cleanup);

describe("Gate Verification slot display", () => {
  test("booking summary renders the slot in Singapore time (27 Jul, 6:01 PM)", async () => {
    h.post.mockResolvedValue({ data: {
      access: "GRANTED", reasonCode: "VERIFIED",
      expectedPlate: "GBG1234M", observedPlate: "GBG1234M", plateMatched: true,
      booking: {
        booking_ref: "FG-052B13", transport_company: "NinjaVan", driver_name: "Ahmad",
        loading_bay: "Bay A", status: "Confirmed", slot_start: "2026-07-27T10:01:00.000Z",
      },
    }});

    render(<MemoryRouter><GateVerification /></MemoryRouter>);

    // Manual tab → type a valid booking ref + plate → verify.
    fireEvent.click(screen.getByRole("tab", { name: /Manual Verification/i }));
    fireEvent.change(screen.getByLabelText(/Booking reference/i), { target: { value: "FG-052B13" } });
    fireEvent.change(screen.getByLabelText(/Observed vehicle plate/i), { target: { value: "GBG 1234M" } });

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Verify Entry/i })); });

    await waitFor(() => expect(h.post).toHaveBeenCalled());
    expect(await screen.findByText(/27 Jul 2026, 6:01 PM/)).toBeTruthy();
    expect(screen.queryByText(/28 Jul 2026/)).toBeNull();
  });
});
