// Backend tests for incident_logs.resolvedAt — the timestamp backing the Incident
// Dashboard's Deep Analytics MTTR chart. PATCH /api/incident/:id must stamp it the
// first time an incident enters a terminal resolutionStatus (Cleared / False
// Positive), never re-stamp an already-resolved incident, and clear it back to null
// if the incident is later reopened to a non-terminal status. Also covers 'False
// Positive' being accepted as a resolutionStatus and deliberately NOT mirrored onto
// the linked DetectionAlert's status (it has no analog there).
const request = require("supertest");
const express = require("express");
const jwt = require("jsonwebtoken");

process.env.APP_SECRET = "test-secret";

const mockIncidentLog = {
  findAll: jest.fn(),
  findByPk: jest.fn(),
  create: jest.fn(),
};
const mockDetectionAlert = {
  findOne: jest.fn(),
};
const mockTx = { id: "tx" };
const mockSequelize = { transaction: jest.fn(async (fn) => fn(mockTx)) };

jest.mock("../../models", () => ({
  IncidentLog: mockIncidentLog,
  DetectionAlert: mockDetectionAlert,
  sequelize: mockSequelize,
}));

const incidentRouter = require("../../routes/incident");

const app = express();
app.use(express.json());
app.use("/api/incident", incidentRouter);

const fmToken = jwt.sign({ id: 1, role: "FM" }, process.env.APP_SECRET);

const makeIncidentInstance = (overrides = {}) => ({
  id: 1,
  resolutionStatus: "Active",
  severity: "Medium",
  person_name: null,
  notes: "",
  resolvedAt: null,
  update: jest.fn().mockResolvedValue(),
  destroy: jest.fn().mockResolvedValue(),
  ...overrides,
});

const makeAlertInstance = (overrides = {}) => ({
  id: 9,
  incident_log_id: 1,
  status: "Active",
  update: jest.fn().mockResolvedValue(),
  destroy: jest.fn().mockResolvedValue(),
  ...overrides,
});

describe("PATCH /api/incident/:id — resolvedAt stamping", () => {
  beforeEach(() => jest.clearAllMocks());

  test("entering Cleared from an unresolved incident stamps resolvedAt", async () => {
    const incident = makeIncidentInstance({ resolutionStatus: "Investigating", resolvedAt: null });
    mockIncidentLog.findByPk.mockResolvedValue(incident);
    mockDetectionAlert.findOne.mockResolvedValue(null);

    const res = await request(app)
      .patch("/api/incident/1")
      .set("Authorization", `Bearer ${fmToken}`)
      .send({ resolutionStatus: "Cleared" });

    expect(res.status).toBe(200);
    expect(incident.update.mock.calls[0][0].resolvedAt).toBeInstanceOf(Date);
  });

  test("entering False Positive from an unresolved incident stamps resolvedAt", async () => {
    const incident = makeIncidentInstance({ resolutionStatus: "Active", resolvedAt: null });
    mockIncidentLog.findByPk.mockResolvedValue(incident);
    mockDetectionAlert.findOne.mockResolvedValue(null);

    const res = await request(app)
      .patch("/api/incident/1")
      .set("Authorization", `Bearer ${fmToken}`)
      .send({ resolutionStatus: "False Positive" });

    expect(res.status).toBe(200);
    expect(incident.update.mock.calls[0][0].resolvedAt).toBeInstanceOf(Date);
  });

  test("re-saving an already-Cleared incident does not re-stamp resolvedAt", async () => {
    const existing = new Date("2026-08-01T00:00:00Z");
    const incident = makeIncidentInstance({ resolutionStatus: "Cleared", resolvedAt: existing });
    mockIncidentLog.findByPk.mockResolvedValue(incident);
    mockDetectionAlert.findOne.mockResolvedValue(null);

    const res = await request(app)
      .patch("/api/incident/1")
      .set("Authorization", `Bearer ${fmToken}`)
      .send({ resolutionStatus: "Cleared", notes: "double-checked" });

    expect(res.status).toBe(200);
    expect(incident.update.mock.calls[0][0]).not.toHaveProperty("resolvedAt");
  });

  test("reopening a Cleared incident back to Investigating clears resolvedAt", async () => {
    const existing = new Date("2026-08-01T00:00:00Z");
    const incident = makeIncidentInstance({ resolutionStatus: "Cleared", resolvedAt: existing });
    mockIncidentLog.findByPk.mockResolvedValue(incident);
    mockDetectionAlert.findOne.mockResolvedValue(null);

    const res = await request(app)
      .patch("/api/incident/1")
      .set("Authorization", `Bearer ${fmToken}`)
      .send({ resolutionStatus: "Investigating" });

    expect(res.status).toBe(200);
    expect(incident.update.mock.calls[0][0].resolvedAt).toBeNull();
  });

  test("a resolutionStatus-less update (e.g. notes only) never touches resolvedAt", async () => {
    const incident = makeIncidentInstance({ resolutionStatus: "Active", resolvedAt: null });
    mockIncidentLog.findByPk.mockResolvedValue(incident);
    mockDetectionAlert.findOne.mockResolvedValue(null);

    const res = await request(app)
      .patch("/api/incident/1")
      .set("Authorization", `Bearer ${fmToken}`)
      .send({ notes: "Reviewed footage, no issue." });

    expect(res.status).toBe(200);
    expect(incident.update.mock.calls[0][0]).not.toHaveProperty("resolvedAt");
  });
});

