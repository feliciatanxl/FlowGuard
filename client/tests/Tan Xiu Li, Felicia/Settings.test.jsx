// Frontend tests — Settings role-based content after the cleanup pass.
// All roles keep Face ID re-enrollment + Change Password; the FlowGuard AI
// Engine, Camera Feed Quality and Danger Zone sections are permanently removed.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, test, expect, beforeEach, vi } from "vitest";

import Settings from "../../src/pages/Settings";

const renderAs = (role) => {
  localStorage.setItem("accessToken", "test-token");
  localStorage.setItem("userRole", role);
  return render(<MemoryRouter><Settings /></MemoryRouter>);
};

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Settings — shared content", () => {
  test.each(["FM", "Tenant", "Staff"])("%s sees the Settings page with Face ID re-enrollment", (role) => {
    renderAs(role);
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeTruthy();
    expect(screen.getByText(/Face ID Re-enrollment/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Re-enroll My Face ID/i })).toBeTruthy();
  });

  test.each(["FM", "Tenant", "Staff"])("%s can change their password", (role) => {
    renderAs(role);
    expect(screen.getByRole("heading", { level: 3, name: /Account Security/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Change Password/i })).toBeTruthy();
  });
});

describe("Settings — removed sections stay removed for every role", () => {
  test.each(["FM", "Tenant", "Staff"])("%s does not see AI Engine, Camera Feed Quality or Danger Zone", (role) => {
    renderAs(role);
    expect(screen.queryByText(/FlowGuard AI Engine/i)).toBeNull();
    expect(screen.queryByText(/PPE Detection Strictness/i)).toBeNull();
    expect(screen.queryByText(/Auto-Record on Incident/i)).toBeNull();
    expect(screen.queryByText(/Camera Feed Quality/i)).toBeNull();
    expect(screen.queryByText(/Danger Zone/i)).toBeNull();
    expect(screen.queryByText(/Reboot Network Nodes/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /Initiate Reboot/i })).toBeNull();
    // No orphan dead save button either — the only save-style actions left are
    // the Face ID re-enrol and Change Password buttons.
    expect(screen.queryByRole("button", { name: /^Save Changes$/i })).toBeNull();
  });

  test("FM keeps legitimate notification controls", () => {
    renderAs("FM");
    expect(screen.getByText(/Push Notifications to Mobile/i)).toBeTruthy();
  });

  test("notification controls stay FM-only", () => {
    renderAs("Staff");
    expect(screen.queryByText(/Push Notifications to Mobile/i)).toBeNull();
  });
});

describe("Settings — Raspberry Pi Camera runtime configuration", () => {
  test("Save validates and stores only the normalized base URL", () => {
    renderAs("FM");
    const input = screen.getByLabelText("Pi Camera Base URL");
    expect(input.placeholder).toBe("http://172.20.10.4:8081");
    fireEvent.change(input, { target: { value: "http://pi.local:8081/" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(input.value).toBe("http://pi.local:8081");
    expect(localStorage.getItem("flowguard.piCameraBaseUrl")).toBe("http://pi.local:8081");
    expect(screen.getByText(/Configuration source:/).textContent).toMatch(/Runtime/);
    expect(localStorage.getItem("flowguard.piCameraSnapshot")).toBeNull();
    expect(localStorage.getItem("flowguard.piCameraCredential")).toBeNull();
  });

  test("Save rejects an invalid URL without replacing the current setting", () => {
    localStorage.setItem("flowguard.piCameraBaseUrl", "http://existing-pi.local:8081");
    renderAs("FM");
    fireEvent.change(screen.getByLabelText("Pi Camera Base URL"), {
      target: { value: "javascript:alert(1)" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("Invalid URL")).toBeTruthy();
    expect(localStorage.getItem("flowguard.piCameraBaseUrl")).toBe("http://existing-pi.local:8081");
  });

  test("Test Connection calls /health and displays Connected for a healthy Pi", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "ok", camera: "Pi Camera Module 3", sequence: 2 }),
    });
    vi.stubGlobal("fetch", fetchMock);
    renderAs("FM");
    fireEvent.change(screen.getByLabelText("Pi Camera Base URL"), {
      target: { value: "http://pi.local:8081" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));

    await waitFor(() => expect(screen.getByText("Connected")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(
      "http://pi.local:8081/health",
      expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) })
    );
  });

  test("failed health request displays Unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network down")));
    renderAs("FM");
    fireEvent.change(screen.getByLabelText("Pi Camera Base URL"), {
      target: { value: "http://pi.local:8081" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));
    await waitFor(() => expect(screen.getByText("Unreachable")).toBeTruthy());
  });

  test("permission-like failure displays Permission Required guidance", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Blocked by local network permission")));
    renderAs("FM");
    fireEvent.change(screen.getByLabelText("Pi Camera Base URL"), {
      target: { value: "http://pi.local:8081" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));

    await waitFor(() => expect(screen.getByText("Permission Required")).toBeTruthy());
    expect(screen.getAllByText(/Allow Chrome local-network access/i).length).toBeGreaterThan(0);
  });

  test("Reset removes only the Pi override and returns to the default state", () => {
    localStorage.setItem("flowguard.piCameraBaseUrl", "http://runtime-pi.local:8081");
    localStorage.setItem("unrelated.setting", "keep-me");
    renderAs("FM");
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(localStorage.getItem("flowguard.piCameraBaseUrl")).toBeNull();
    expect(localStorage.getItem("unrelated.setting")).toBe("keep-me");
    expect(screen.getByText(/Configuration source:/).textContent).toMatch(/Not configured/);
  });
});
