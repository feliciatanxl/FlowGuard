// Frontend error-handling tests — 404 page, SystemError page, and the ErrorBoundary
// fallback that prevents blank white screens on render crashes.
import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, test, expect, vi } from "vitest";

import NotFound from "../../src/pages/NotFound";
import SystemError from "../../src/pages/SystemError";
import ErrorBoundary from "../../src/components/ErrorBoundary";

describe("Error pages", () => {
  test("NotFound shows a friendly 404", () => {
    render(<MemoryRouter><NotFound /></MemoryRouter>);
    expect(screen.getByText("404")).toBeTruthy();
    expect(screen.getByText(/Sector Not Found/i)).toBeTruthy();
  });

  test("SystemError renders the supplied code + message (403)", () => {
    render(
      <MemoryRouter>
        <SystemError code="403" title="Clearance Denied" message="You do not have clearance." />
      </MemoryRouter>
    );
    expect(screen.getByText("403")).toBeTruthy();
    expect(screen.getByText(/Clearance Denied/i)).toBeTruthy();
    expect(screen.getByText(/do not have clearance/i)).toBeTruthy();
  });
});

describe("ErrorBoundary", () => {
  const Boom = () => { throw new Error("render crash"); };

  test("shows a fallback instead of a blank screen when a child throws", () => {
    // Silence React's expected error log for this intentional throw.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByText(/Something went wrong/i)).toBeTruthy();
    expect(screen.getByText("500")).toBeTruthy();
    spy.mockRestore();
  });

  test("renders children normally when there is no error", () => {
    render(<ErrorBoundary><div>HEALTHY-CHILD</div></ErrorBoundary>);
    expect(screen.getByText("HEALTHY-CHILD")).toBeTruthy();
  });
});
