import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, describe, test, expect, beforeEach } from "vitest";

vi.mock("axios", () => ({ default: { post: vi.fn(() => Promise.resolve({ data: {} })) } }));

import FaceEnrollment from "../FaceEnrollment";

const renderPage = () =>
  render(<MemoryRouter><FaceEnrollment /></MemoryRouter>);

describe("FaceEnrollment", () => {
  beforeEach(() => vi.clearAllMocks());

  test("renders without crashing", () => {
    const { container } = renderPage();
    expect(container).toBeTruthy();
  });

  test("has buttons", () => {
    renderPage();
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
  });

  test("has interactive elements", () => {
    const { container } = renderPage();
    const elements = container.querySelectorAll("button, input, video");
    expect(elements.length).toBeGreaterThan(0);
  });
});
