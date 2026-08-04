// Frontend tests — V-Patrol Security Timeline cards and compact filters.
import fs from "node:fs";
import path from "node:path";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/components/Sidebar", () => ({ default: () => <div data-testid="sidebar" /> }));

const mockAxios = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("axios", () => ({ default: mockAxios }));

import VPatrol from "../../src/pages/VPatrol";
import { resetPiAvailabilityCache } from "../../src/constants/piCamera";

// Backend rows as returned by GET /api/security/logs (fixed past timestamps —
// the card must show THESE, not a freshly generated time).
const BACKEND_LOGS = [
  {
    id: "3f0a1c2e-1111-4d4e-9a10-aaaaaaaaaaaa",
    time: "08:00:00 pm",
    type: "Gantry Access",
    desc: "Identity & Liveness Verified: Tan Xiu Li, Felicia",
    severity: "safe",
    icon: "🔓",
    personnelName: "Tan Xiu Li, Felicia",
    confidence: 0.92,
    cameraLocation: "Biometric Gantry",
    reviewStatus: "Resolved",
    createdAt: "2025-03-05T13:45:00+08:00",
  },
  {
    id: "3f0a1c2e-2222-4d4e-9a10-bbbbbbbbbbbb",
    time: "10:00:00 am",
    type: "Intrusion Alert",
    desc: "Unregistered person detected at Main Gate.",
    severity: "critical",
    icon: "🚨",
    personnelName: null,
    confidence: 0.31,
    cameraLocation: "Main Gate",
    reviewStatus: "Pending Review",
    createdAt: "2025-03-04T10:00:00+08:00",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  resetPiAvailabilityCache(); // Pi-unavailable cooldown must not leak between tests
  mockAxios.get.mockResolvedValue({ data: BACKEND_LOGS });
  mockAxios.post.mockResolvedValue({ data: {} });
  // Pi probe fails fast → webcam fallback path (camera behaviour covered elsewhere).
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("pi offline")));
  Object.defineProperty(global.navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderTimeline = async () => {
  const utils = render(<VPatrol />);
  await waitFor(() => expect(screen.getByText("Gantry Access")).toBeTruthy());
  return utils;
};

describe("V-Patrol Security Timeline cards", () => {
  test("card shows the BACKEND timestamp formatted in Singapore time", async () => {
    await renderTimeline();
    // createdAt 2025-03-05T13:45+08:00 → "05 Mar 2025, 1:45 PM" (not today's clock)
    expect(screen.getByText(/05 Mar 2025, 1:45 PM/)).toBeTruthy();
    expect(screen.getByText(/04 Mar 2025, 10:00 AM/)).toBeTruthy();
  });

  test("card leads with event, person, outcome, confidence and location", async () => {
    await renderTimeline();
    expect(screen.getByText("Gantry Access")).toBeTruthy();
    expect(screen.getByText("Tan Xiu Li, Felicia")).toBeTruthy();
    expect(screen.getByText("Granted")).toBeTruthy();
    expect(screen.getByText("Suspicious")).toBeTruthy();
    expect(screen.getByText("Unknown Person")).toBeTruthy();
    expect(screen.getByText(/92% confidence/)).toBeTruthy();
    expect(screen.getByText(/Biometric Gantry/)).toBeTruthy();
  });

  test("log UUID is secondary (muted footer), with review status beside it", async () => {
    const { container } = await renderTimeline();
    const mutedIds = [...container.querySelectorAll(".item-id-muted")].map((el) => el.textContent);
    expect(mutedIds).toContain("#3f0a1c2e-1111-4d4e-9a10-aaaaaaaaaaaa");
    expect(screen.getByText("Pending Review")).toBeTruthy();
    // The UUID must not appear in the primary title area.
    const titles = [...container.querySelectorAll(".item-text h4")].map((el) => el.textContent);
    expect(titles.join(" ")).not.toMatch(/3f0a1c2e/);
  });

  test("refresh restores repeated same-person events inside the same minute and second", async () => {
    const repeated = [
      { ...BACKEND_LOGS[0], id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", createdAt: "2026-08-03T07:59:12.900Z" },
      { ...BACKEND_LOGS[0], id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", createdAt: "2026-08-03T07:59:12.100Z" },
      { ...BACKEND_LOGS[0], id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", createdAt: "2026-08-03T07:59:05.000Z" },
    ];
    mockAxios.get.mockResolvedValue({ data: repeated });
    const { container } = render(<VPatrol />);

    await waitFor(() => expect(screen.getAllByText("Gantry Access")).toHaveLength(3));
    expect(screen.getAllByText("Tan Xiu Li, Felicia")).toHaveLength(3);
    const ids = [...container.querySelectorAll(".item-id-muted")].map((node) => node.textContent);
    expect(ids).toEqual(repeated.map((log) => `#${log.id}`));
    expect(new Set(ids).size).toBe(3);

    fireEvent.change(screen.getByLabelText("Search timeline"), { target: { value: "Tan Xiu Li" } });
    expect(screen.getAllByText("Gantry Access")).toHaveLength(3);
  });
});

describe("V-Patrol attendance separation", () => {
  test("V-Patrol never calls /api/attendance/scan — audit events only", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../src/pages/VPatrol.jsx"), "utf8"
    );
    expect(source).not.toMatch(/attendance\/scan/);
    expect(source).toMatch(/facial-recognition\/access-event/);
  });
});

describe("V-Patrol operational layout", () => {
  test("the large recognition-result card is removed; camera and Security Timeline remain", async () => {
    const { container } = await renderTimeline();
    // No big decision card (idle text, detail rows or record button).
    expect(screen.queryByTestId("recognition-decision-card")).toBeNull();
    expect(screen.queryByText(/Awaiting scan — no recognition decision yet/)).toBeNull();
    expect(screen.queryByText("Record for Evaluation")).toBeNull();
    // Live camera feed + HUD on the left, Security Timeline on the right.
    expect(container.querySelector("video.video-feed")).toBeTruthy();
    expect(screen.getByText(/SYS_MODE \/\/ BIOMETRIC_GANTRY/)).toBeTruthy();
    expect(screen.getByText("Security Timeline")).toBeTruthy();
    // Camera source switching stays available.
    expect(screen.getByRole("button", { name: "Raspberry Pi Camera Module 3" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Laptop Webcam" })).toBeTruthy();
  });

  test("camera actions share one wrapping row and availability is below it", async () => {
    const { container } = await renderTimeline();
    const row = container.querySelector(".camera-control-row");
    for (const name of ["Raspberry Pi Camera Module 3", "Laptop Webcam", "Run Single Check", "Stop Monitoring"]) {
      expect(row.contains(screen.getByRole("button", { name }))).toBe(true);
    }
    const status = container.querySelector(".camera-status-line");
    expect(status).toBeTruthy();
    expect(row.contains(status)).toBe(false);
  });

  test("mode pills, evaluation accordion and confusion matrix are gone from V-Patrol", async () => {
    await renderTimeline();
    expect(screen.queryByRole("button", { name: "Operational Mode" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Live Evaluation Mode" })).toBeNull();
    expect(screen.queryByText(/Facial Recognition Evaluation/)).toBeNull();
    expect(screen.queryByTestId("live-matrix-vpatrol")).toBeNull();
    expect(screen.queryByText(/Select ground-truth identity/)).toBeNull();
    expect(screen.queryByText(/Auto-record completed scans/)).toBeNull();
  });
});

describe("V-Patrol timeline filters", () => {
  test("event-type filter hides non-matching cards", async () => {
    await renderTimeline();
    fireEvent.change(screen.getByLabelText("Filter by event type"), { target: { value: "granted" } });
    expect(screen.getByText("Gantry Access")).toBeTruthy();
    expect(screen.queryByText("Intrusion Alert")).toBeNull();
  });

  test("search filters by person / location", async () => {
    await renderTimeline();
    fireEvent.change(screen.getByLabelText("Search timeline"), { target: { value: "Main Gate" } });
    expect(screen.getByText("Intrusion Alert")).toBeTruthy();
    expect(screen.queryByText("Gantry Access")).toBeNull();
  });

  test("Today filter on old logs shows the empty state; Clear Filters restores", async () => {
    await renderTimeline();
    fireEvent.change(screen.getByLabelText("Filter by date"), { target: { value: "today" } });
    expect(screen.getByText(/No security events match the current filters/)).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "Clear Filters" })[0]);
    expect(screen.getByText("Gantry Access")).toBeTruthy();
    expect(screen.getByText("Intrusion Alert")).toBeTruthy();
  });

  test("Clear Filters button only appears when a filter is active", async () => {
    await renderTimeline();
    expect(screen.queryByRole("button", { name: "Clear Filters" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Filter by date"), { target: { value: "7days" } });
    expect(screen.getAllByRole("button", { name: "Clear Filters" }).length).toBeGreaterThan(0);
  });
});
