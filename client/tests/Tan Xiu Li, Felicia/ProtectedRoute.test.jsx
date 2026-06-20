// Frontend tests — route protection for facial/access pages (Felicia)
// Verifies unauthenticated and non-FM users cannot reach protected content.
import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, test, expect, beforeEach } from "vitest";

import ProtectedRoute from "../../src/components/ProtectedRoute";

const Secret = () => <div>SECRET-DASHBOARD</div>;

const renderGuarded = (props = {}) =>
  render(
    <MemoryRouter>
      <ProtectedRoute {...props}><Secret /></ProtectedRoute>
    </MemoryRouter>
  );

beforeEach(() => localStorage.clear());

describe("ProtectedRoute", () => {
  test("blocks access when no token is present", () => {
    renderGuarded();
    expect(screen.queryByText("SECRET-DASHBOARD")).toBeNull();
  });

  test("blocks a non-FM user from an FM-only page", () => {
    localStorage.setItem("accessToken", "t");
    localStorage.setItem("userRole", "Staff");
    renderGuarded({ requiredRole: "FM" });
    expect(screen.queryByText("SECRET-DASHBOARD")).toBeNull();
  });

  test("allows an FM user into an FM-only page", () => {
    localStorage.setItem("accessToken", "t");
    localStorage.setItem("userRole", "FM");
    renderGuarded({ requiredRole: "FM" });
    expect(screen.getByText("SECRET-DASHBOARD")).toBeTruthy();
  });

  test("allowedRoles permits any listed role", () => {
    localStorage.setItem("accessToken", "t");
    localStorage.setItem("userRole", "Tenant");
    renderGuarded({ allowedRoles: ["FM", "Tenant"] });
    expect(screen.getByText("SECRET-DASHBOARD")).toBeTruthy();
  });

  test("allowedRoles still blocks a role not in the list", () => {
    localStorage.setItem("accessToken", "t");
    localStorage.setItem("userRole", "Staff");
    renderGuarded({ allowedRoles: ["FM", "Tenant"] });
    expect(screen.queryByText("SECRET-DASHBOARD")).toBeNull();
  });
});
