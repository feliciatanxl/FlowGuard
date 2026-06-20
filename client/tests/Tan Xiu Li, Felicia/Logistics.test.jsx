// Frontend tests — Smart Logistics page renders, with loading → empty state.
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, describe, test, expect, beforeEach } from "vitest";

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn(() => Promise.resolve({ data: [] })) }));
vi.mock("axios", () => ({
  default: { get: mockGet, post: vi.fn(() => Promise.resolve({ data: {} })), patch: vi.fn(() => Promise.resolve({ data: {} })) },
}));

import TenantLogistics from "../../src/pages/TenantLogistics";

const renderPage = () => render(<MemoryRouter><TenantLogistics /></MemoryRouter>);

beforeEach(() => {
  mockGet.mockClear();
  localStorage.clear();
  localStorage.setItem("accessToken", "test-token");
  localStorage.setItem("userRole", "FM");
});

describe("Logistics page", () => {
  test("renders the logistics header", () => {
    renderPage();
    expect(screen.getByText(/Loading Bay Logistics/i)).toBeTruthy();
  });

  test("shows the create-booking form for FM", () => {
    renderPage();
    expect(screen.getByText(/Schedule New Delivery/i)).toBeTruthy();
  });

  test("calls the bookings API and shows the empty state when there are none", async () => {
    renderPage();
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/api/bookings/", expect.any(Object)));
    expect(await screen.findByText(/No bookings scheduled yet/i)).toBeTruthy();
  });

  test("hides the create form from Staff (operational view only)", () => {
    localStorage.setItem("userRole", "Staff");
    renderPage();
    expect(screen.queryByText(/Schedule New Delivery/i)).toBeNull();
  });
});
