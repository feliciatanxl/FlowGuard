// Backend tests for GET /api/edge/config — live MonitoringZone config for a SecurePi
// edge device, authenticated with the edge token. Lets a website zone change reach the Pi.
const request = require("supertest");
const express = require("express");

process.env.EDGE_INGEST_TOKEN = "test-edge-token";

const mockMonitoringZone = { findByPk: jest.fn(), findOne: jest.fn() };
const mockCamera = { findOne: jest.fn() };

jest.mock("../../models", () => ({
  DetectionAlert: { findOne: jest.fn() },
  IncidentLog: { create: jest.fn() },
  MonitoringZone: mockMonitoringZone,
  Camera: mockCamera,
  sequelize: { transaction: jest.fn(async (fn) => fn({})) },
}));

const edgeRouter = require("../../routes/edgeDetectionAlerts");
const app = express();
app.use(express.json());
app.use("/api/edge", edgeRouter);

const zone = (over = {}) => ({
  toJSON: () => ({
    id: 3,
    zone_name: "Kitchen",
    detection_enabled: true,
    detection_type: "pest_detection",
    monitored_classes: JSON.stringify(["person", "backpack", "handbag", "suitcase", "rat", "mouse"]),
    unattended_threshold_seconds: 300,
    alert_cooldown_seconds: 30,
    severity: "High",
    time_threshold: 5,
    ...over,
  }),
});

describe("GET /api/edge/config", () => {
  beforeEach(() => jest.clearAllMocks());

  test("rejects missing bearer token (401)", async () => {
    const res = await request(app).get("/api/edge/config?zone_id=3");
    expect(res.status).toBe(401);
  });

  test("returns 503 when EDGE_INGEST_TOKEN is unconfigured", async () => {
    const saved = process.env.EDGE_INGEST_TOKEN;
    delete process.env.EDGE_INGEST_TOKEN;
    try {
      const res = await request(app)
        .get("/api/edge/config?zone_id=3")
        .set("Authorization", "Bearer test-edge-token");
      expect(res.status).toBe(503);
    } finally {
      process.env.EDGE_INGEST_TOKEN = saved;
    }
  });

  test("returns the zone config by zone_id (200)", async () => {
    mockMonitoringZone.findByPk.mockResolvedValue(zone());
    const res = await request(app)
      .get("/api/edge/config?zone_id=3&device_id=securepi-kitchen-01")
      .set("Authorization", "Bearer test-edge-token");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      zone_id: 3,
      zone_name: "Kitchen",
      detection_enabled: true,
      detection_type: "pest_detection",
      unattended_threshold_seconds: 300,
      alert_cooldown_seconds: 30,
      severity: "High",
      device_id: "securepi-kitchen-01",
    }));
    expect(res.body.monitored_classes).toEqual(["person", "backpack", "handbag", "suitcase", "rat", "mouse"]);
  });

  test("reports a disabled zone (detection_enabled:false)", async () => {
    mockMonitoringZone.findByPk.mockResolvedValue(zone({ detection_enabled: false }));
    const res = await request(app)
      .get("/api/edge/config?zone_id=3")
      .set("Authorization", "Bearer test-edge-token");
    expect(res.status).toBe(200);
    expect(res.body.detection_enabled).toBe(false);
  });

  test("falls back to time_threshold (minutes) when unattended seconds is null", async () => {
    mockMonitoringZone.findByPk.mockResolvedValue(zone({ unattended_threshold_seconds: null, time_threshold: 5 }));
    const res = await request(app)
      .get("/api/edge/config?zone_id=3")
      .set("Authorization", "Bearer test-edge-token");
    expect(res.body.unattended_threshold_seconds).toBe(300); // 5 min * 60
  });

  test("resolves the zone via camera_location when no zone_id/zone_name (200)", async () => {
    mockMonitoringZone.findByPk.mockImplementation(async (id) => (id === 7 ? zone({ id: 7 }) : null));
    mockCamera.findOne.mockResolvedValue({ id: 1, zone_id: 7 });
    const res = await request(app)
      .get("/api/edge/config?camera_location=Kitchen%20Camera%2001")
      .set("Authorization", "Bearer test-edge-token");
    expect(res.status).toBe(200);
    expect(mockCamera.findOne).toHaveBeenCalled();
    expect(res.body.zone_id).toBe(7);
  });

  test("returns 404 when no zone matches the device/zone/camera (invalid mapping)", async () => {
    mockMonitoringZone.findByPk.mockResolvedValue(null);
    mockMonitoringZone.findOne.mockResolvedValue(null);
    mockCamera.findOne.mockResolvedValue(null);
    const res = await request(app)
      .get("/api/edge/config?zone_id=999")
      .set("Authorization", "Bearer test-edge-token");
    expect(res.status).toBe(404);
  });
});
