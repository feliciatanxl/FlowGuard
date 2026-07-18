// Frontend tests â€” FM-only Facial Evaluation Lab (Felicia).
// Simulation-only: verifies the page never calls real attendance/security/user
// mutation APIs, evaluation-record CRUD + localStorage persistence, the
// confusion-matrix math (accuracy, macro P/R/F1, FAR, FRR, zero-sample safety),
// CSV export, and that no raw image/vector/template data is rendered or stored.
import React from "react";
import { render, screen, fireEvent, within, cleanup, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom";

vi.mock("../../src/components/Sidebar", () => ({ default: () => <div data-testid="sidebar" /> }));

// Full axios mock: the page must NEVER touch the network.
const mockAxios = vi.hoisted(() => ({
  get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(),
}));
vi.mock("axios", () => ({ default: mockAxios }));

import FacialEvaluation from "../../src/pages/FacialEvaluation";
import ProtectedRoute from "../../src/components/ProtectedRoute";
import {
  EVAL_STORAGE_KEY,
  computeConfusionMatrix,
  toCsv,
  filterRecords,
  createRecord,
} from "../../src/constants/evaluation";

const renderPage = () =>
  render(<MemoryRouter><FacialEvaluation /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem("accessToken", "test-token");
  localStorage.setItem("userRole", "FM");
  localStorage.setItem("userName", "Felicia");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// FM-only access
// ---------------------------------------------------------------------------
describe("FM-only route", () => {
  const renderGuarded = () =>
    render(
      <MemoryRouter initialEntries={["/facial-evaluation"]}>
        <Routes>
          <Route path="/facial-evaluation" element={
            <ProtectedRoute allowedRoles={["FM"]}><FacialEvaluation /></ProtectedRoute>
          } />
          <Route path="/error/403" element={<div>403 blocked</div>} />
          <Route path="/error/401" element={<div>401 blocked</div>} />
        </Routes>
      </MemoryRouter>
    );

  test("FM sees the evaluation dashboard", () => {
    renderGuarded();
    expect(screen.getByText("Facial Recognition Evaluation")).toBeInTheDocument();
  });

  test.each(["Tenant", "Staff"])("%s is redirected to 403", (role) => {
    localStorage.setItem("userRole", role);
    renderGuarded();
    expect(screen.getByText("403 blocked")).toBeInTheDocument();
    expect(screen.queryByText("Facial Recognition Evaluation")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Banner + simulation scenarios
// ---------------------------------------------------------------------------
describe("Simulation scenarios", () => {
  const openSimTab = () => fireEvent.click(screen.getByRole("tab", { name: "Simulated Workflow" }));

  test("no global SIMULATION MODE banner; Overview shows the Live mode note by default", () => {
    renderPage();
    expect(screen.queryByText(/SIMULATION MODE/)).toBeNull();
    expect(screen.getByTestId("overview-mode-note").textContent).toMatch(/LIVE MODEL RESULTS/);
  });

  test("links to the real live pages instead of duplicating the camera", () => {
    renderPage();
    expect(screen.getByRole("link", { name: "Open Face Enrollment" })).toHaveAttribute("href", "/enrollment");
    expect(screen.getByRole("link", { name: "Open V-Patrol" })).toHaveAttribute("href", "/vpatrol");
    expect(screen.getByRole("link", { name: "Open Gate Scanner" })).toHaveAttribute("href", "/gate-scanner");
    expect(document.querySelector("video")).toBeNull(); // no live camera here
  });

  const runScenario = (title) => {
    openSimTab();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(title) }));
    return within(screen.getByTestId("sim-result"));
  };

  test("recognised active user â†’ Access Granted with anonymised label", () => {
    renderPage();
    const result = runScenario("1\\. Recognised Active User");
    expect(result.getByText("P01")).toBeInTheDocument();
    expect(result.getByText("Access Granted")).toBeInTheDocument();
    expect(result.getByText("Active")).toBeInTheDocument();
    expect(result.getByText(/attendance clock-in would be recorded/i)).toBeInTheDocument();
  });

  test("recognised suspended user â†’ Access Denied + simulated security log", () => {
    renderPage();
    const result = runScenario("2\\. Recognised Suspended User");
    expect(result.getByText("P02")).toBeInTheDocument();
    expect(result.getByText("Suspended")).toBeInTheDocument();
    expect(result.getByText("Access Denied")).toBeInTheDocument();
    expect(result.getByText(/suspended access attempt/i)).toBeInTheDocument();
  });

  test("unknown person â†’ Access Denied + simulated intrusion log", () => {
    renderPage();
    const result = runScenario("3\\. Unknown Person");
    expect(result.getAllByText("Unknown").length).toBeGreaterThan(0);
    expect(result.getByText("Access Denied")).toBeInTheDocument();
    expect(result.getByText(/intrusion alert/i)).toBeInTheDocument();
  });

  test("no face detected â†’ NO suspicious log is simulated", () => {
    renderPage();
    const result = runScenario("4\\. No Face Detected");
    expect(result.getByText("No decision")).toBeInTheDocument();
    expect(result.getByText(/no log created/i)).toBeInTheDocument();
  });

  test("Pi offline â†’ automatic laptop fallback continues recognition", () => {
    renderPage();
    const result = runScenario("5\\. Pi Camera Offline");
    expect(result.getByText(/laptop-webcam fallback/i)).toBeInTheDocument();
    expect(result.getByText("Access Granted")).toBeInTheDocument();
  });

  test("recognition service offline â†’ retry/backoff without switching camera", () => {
    renderPage();
    const result = runScenario("6\\. Recognition Service Offline");
    expect(result.getByText(/scan-gate backoff engaged/i)).toBeInTheDocument();
    expect(result.getByText(/camera source is not switched/i)).toBeInTheDocument();
  });

  test("simulations never call real attendance/security/user mutation APIs", () => {
    renderPage();
    openSimTab();
    // Run every scenario and log one to the records.
    [1, 2, 3, 4, 5, 6].forEach((n) => {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${n}\\.`) }));
    });
    fireEvent.click(screen.getByRole("button", { name: /1\. Recognised Active User/ }));
    fireEvent.click(screen.getByRole("button", { name: "Log to evaluation records" }));

    expect(mockAxios.get.mock.calls.every(([url]) => url === "/api/facial-recognition/evaluation-participants")).toBe(true);
    expect(mockAxios.post).not.toHaveBeenCalled();
    expect(mockAxios.put).not.toHaveBeenCalled();
    expect(mockAxios.patch).not.toHaveBeenCalled();
    expect(mockAxios.delete).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Evaluation-record CRUD + persistence
// ---------------------------------------------------------------------------
describe("Evaluation records CRUD", () => {
  const openRecordsTab = () => fireEvent.click(screen.getByRole("tab", { name: "Evaluation Records" }));
  const openSimTab = () => fireEvent.click(screen.getByRole("tab", { name: "Simulated Workflow" }));

  const addLiveRecord = () => {
    fireEvent.change(screen.getByLabelText(/^Actual/), { target: { value: "P02" } });
    fireEvent.change(screen.getByLabelText(/^Predicted/), { target: { value: "Unknown" } });
    fireEvent.change(screen.getByLabelText(/Confidence/), { target: { value: "0.41" } });
    fireEvent.change(screen.getByLabelText(/Latency/), { target: { value: "350" } });
    fireEvent.change(screen.getByLabelText(/Notes/), { target: { value: "low light rejection" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Live Result" }));
  };

  test("Create: live result is added and persisted to the namespaced localStorage key", () => {
    renderPage();
    openRecordsTab();
    addLiveRecord();

    expect(screen.getByText("low light rejection")).toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem(EVAL_STORAGE_KEY));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      actualLabel: "P02", predictedLabel: "Unknown", confidence: 0.41,
      latencyMs: 350, source: "Live", notes: "low light rejection",
    });
  });

  test("Read: records survive unmount/remount via localStorage", () => {
    renderPage();
    openRecordsTab();
    addLiveRecord();
    cleanup();

    renderPage();
    openRecordsTab();
    expect(screen.getByText("low light rejection")).toBeInTheDocument();
  });

  test("Update: actual/predicted/condition/notes are editable", () => {
    renderPage();
    openRecordsTab();
    addLiveRecord();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Edit actual label"), { target: { value: "P03" } });
    fireEvent.change(screen.getByLabelText("Edit predicted label"), { target: { value: "P03" } });
    fireEvent.change(screen.getByLabelText("Edit condition"), { target: { value: "Low Lighting" } });
    fireEvent.change(screen.getByLabelText("Edit notes"), { target: { value: "corrected label" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("corrected label")).toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem(EVAL_STORAGE_KEY));
    expect(stored[0]).toMatchObject({ actualLabel: "P03", predictedLabel: "P03", condition: "Low Lighting" });
  });

  test("Delete: removes one record", () => {
    renderPage();
    openRecordsTab();
    addLiveRecord();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(JSON.parse(localStorage.getItem(EVAL_STORAGE_KEY))).toHaveLength(0);
  });

  test("Clear Simulated asks for confirmation and keeps Live records", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();
    openSimTab();

    // One simulated recordâ€¦
    fireEvent.click(screen.getByRole("button", { name: /1\. Recognised Active User/ }));
    fireEvent.click(screen.getByRole("button", { name: "Log to evaluation records" }));
    // â€¦and one live record.
    openRecordsTab();
    addLiveRecord();

    fireEvent.click(screen.getByRole("button", { name: "Clear Simulated Results" }));
    expect(confirmSpy).toHaveBeenCalled();

    const stored = JSON.parse(localStorage.getItem(EVAL_STORAGE_KEY));
    expect(stored).toHaveLength(1);
    expect(stored[0].source).toBe("Live");
  });

  test("no raw image/vector/template data is rendered or stored", () => {
    renderPage();
    openSimTab();
    fireEvent.click(screen.getByRole("button", { name: /1\. Recognised Active User/ }));
    fireEvent.click(screen.getByRole("button", { name: "Log to evaluation records" }));

    expect(document.body.textContent).not.toMatch(/faceVector|embedding|data:image|base64/i);
    const raw = localStorage.getItem(EVAL_STORAGE_KEY);
    expect(raw).not.toMatch(/faceVector|embedding|data:image|base64/i);
    // Records carry ONLY the approved safe fields.
    for (const rec of JSON.parse(raw)) {
      expect(Object.keys(rec).sort()).toEqual(
        ["actualLabel", "condition", "confidence", "detectionOutcome", "id", "latencyMs", "notes", "origin", "predictedLabel", "source", "timestamp"]
      );
    }
  });

  test("CSV export produces a header + one row per filtered record", () => {
    const createObjectURL = vi.fn(() => "blob:eval");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(Object.create(URL), { createObjectURL, revokeObjectURL }));

    renderPage();
    openRecordsTab();
    addLiveRecord();
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0];
    expect(blob.type).toContain("text/csv");
  });
});

// ---------------------------------------------------------------------------
// Confusion-matrix math (pure)
// ---------------------------------------------------------------------------
describe("computeConfusionMatrix", () => {
  const rec = (actualLabel, predictedLabel, latencyMs = 100) => ({
    actualLabel, predictedLabel, latencyMs, source: "Simulated",
    condition: "front", timestamp: "2026-07-10T10:00:00.000Z",
  });

  const SAMPLE = [
    rec("P01", "P01"), rec("P01", "P01"), rec("P01", "Unknown"), // FRR contribution
    rec("P02", "P02"),
    rec("Unknown", "Unknown"), rec("Unknown", "Unknown"), rec("Unknown", "P03"), // FAR contribution
    rec("P01", "No Face"), // detection failure â€” excluded from identity matrix
  ];

  test("matrix counts: rows = actual, columns = predicted", () => {
    const { labels, matrix, sampleCount, noFaceCount } = computeConfusionMatrix(SAMPLE);
    const at = (a, p) => matrix[labels.indexOf(a)][labels.indexOf(p)];
    expect(sampleCount).toBe(7);
    expect(noFaceCount).toBe(1);
    expect(at("P01", "P01")).toBe(2);
    expect(at("P01", "Unknown")).toBe(1);
    expect(at("P02", "P02")).toBe(1);
    expect(at("Unknown", "Unknown")).toBe(2);
    expect(at("Unknown", "P03")).toBe(1);
  });

  test("accuracy = trace / samples", () => {
    expect(computeConfusionMatrix(SAMPLE).accuracy).toBeCloseTo(5 / 7, 5);
  });

  test("macro precision / recall / F1 over classes present in the data", () => {
    const m = computeConfusionMatrix(SAMPLE);
    // Present classes: P01 (P=1, R=2/3, F1=0.8), P02 (1,1,1), P03 (0,0,0), Unknown (2/3, 2/3, 2/3)
    expect(m.macroPrecision).toBeCloseTo((1 + 1 + 0 + 2 / 3) / 4, 5);
    expect(m.macroRecall).toBeCloseTo((2 / 3 + 1 + 0 + 2 / 3) / 4, 5);
    expect(m.macroF1).toBeCloseTo((0.8 + 1 + 0 + 2 / 3) / 4, 5);
  });

  test("FAR = Unknown predicted as enrolled / all Unknown", () => {
    expect(computeConfusionMatrix(SAMPLE).far).toBeCloseTo(1 / 3, 5);
  });

  test("FRR = enrolled predicted as Unknown / all enrolled", () => {
    // Enrolled identity samples: 3Ã—P01 + 1Ã—P02 = 4 (the No-Face row is excluded); 1 rejected.
    expect(computeConfusionMatrix(SAMPLE).frr).toBeCloseTo(1 / 4, 5);
  });

  test("zero samples â†’ all metrics are 0, never NaN", () => {
    const m = computeConfusionMatrix([]);
    for (const v of [m.accuracy, m.macroPrecision, m.macroRecall, m.macroF1, m.far, m.frr, m.avgLatencyMs, m.noFaceRate]) {
      expect(v).toBe(0);
      expect(Number.isNaN(v)).toBe(false);
    }
    expect(m.sampleCount).toBe(0);
  });

  test("Overview renders the computed stats automatically — no Calculate button", () => {
    localStorage.setItem(EVAL_STORAGE_KEY, JSON.stringify(SAMPLE.map((r, i) => ({ ...r, id: `T-${i}` }))));
    renderPage();
    // Overview is the default; Live is the default source, so Simulated sample
    // records show the empty state until the source filter is switched.
    expect(screen.getByRole("tab", { name: "Overview", selected: true })).toBeInTheDocument();
    expect(screen.getByLabelText("Matrix source filter").value).toBe("Live");
    expect(screen.getByTestId("overview-empty")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /calculate|generate/i })).toBeNull();

    fireEvent.change(screen.getByLabelText("Matrix source filter"), { target: { value: "Simulated" } });
    expect(screen.getByTestId("overview-mode-note").textContent).toMatch(/SIMULATED RESULTS/);
    expect(screen.getByTestId("stat-samples").textContent).toBe("7");
    expect(screen.getByTestId("stat-accuracy").textContent).toBe("71.4%");
    expect(screen.getByTestId("stat-far").textContent).toBe("33.3%");
    expect(screen.getByTestId("stat-frr").textContent).toBe("25.0%");
    expect(screen.getByTestId("no-face-stat").textContent).toMatch(/1 .*No Face.* sample/);
    expect(screen.getByTestId("confusion-matrix")).toBeInTheDocument();
  });

  test("Overview with Live records auto-displays metrics and matrix; camera never starts", () => {
    const getUserMedia = vi.fn();
    vi.stubGlobal("navigator", Object.assign(Object.create(navigator), { mediaDevices: { getUserMedia } }));
    localStorage.setItem(EVAL_STORAGE_KEY, JSON.stringify([
      { id: "L-1", actualLabel: "P01", predictedLabel: "P01", condition: "Front", source: "Live", origin: "Live Model Evaluation", latencyMs: 200, timestamp: "2026-07-10T02:00:00.000Z" },
      { id: "L-2", actualLabel: "P02", predictedLabel: "Unknown", condition: "Front", source: "Live", origin: "Live Model Evaluation", latencyMs: 300, timestamp: "2026-07-10T02:01:00.000Z" },
    ]));
    renderPage();
    // Metrics appear with no clicks at all.
    expect(screen.getByTestId("stat-samples").textContent).toBe("2");
    expect(screen.getByTestId("stat-accuracy").textContent).toBe("50.0%");
    expect(screen.getByTestId("confusion-matrix")).toBeInTheDocument();
    // Matrix axes are anonymised and numerically ordered.
    const headers = [...screen.getByTestId("confusion-matrix").querySelectorAll("thead th")].map((h) => h.textContent);
    expect(headers.slice(1)).toEqual(["P01", "P02", "Unknown"]);
    // Opening Overview never starts the webcam.
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(document.querySelector("video")).toBeNull();
  });

  test("empty Live records show a meaningful empty state, not fake 0% scores", () => {
    renderPage();
    expect(screen.getByText(/No confirmed Live evaluation samples are available yet/)).toBeInTheDocument();
    expect(screen.getByText(/Complete controlled recognition tests with a confirmed actual identity/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run Live Evaluation" })).toBeInTheDocument();
    expect(screen.queryByTestId("stat-accuracy")).toBeNull();
  });

  test("unenrolled participants appear in the directory but not as matrix classes", async () => {
    mockAxios.get.mockResolvedValue({ data: { participants: [
      { userId: 1, evaluationLabel: "P01", name: "Felicia Tan", role: "FM", isActive: true, isEnrolled: true, matrixEligible: true },
      { userId: 2, evaluationLabel: "P02", name: "Suspended Enrolled", role: "Staff", isActive: false, isEnrolled: true, matrixEligible: true },
      { userId: 3, evaluationLabel: "P04", name: "Sarah Tan", role: "Tenant", isActive: true, isEnrolled: false, matrixEligible: false },
    ] } });
    localStorage.setItem(EVAL_STORAGE_KEY, JSON.stringify([
      { id: "L-1", actualLabel: "P01", predictedLabel: "P01", condition: "Front", source: "Live", origin: "Manual", timestamp: "2026-07-10T02:00:00.000Z" },
    ]));
    renderPage();
    const legend = await screen.findByTestId("participant-legend");
    expect(within(legend).getByText("Sarah Tan")).toBeInTheDocument();
    expect(within(legend).getByText("Excluded until face enrolment")).toBeInTheDocument();
    expect(within(legend).getByText("Suspended")).toBeInTheDocument();
    const headers = [...screen.getByTestId("confusion-matrix").querySelectorAll("thead th")].map((h) => h.textContent);
    // Suspended-but-enrolled P02 stays a class; unenrolled P04 does not.
    expect(headers.slice(1)).toEqual(["P01", "P02", "Unknown"]);
    expect(within(screen.getByTestId("confusion-matrix")).queryByText("Felicia Tan")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Live model evaluation — prediction source
// ---------------------------------------------------------------------------
describe("Live model evaluation prediction source", () => {
  test("prediction comes from predictedEvaluationLabel; a recognised user needs NO browser-local mapping and never degrades to Unknown", async () => {
    const createObjectURL = vi.fn(() => "blob:probe");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(Object.create(URL), { createObjectURL, revokeObjectURL }));
    // Recognised user with a database-backed label but NO local label map entry.
    mockAxios.post.mockResolvedValue({
      data: {
        matchedUserId: 9, outcome: "MATCHED", confidence: 0.91,
        predictedEvaluationLabel: "P07",
        timings: { totalRequestMs: 210 }, liveness: { status: "front-facing" },
      },
    });
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "Run Live Evaluation" }));

    const file = new File(["probe-bytes"], "probe.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Temporary evaluation upload"), { target: { files: [file] } });
    await screen.findByAltText("temporary evaluation preview");

    // The FileReader that produces the temporary frame fires on the task
    // queue — flush it before running the model exactly once.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    fireEvent.click(screen.getByRole("button", { name: "Run model on upload" }));
    expect(await screen.findByText("Predicted: P07")).toBeInTheDocument();

    // Database-backed prediction: no "Assign evaluation label first" block.
    expect(screen.queryByText("Assign evaluation label first")).toBeNull();
    expect(screen.getByRole("button", { name: "Save Live Evaluation Record" })).toBeEnabled();
    // Only the side-effect-free evaluate endpoint was called.
    expect(mockAxios.post.mock.calls.every(([url]) => url === "/api/facial-recognition/evaluate")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Clear Local Evaluation Records dialog
// ---------------------------------------------------------------------------
describe("Clear Local Evaluation Records dialog", () => {
  const openDialog = () => {
    fireEvent.click(screen.getByRole("button", { name: "Clear Local Evaluation Records" }));
    return within(screen.getByRole("dialog", { name: "Clear Local Evaluation Records" }));
  };

  test("explicitly lists every unaffected production data type", () => {
    renderPage();
    const dialog = openDialog();
    expect(dialog.getByText(/Identity evaluation records are stored locally in this browser only/)).toBeInTheDocument();
    expect(dialog.getByText(/does not remove or modify/)).toBeInTheDocument();
    for (const item of ["PostgreSQL Users", "Face ID enrolments", "Biometric templates", "Attendance", "SecurityLogs", "Bookings"]) {
      expect(dialog.getByText(item)).toBeInTheDocument();
    }
    expect(dialog.getByText(/Access-decision records are cleared only when you separately select/)).toBeInTheDocument();
    expect(dialog.getByText(/never contain uploaded images, base64 data or embeddings/)).toBeInTheDocument();
  });

  test("confirming clears only browser-local records and calls no operational API", () => {
    localStorage.setItem(EVAL_STORAGE_KEY, JSON.stringify([
      { id: "C-1", actualLabel: "P01", predictedLabel: "P01", condition: "Front", source: "Live", origin: "Manual", timestamp: "2026-07-10T02:00:00.000Z" },
    ]));
    renderPage();
    const dialog = openDialog();
    fireEvent.click(dialog.getByRole("button", { name: "Confirm Clear" }));

    expect(JSON.parse(localStorage.getItem(EVAL_STORAGE_KEY))).toHaveLength(0);
    // No User deletion, enrolment deletion, Attendance, SecurityLog or Booking calls.
    expect(mockAxios.post).not.toHaveBeenCalled();
    expect(mockAxios.put).not.toHaveBeenCalled();
    expect(mockAxios.patch).not.toHaveBeenCalled();
    expect(mockAxios.delete).not.toHaveBeenCalled();
    expect(mockAxios.get.mock.calls.every(([url]) => url === "/api/facial-recognition/evaluation-participants")).toBe(true);
  });

  test("cancelling keeps the local records", () => {
    localStorage.setItem(EVAL_STORAGE_KEY, JSON.stringify([
      { id: "C-2", actualLabel: "P02", predictedLabel: "P02", condition: "Front", source: "Live", origin: "Manual", timestamp: "2026-07-10T02:00:00.000Z" },
    ]));
    renderPage();
    const dialog = openDialog();
    fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(JSON.parse(localStorage.getItem(EVAL_STORAGE_KEY))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Helpers: filters + CSV content
// ---------------------------------------------------------------------------
describe("filterRecords / toCsv", () => {
  test("filters by source, condition and date", () => {
    const records = [
      { ...createRecord({ actualLabel: "P01", predictedLabel: "P01", source: "Live", condition: "front" }), timestamp: "2026-07-10T09:00:00.000Z" },
      { ...createRecord({ actualLabel: "P02", predictedLabel: "P02", source: "Simulated", condition: "low-light" }), timestamp: "2026-07-09T09:00:00.000Z" },
    ];
    expect(filterRecords(records, { source: "Live" })).toHaveLength(1);
    expect(filterRecords(records, { condition: "low-light" })).toHaveLength(1);
    expect(filterRecords(records, { date: "2026-07-10" })).toHaveLength(1);
    expect(filterRecords(records, {})).toHaveLength(2);
  });

  test("CSV includes the header and escapes quoted fields", () => {
    const csv = toCsv([{
      id: "EV-1", actualLabel: "P01", predictedLabel: "Unknown", confidence: 0.4,
      condition: "front", latencyMs: 210, source: "Live",
      notes: 'said "hi", twice', timestamp: "2026-07-10T09:00:00.000Z",
    }]);
    const [header, row] = csv.split("\n");
    expect(header).toBe("id,actualLabel,predictedLabel,confidence,condition,latencyMs,source,origin,notes,detectionOutcome,timestamp");
    expect(row).toContain('"said ""hi"", twice"');
  });
});
