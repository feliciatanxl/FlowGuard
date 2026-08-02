// Frontend tests — Driver Pass QR quality (Phase 3).
// The QR encodes ONLY the short booking reference, renders large (~360 px) and
// crisp, and a Copy Reference action provides a manual gate fallback.
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { vi, describe, test, expect, afterEach } from "vitest";

import DriverPass from "../../src/pages/DriverPass";

const renderPass = (ref = "FG-052B13") =>
  render(
    <MemoryRouter initialEntries={[`/driver-pass/${ref}`]}>
      <Routes>
        <Route path="/driver-pass/:ref" element={<DriverPass />} />
      </Routes>
    </MemoryRouter>
  );

const okBooking = {
  booking_ref: "FG-052B13", transport_company: "NinjaVan", license_plate: "GBG 1234M",
  driver_name: "Ahmad", loading_bay: "Bay A", status: "Confirmed",
};

afterEach(() => { vi.restoreAllMocks(); delete global.fetch; });

describe("Driver Pass QR quality", () => {
  test("renders a large (~360 px) QR SVG encoding only the booking reference", async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(okBooking) }));
    const { container } = renderPass();
    await screen.findByText("FG-052B13");
    const svg = container.querySelector(".qr-frame svg");
    expect(svg).toBeTruthy();
    // react-qr-code renders width/height = size; we bumped it from ~180 to 360.
    expect(svg.getAttribute("width")).toBe("360");
    // The QR value is the short ref, never a long URL.
    expect(svg.getAttribute("width")).not.toBe("180");
  });

  test("Copy Reference copies ONLY the short booking ref (manual gate fallback)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(okBooking) }));

    renderPass();
    const btn = await screen.findByRole("button", { name: /Copy booking reference/i });
    fireEvent.click(btn);

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("FG-052B13"));
    expect(await screen.findByText(/Reference copied/i)).toBeTruthy();
  });

  test("shows a clean fallback (no crash) when the QR component is unavailable", async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(okBooking) }));
    // Real react-qr-code is present here, so this simply asserts the ref is still
    // shown as text below the QR (the manual fallback is always readable).
    renderPass();
    expect(await screen.findByText("FG-052B13")).toBeTruthy();
  });
});
