// Frontend tests — Logistics defaults to TODAY (Singapore), with an "All dates"
// escape hatch. "Today" is pinned via a partial mock of getSingaporeTodayDateKey
// so the behaviour is deterministic; the helper's real timezone-independence is
// proven in DatetimeSingapore.test.js (run under TZ=UTC).
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";

vi.mock("../../src/components/Sidebar", () => ({ default: () => <div data-testid="sidebar" /> }));

const mockAxios = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock("axios", () => ({ default: mockAxios }));

// Pin "today" to 27 Jul 2026 (Singapore); keep every other helper real.
vi.mock("../../src/constants/datetime", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getSingaporeTodayDateKey: () => "2026-07-27" };
});

import TenantLogistics from "../../src/pages/TenantLogistics";

// UTC instants that resolve to specific Singapore calendar days.
const TODAY = { id: 1, booking_ref: "FG-TODAY", license_plate: "P1", transport_company: "C1", driver_name: "D1", driver_phone: "+6591234567", loading_bay: "Bay A", slot_start: "2026-07-27T02:00:00.000Z", slot_end: "2026-07-27T03:00:00.000Z", status: "Pending" };
const TOMORROW = { id: 2, booking_ref: "FG-TMRW", license_plate: "P2", transport_company: "C2", driver_name: "D2", driver_phone: "+6591234567", loading_bay: "Bay B", slot_start: "2026-07-28T02:00:00.000Z", status: "Pending" };
const PAST = { id: 3, booking_ref: "FG-PAST", license_plate: "P3", transport_company: "C3", driver_name: "D3", driver_phone: "+6591234567", loading_bay: "Bay A", slot_start: "2026-07-20T02:00:00.000Z", status: "Completed" };
const ALL = [TODAY, TOMORROW, PAST];

const dateInput = () => screen.getByLabelText(/Filter by slot date/i);
const allDatesBtn = () => screen.getByRole("button", { name: /All dates/i });

beforeEach(() => {
  vi.clearAllMocks();
  mockAxios.get.mockResolvedValue({ data: ALL });
  mockAxios.post.mockResolvedValue({ data: {} });
  mockAxios.patch.mockResolvedValue({ data: { message: "ok" } });
  localStorage.setItem("userRole", "FM");
  localStorage.setItem("accessToken", "test-token");
});

afterEach(() => { cleanup(); localStorage.clear(); });

const renderPage = () => render(<MemoryRouter><TenantLogistics /></MemoryRouter>);

