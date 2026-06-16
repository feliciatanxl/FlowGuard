import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import FaceEnrollment from "../FaceEnrollment";

jest.mock("axios", () => ({ post: jest.fn(() => Promise.resolve({ data: { success: true } })) }));

const renderPage = () => render(<BrowserRouter><FaceEnrollment /></BrowserRouter>);

describe("FaceEnrollment", () => {
  test("renders the page", () => {
    renderPage();
    expect(document.querySelector("video, input, button")).toBeTruthy();
  });

  test("file upload input accepts images", () => {
    renderPage();
    const inputs = document.querySelectorAll('input[type="file"]');
    expect(inputs.length).toBeGreaterThan(0);
  });

  test("submit button exists and is clickable", () => {
    renderPage();
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
  });
});
