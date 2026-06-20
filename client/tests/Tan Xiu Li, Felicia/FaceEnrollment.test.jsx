// Frontend tests — Facial Recognition & Access Management (Felicia)
// Covers: page renders, manual upload validation, submit hits the correct backend
// endpoint, and missing required images blocks submission.
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, describe, test, expect, beforeEach } from "vitest";
import "@testing-library/jest-dom";

const { mockPost } = vi.hoisted(() => ({ mockPost: vi.fn(() => Promise.resolve({ data: {} })) }));
vi.mock("axios", () => ({ default: { post: mockPost } }));

import FaceEnrollment from "../../src/pages/FaceEnrollment";

const renderPage = () =>
  render(<MemoryRouter><FaceEnrollment /></MemoryRouter>);

const imageFile = (name) => new File(["binary"], name, { type: "image/png" });
const getFileInputs = () => document.querySelectorAll('input[type="file"]');

beforeEach(() => {
  mockPost.mockClear();
  localStorage.clear();
  localStorage.setItem("accessToken", "test-token");
  localStorage.setItem("userName", "Felicia");

  // jsdom has no webcam — stub getUserMedia so startCamera() resolves cleanly.
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(() => Promise.resolve({ getTracks: () => [] })) },
  });
});

describe("FaceEnrollment page", () => {
  test("renders the enrolment capture UI", () => {
    renderPage();
    expect(screen.getByText(/Biometric Setup/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Use Camera/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Upload Photos/i })).toBeInTheDocument();
  });

  test("rejects a non-image file on manual upload", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Upload Photos/i }));

    const inputs = getFileInputs();
    expect(inputs.length).toBe(3); // front / left / right upload zones

    fireEvent.change(inputs[0], {
      target: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] },
    });

    expect(await screen.findByText(/upload an image file/i)).toBeInTheDocument();
  });

  test("blocks submission when required images are missing", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Upload Photos/i }));

    const submit = screen.getByRole("button", { name: /Confirm & Unlock System/i });
    expect(submit).toBeDisabled();
  });

  test("submit calls POST /user/enroll-face once all angles are uploaded", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Upload Photos/i }));

    ["f.png", "l.png", "r.png"].forEach((n, i) => {
      fireEvent.change(getFileInputs()[i], { target: { files: [imageFile(n)] } });
    });

    const submit = await screen.findByRole("button", { name: /Confirm & Unlock System/i });
    await waitFor(() => expect(submit).not.toBeDisabled());

    fireEvent.click(submit);

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith(
        "/user/enroll-face",
        expect.objectContaining({ images: expect.any(Object) }),
        expect.objectContaining({ headers: expect.any(Object) })
      )
    );
  });

  test("surfaces a backend enrolment error to the user", async () => {
    mockPost.mockRejectedValueOnce({ response: { data: { error: "No face detected in one of the images." } } });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Upload Photos/i }));

    ["f.png", "l.png", "r.png"].forEach((n, i) => {
      fireEvent.change(getFileInputs()[i], { target: { files: [imageFile(n)] } });
    });

    const submit = await screen.findByRole("button", { name: /Confirm & Unlock System/i });
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);

    expect(await screen.findByText(/No face detected/i)).toBeInTheDocument();
  });
});