describe("Logistics defaults to Singapore today", () => {
  test("the date filter defaults to today's Singapore date", async () => {
    renderPage();
    await screen.findByText("FG-TODAY");
    expect(dateInput().value).toBe("2026-07-27");
  });

  test("only today's bookings appear initially; tomorrow + historical are hidden", async () => {
    renderPage();
    await screen.findByText("FG-TODAY");
    expect(screen.queryByText("FG-TMRW")).toBeNull();
    expect(screen.queryByText("FG-PAST")).toBeNull();
  });

  test("selecting another date shows that date's bookings", async () => {
    renderPage();
    await screen.findByText("FG-TODAY");
    fireEvent.change(dateInput(), { target: { value: "2026-07-28" } });
    expect(await screen.findByText("FG-TMRW")).toBeTruthy();
    expect(screen.queryByText("FG-TODAY")).toBeNull();
  });

  test("All dates shows the complete history", async () => {
    renderPage();
    await screen.findByText("FG-TODAY");
    fireEvent.click(allDatesBtn());
    expect(await screen.findByText("FG-TMRW")).toBeTruthy();
    expect(screen.getByText("FG-PAST")).toBeTruthy();
    expect(screen.getByText("FG-TODAY")).toBeTruthy();
    // Active state is exposed non-visually too.
    expect(allDatesBtn().getAttribute("aria-pressed")).toBe("true");
    expect(dateInput().value).toBe("");
  });

  test("selecting a date after All dates returns to date-filtered mode", async () => {
    renderPage();
    await screen.findByText("FG-TODAY");
    fireEvent.click(allDatesBtn());
    await screen.findByText("FG-PAST");
    fireEvent.change(dateInput(), { target: { value: "2026-07-20" } });
    expect(screen.getByText("FG-PAST")).toBeTruthy();
    expect(screen.queryByText("FG-TODAY")).toBeNull();
    expect(screen.queryByText("FG-TMRW")).toBeNull();
    expect(allDatesBtn().getAttribute("aria-pressed")).toBe("false");
  });

  test("Refresh preserves the selected date", async () => {
    renderPage();
    await screen.findByText("FG-TODAY");
    fireEvent.change(dateInput(), { target: { value: "2026-07-28" } });
    await screen.findByText("FG-TMRW");

    fireEvent.click(screen.getByRole("button", { name: /^Refresh$/i }));
    await waitFor(() => expect(mockAxios.get).toHaveBeenCalledTimes(2));
    expect(dateInput().value).toBe("2026-07-28");
    expect(screen.getByText("FG-TMRW")).toBeTruthy();
    expect(screen.queryByText("FG-TODAY")).toBeNull();
  });

  test("confirming a booking preserves the selected date", async () => {
    renderPage();
    await screen.findByText("FG-TODAY");
    fireEvent.click(screen.getByRole("button", { name: "Mark Confirmed" }));
    await waitFor(() => expect(mockAxios.patch).toHaveBeenCalledWith(
      "/api/bookings/1/status", { status: "Confirmed" }, expect.any(Object)));
    expect(dateInput().value).toBe("2026-07-27");
  });

  test("cancelling a booking preserves the selected date", async () => {
    renderPage();
    await screen.findByText("FG-TODAY");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(mockAxios.patch).toHaveBeenCalledWith(
      "/api/bookings/1/cancel", {}, expect.any(Object)));
    expect(dateInput().value).toBe("2026-07-27");
  });

  test("editing a booking preserves the selected date", async () => {
    renderPage();
    await screen.findByText("FG-TODAY");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByText("Edit Booking");
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(mockAxios.patch).toHaveBeenCalled());
    expect(dateInput().value).toBe("2026-07-27");
  });

  test("search / status / bay filters still combine with the date filter", async () => {
    renderPage();
    await screen.findByText("FG-TODAY");

    // Today + Bay A → FG-TODAY (Bay A) stays; a Bay B search finds nothing today.
    fireEvent.change(screen.getByLabelText(/Filter by bay/i), { target: { value: "Bay A" } });
    expect(screen.getByText("FG-TODAY")).toBeTruthy();

    // All dates + Completed → only the historical Completed booking.
    fireEvent.click(allDatesBtn());
    fireEvent.change(screen.getByLabelText(/Filter by bay/i), { target: { value: "All" } });
    fireEvent.change(screen.getByLabelText(/Filter by status/i), { target: { value: "Completed" } });
    expect(await screen.findByText("FG-PAST")).toBeTruthy();
    expect(screen.queryByText("FG-TODAY")).toBeNull();
    expect(screen.queryByText("FG-TMRW")).toBeNull();

    // All dates + search by reference.
    fireEvent.change(screen.getByLabelText(/Filter by status/i), { target: { value: "All" } });
    fireEvent.change(screen.getByLabelText(/Search bookings/i), { target: { value: "FG-TMRW" } });
    expect(await screen.findByText("FG-TMRW")).toBeTruthy();
    expect(screen.queryByText("FG-PAST")).toBeNull();
  });

  test("the Today's Bookings card always counts Singapore today, even on another date", async () => {
    renderPage();
    await screen.findByText("FG-TODAY");
    const card = screen.getByText("Today's Bookings").closest(".logistics-stat-card");
    expect(card.querySelector(".stat-value").textContent).toBe("1");

    // Switch to a different date — the card meaning must not change.
    fireEvent.change(dateInput(), { target: { value: "2026-07-28" } });
    await screen.findByText("FG-TMRW");
    expect(card.querySelector(".stat-value").textContent).toBe("1");

    // All dates — still counts today only.
    fireEvent.click(allDatesBtn());
    expect(card.querySelector(".stat-value").textContent).toBe("1");
  });

  test("remounting resets the filter back to today (no persistence)", async () => {
    const { unmount } = renderPage();
    await screen.findByText("FG-TODAY");
    fireEvent.change(dateInput(), { target: { value: "2026-07-28" } });
    expect(dateInput().value).toBe("2026-07-28");

    unmount();
    renderPage();
    await screen.findByText("FG-TODAY");
    expect(dateInput().value).toBe("2026-07-27");
  });

  describe("empty states", () => {
    test("today with no bookings today", async () => {
      mockAxios.get.mockResolvedValue({ data: [TOMORROW, PAST] });
      renderPage();
      expect(await screen.findByText(/No bookings scheduled for today\./i)).toBeTruthy();
    });

    test("a selected date with no bookings", async () => {
      renderPage();
      await screen.findByText("FG-TODAY");
      fireEvent.change(dateInput(), { target: { value: "2026-07-15" } });
      expect(await screen.findByText(/No bookings found for the selected date\./i)).toBeTruthy();
    });

    test("All dates with other filters matching nothing", async () => {
      renderPage();
      await screen.findByText("FG-TODAY");
      fireEvent.click(allDatesBtn());
      fireEvent.change(screen.getByLabelText(/Filter by status/i), { target: { value: "Cancelled" } });
      expect(await screen.findByText(/No bookings match the selected filters\./i)).toBeTruthy();
    });

    test("zero bookings at all keeps the original empty message", async () => {
      mockAxios.get.mockResolvedValue({ data: [] });
      renderPage();
      expect(await screen.findByText(/No bookings scheduled yet\./i)).toBeTruthy();
    });
  });
});
