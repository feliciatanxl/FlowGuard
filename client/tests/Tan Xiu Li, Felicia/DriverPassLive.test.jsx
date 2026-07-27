// Frontend tests — the public Driver Pass stays live: Singapore slot display,
// no-store fetch, and background refresh on window focus (status/slot update)
// without flickering the QR, with clean teardown on unmount.
import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { vi, describe, test, expect, afterEach } from "vitest";

import DriverPass from "../../src/pages/DriverPass";

const renderPass = (ref = "FG-LIVE") =>
  render(
    <MemoryRouter initialEntries={[`/driver-pass/${ref}`]}>
      <Routes>
        <Route path="/driver-pass/:ref" element={<DriverPass />} />
      </Routes>
    </MemoryRouter>
  );

const okJson = (body) => ({ ok: true, status: 200, json: () => Promise.resolve(body) });

afterEach(() => { vi.restoreAllMocks(); delete global.fetch; });

describe("DriverPass — live refresh", () => {
  test("shows the slot in Singapore time (27 Jul 2026, not 28 Jul)", async () => {
    global.fetch = vi.fn(() => Promise.resolve(okJson({
      booking_ref: "FG-LIVE", transport_company: "NinjaVan", license_plate: "GBG 1234M",
      loading_bay: "Bay A", status: "Confirmed",
      slot_start: "2026-07-27T10:01:00.000Z", slot_end: "2026-07-27T10:03:00.000Z",
    })));

    renderPass();
    await screen.findByText("FG-LIVE");
    expect(screen.getByText(/27 Jul 2026, 6:01 PM/)).toBeTruthy();
    expect(screen.queryByText(/28 Jul 2026/)).toBeNull();
  });

  test("fetches with cache: 'no-store'", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(okJson({
      booking_ref: "FG-NS", loading_bay: "Bay A", status: "Pending",
    })));
    global.fetch = fetchMock;

    renderPass("FG-NS");
    await screen.findByText("FG-NS");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/bookings/FG-NS"),
      { cache: "no-store" }
    );
  });

  test("status changes Pending → Cancelled on a focus refresh (no manual reload)", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okJson({
        booking_ref: "FG-LIVE", loading_bay: "Bay A", license_plate: "P1", status: "Pending",
        slot_start: "2026-07-27T10:01:00.000Z",
      }))
      .mockResolvedValueOnce(okJson({
        booking_ref: "FG-LIVE", loading_bay: "Bay A", license_plate: "P1", status: "Cancelled",
        slot_start: "2026-07-27T10:01:00.000Z",
      }));
    global.fetch = fetchMock;

    renderPass();
    // Initial state — Pending, no cancellation banner.
    await screen.findByText("Pending");
    expect(screen.queryByText(/has been CANCELLED/i)).toBeNull();

    // Driver returns to the tab → background refresh picks up the cancellation.
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await screen.findByText(/has been CANCELLED/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("a background refresh does NOT recreate/flicker the QR", async () => {
    global.fetch = vi.fn(() => Promise.resolve(okJson({
      booking_ref: "FG-QR", loading_bay: "Bay A", license_plate: "P1", status: "Pending",
      slot_start: "2026-07-27T10:01:00.000Z",
    })));

    const { container } = renderPass("FG-QR");
    await screen.findByText("FG-QR");
    const svgBefore = container.querySelector("svg");
    expect(svgBefore).toBeTruthy();

    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));

    // Same DOM node — the QR was not remounted (booking_ref unchanged).
    expect(container.querySelector("svg")).toBe(svgBefore);
  });

  test("cleans up the interval and listeners on unmount", async () => {
    const windowRemoveSpy = vi.spyOn(window, "removeEventListener");
    const documentRemoveSpy = vi.spyOn(document, "removeEventListener");
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    global.fetch = vi.fn(() => Promise.resolve(okJson({
      booking_ref: "FG-CU", loading_bay: "Bay A", status: "Pending",
    })));

    const { unmount } = renderPass("FG-CU");
    await screen.findByText("FG-CU");

    unmount();
    expect(clearSpy).toHaveBeenCalled();
    expect(windowRemoveSpy).toHaveBeenCalledWith("focus", expect.any(Function));
    expect(documentRemoveSpy).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  });
});
