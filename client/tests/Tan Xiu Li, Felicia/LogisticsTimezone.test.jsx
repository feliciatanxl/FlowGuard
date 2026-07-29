// Frontend tests — the Logistics management table and Edit form honour the
// Singapore time contract: a slot stored as 10:01 UTC shows as 27 Jul 2026,
// 6:01 PM (never 28 Jul 2:01 AM), and editing round-trips the instant.
import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/components/Sidebar", () => ({ default: () => <div data-testid="sidebar" /> }));

const mockAxios = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock("axios", () => ({ default: mockAxios }));

import TenantLogistics from "../../src/pages/TenantLogistics";

// Stored as an absolute UTC instant, exactly as the API returns it.
// 10:01 UTC = 6:01 PM Singapore on 27 Jul 2026.
const BOOKING = {
  id: 42, booking_ref: "FG-TZ01", license_plate: "GBG 1234M",
  transport_company: "NinjaVan", driver_name: "Ahmad", driver_phone: "+6591234567",
  loading_bay: "Bay A",
  slot_start: "2026-07-27T10:01:00.000Z",
  slot_end: "2026-07-27T10:03:00.000Z",
  notes: "fragile", status: "Pending",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAxios.get.mockResolvedValue({ data: [BOOKING] });
  mockAxios.patch.mockResolvedValue({ data: { message: "Booking updated." } });
  localStorage.setItem("userRole", "FM");
  localStorage.setItem("accessToken", "test-token");
});

afterEach(() => { cleanup(); localStorage.clear(); });

// The page defaults to today (Singapore); this fixture is dated 27 Jul 2026, so
// switch to "All dates" to keep it visible regardless of the real run date.
const showAllDates = () => fireEvent.click(screen.getByRole("button", { name: /All dates/i }));

const renderPage = async () => {
  render(<MemoryRouter><TenantLogistics /></MemoryRouter>);
  showAllDates();
  await screen.findByText("FG-TZ01");
};

describe("Logistics Singapore time", () => {
  test("table shows the Singapore slot (27 Jul, 6:01 PM) — not the +8h UTC shift", async () => {
    await renderPage();
    expect(screen.getByText(/27 Jul 2026, 6:01 PM/)).toBeTruthy();
    // The classic bug rendered the instant in a shifted zone as 28 Jul 2:01 AM.
    expect(screen.queryByText(/28 Jul 2026/)).toBeNull();
  });

  test("Edit pre-fills the datetime-local input with the original Singapore wall clock", async () => {
    const { container } = render(<MemoryRouter><TenantLogistics /></MemoryRouter>);
    showAllDates();
    await screen.findByText("FG-TZ01");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByText("Edit Booking");

    const startInput = container.querySelector('input[name="slot_start"]');
    expect(startInput.value).toBe("2026-07-27T18:01");
    const endInput = container.querySelector('input[name="slot_end"]');
    expect(endInput.value).toBe("2026-07-27T18:03");
  });

  test("saving an edit sends explicit UTC ISO and refreshes the table", async () => {
    render(<MemoryRouter><TenantLogistics /></MemoryRouter>);
    showAllDates();
    await screen.findByText("FG-TZ01");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByText("Edit Booking");
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(mockAxios.patch).toHaveBeenCalled());
    const [url, payload] = mockAxios.patch.mock.calls[0];
    expect(url).toMatch(/\/api\/bookings\/42$/);
    // Untouched slot must round-trip back to the same UTC instant (no drift).
    expect(payload.slot_start).toBe("2026-07-27T10:01:00.000Z");
    expect(payload.slot_end).toBe("2026-07-27T10:03:00.000Z");
    // The list is refetched so the management table reflects the saved values.
    expect(mockAxios.get).toHaveBeenCalledTimes(2);
  });
});
