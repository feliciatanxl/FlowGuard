// Backend tests for the Incident API surfacing the linked DetectionAlert, so the
// Incident side panel can show the rich edge fields (object_class such as `rat`,
// confidence, device_id, zone, snapshot). Must remain compatible with incidents that
// have NO linked detection alert (manual / facial-recognition / legacy).
const request = require("supertest");
const express = require("express");
const jwt = require("jsonwebtoken");

process.env.APP_SECRET = "test-secret";

const mockIncidentLog = { findAll: jest.fn(), findByPk: jest.fn() };
const mockDetectionAlert = { findOne: jest.fn() };

jest.mock("../../models", () => ({
  IncidentLog: mockIncidentLog,
  DetectionAlert: mockDetectionAlert,
  sequelize: { transaction: jest.fn(async (fn) => fn({})) },
}));

const incidentRouter = require("../../routes/incident");
const app = express();
app.use(express.json());
app.use("/api/incident", incidentRouter);

const fmToken = jwt.sign({ id: 1, role: "FM" }, process.env.APP_SECRET);
const auth = { Authorization: `Bearer ${fmToken}` };

const ratAlert = {
  id: 55, object_class: "rat", alert_type: "Pest Detection", confidence: 0.92,
  zone_name: "Kitchen", camera_location: "Kitchen Camera 01", device_id: "securepi-kitchen-01",
  source: "SecurePi Edge Node", snapshot_url: "https://cloud.example/api/edge/snapshots/edge_abc.jpg",
  occurred_at: "2026-07-29T08:46:00.000Z",
};

describe("GET /api/incident (with linked DetectionAlert)", () => {
  beforeEach(() => jest.clearAllMocks());

  test("eager-loads the DetectionAlert association", async () => {
    mockIncidentLog.findAll.mockResolvedValue([]);
    await request(app).get("/api/incident").set(auth);
    const opts = mockIncidentLog.findAll.mock.calls[0][0];
    expect(opts.include).toEqual(
      expect.arrayContaining([expect.objectContaining({ as: "detectionAlert" })])
    );
  });

  test("returns the nested detectionAlert (rat details) to the client", async () => {
    mockIncidentLog.findAll.mockResolvedValue([
      { id: 1, status: "PEST_DETECTION", source: "SecurePi Edge Node", camera_location: "Kitchen Camera 01", detectionAlert: ratAlert },
    ]);
    const res = await request(app).get("/api/incident").set(auth);
    expect(res.status).toBe(200);
    expect(res.body[0].detectionAlert).toEqual(expect.objectContaining({
      object_class: "rat", confidence: 0.92, device_id: "securepi-kitchen-01", zone_name: "Kitchen",
    }));
  });

  test("still returns incidents that have NO linked detection alert", async () => {
    mockIncidentLog.findAll.mockResolvedValue([
      { id: 2, status: "UNAUTHORIZED_ACCESS", source: "Facial Recognition", detectionAlert: null },
    ]);
    const res = await request(app).get("/api/incident").set(auth);
    expect(res.status).toBe(200);
    expect(res.body[0].detectionAlert).toBeNull();   // face incident renders fine
  });

  test("GET /:id also includes the association", async () => {
    mockIncidentLog.findByPk.mockResolvedValue({ id: 1, status: "PEST_DETECTION", detectionAlert: ratAlert });
    const res = await request(app).get("/api/incident/1").set(auth);
    expect(res.status).toBe(200);
    const opts = mockIncidentLog.findByPk.mock.calls[0][1];
    expect(opts.include).toEqual(
      expect.arrayContaining([expect.objectContaining({ as: "detectionAlert" })])
    );
    expect(res.body.detectionAlert.object_class).toBe("rat");
  });
});