describe("PATCH /api/incident/:id — 'False Positive' status", () => {
  beforeEach(() => jest.clearAllMocks());

  test("'False Positive' is accepted as a valid resolutionStatus (200, not 400)", async () => {
    const incident = makeIncidentInstance();
    mockIncidentLog.findByPk.mockResolvedValue(incident);
    mockDetectionAlert.findOne.mockResolvedValue(null);

    const res = await request(app)
      .patch("/api/incident/1")
      .set("Authorization", `Bearer ${fmToken}`)
      .send({ resolutionStatus: "False Positive" });

    expect(res.status).toBe(200);
    expect(incident.update.mock.calls[0][0]).toEqual(
      expect.objectContaining({ resolutionStatus: "False Positive" })
    );
  });

  test("an invalid resolutionStatus is still rejected (400) before any update runs", async () => {
    const incident = makeIncidentInstance();
    mockIncidentLog.findByPk.mockResolvedValue(incident);

    const res = await request(app)
      .patch("/api/incident/1")
      .set("Authorization", `Bearer ${fmToken}`)
      .send({ resolutionStatus: "Not A Real Status" });

    expect(res.status).toBe(400);
    expect(incident.update).not.toHaveBeenCalled();
  });

  test("'False Positive' is never mirrored onto the linked DetectionAlert's status (no analog exists)", async () => {
    const incident = makeIncidentInstance();
    const alert = makeAlertInstance();
    mockIncidentLog.findByPk.mockResolvedValue(incident);
    mockDetectionAlert.findOne.mockResolvedValue(alert);

    const res = await request(app)
      .patch("/api/incident/1")
      .set("Authorization", `Bearer ${fmToken}`)
      .send({ resolutionStatus: "False Positive" });

    expect(res.status).toBe(200);
    expect(alert.update).not.toHaveBeenCalled();
  });

  test("'False Positive' plus a severity change still updates the alert's severity, just not its status", async () => {
    const incident = makeIncidentInstance();
    const alert = makeAlertInstance();
    mockIncidentLog.findByPk.mockResolvedValue(incident);
    mockDetectionAlert.findOne.mockResolvedValue(alert);

    const res = await request(app)
      .patch("/api/incident/1")
      .set("Authorization", `Bearer ${fmToken}`)
      .send({ resolutionStatus: "False Positive", severity: "Low" });

    expect(res.status).toBe(200);
    expect(alert.update).toHaveBeenCalledWith({ severity: "Low" }, { transaction: mockTx });
  });
});
