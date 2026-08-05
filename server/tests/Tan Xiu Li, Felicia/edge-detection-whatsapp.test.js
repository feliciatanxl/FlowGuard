// Edge route (POST /api/edge/detection-alerts) — WhatsApp security notification +
// idempotency. Uses the REAL whatsappService (driven by env + a mocked global.fetch)
// over mocked models, so the whole edge -> DB -> WhatsApp path is exercised without a
// database or a real Meta call. Complements the existing Charlisa edge suite (which
// pins the pre-integration behaviour and still passes unchanged).
const request = require("supertest");
const express = require("express");

process.env.EDGE_INGEST_TOKEN = "test-edge-token";
process.env.APP_SECRET = "test-secret";

const mockDetectionAlert = { create: jest.fn(), findOne: jest.fn() };
const mockIncidentLog = { create: jest.fn() };
const mockMonitoringZone = { findOne: jest.fn() };
const mockCamera = { findOne: jest.fn() };
const mockTx = { id: "tx" };
const mockSequelize = { transaction: jest.fn(async (fn) => fn(mockTx)) };

jest.mock("../../models", () => ({
  DetectionAlert: mockDetectionAlert,
  IncidentLog: mockIncidentLog,
  MonitoringZone: mockMonitoringZone,
  Camera: mockCamera,
  sequelize: mockSequelize,
}));

const edgeRouter = require("../../routes/edgeDetectionAlerts");
const app = express();
app.use(express.json());
app.use("/api/edge", edgeRouter);

const WA_KEYS = [
  "WHATSAPP_ENABLED", "WHATSAPP_API_URL", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_DETECTION_ALERTS_ENABLED", "WHATSAPP_SECURITY_RECIPIENTS", "WHATSAPP_DETECTION_MIN_SEVERITY",
];
let waSnapshot;
let origFetch;

beforeEach(() => {
  jest.clearAllMocks();
  waSnapshot = {};
  WA_KEYS.forEach((k) => { waSnapshot[k] = process.env[k]; delete process.env[k]; });
  origFetch = global.fetch;
  // Default create/incident happy path.
  mockMonitoringZone.findOne.mockResolvedValue(null);
  mockCamera.findOne.mockResolvedValue(null);
  mockDetectionAlert.findOne.mockResolvedValue(null);
});

afterEach(() => {
  WA_KEYS.forEach((k) => { if (waSnapshot[k] === undefined) delete process.env[k]; else process.env[k] = waSnapshot[k]; });
  global.fetch = origFetch;
  jest.restoreAllMocks();
});

const okFetch = () =>
  jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.X" }] }) });

const enableRealWhatsapp = () => {
  process.env.WHATSAPP_ENABLED = "true";
  process.env.WHATSAPP_API_URL = "https://graph.facebook.com/v20.0";
  process.env.WHATSAPP_ACCESS_TOKEN = "EAAtoken1234567890";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "PNID123";
};

const primeCreated = (over = {}) => {
  const created = { id: 9, update: jest.fn().mockResolvedValue(), ...over };
  mockDetectionAlert.create.mockResolvedValue(created);
  mockIncidentLog.create.mockResolvedValue({ id: 77 });
  return created;
};

const post = (body) =>
  request(app).post("/api/edge/detection-alerts").set("Authorization", "Bearer test-edge-token").send(body);

const pestBody = (over = {}) => ({
  event_id: "securepi-test:pest_detection:1:20260729T090000Z",
  zone_name: "Kitchen", camera_location: "Kitchen Camera 01",
  alert_type: "Pest Detection", object_class: "rat", severity: "High",
  confidence: 0.92, device_id: "securepi-test", track_id: 1,
  timestamp: "2026-07-29T09:00:00Z", ...over,
});

describe("edge WhatsApp — alert always saves; status reflects the send", () => {
  test("detection alerts disabled -> 201, alert saved, status Not Requested, no send", async () => {
    const created = primeCreated();
    global.fetch = jest.fn();
    const res = await post(pestBody());
    expect(res.status).toBe(201);
    expect(mockDetectionAlert.create).toHaveBeenCalledTimes(1);
    expect(mockDetectionAlert.create.mock.calls[0][0].whatsapp_status).toBe("Not Requested");
    expect(mockDetectionAlert.create.mock.calls[0][0].edge_event_id).toBe(pestBody().event_id);
    expect(mockIncidentLog.create.mock.calls[0][0].status).toBe("PEST_DETECTION");
    expect(global.fetch).not.toHaveBeenCalled();
    expect(res.body.whatsapp.status).toBe("Not Requested");
    expect(res.body.id).toBe(created.id);
  });

  test("enabled but no recipients -> 201, status Skipped, no send", async () => {
    process.env.WHATSAPP_DETECTION_ALERTS_ENABLED = "true";
    primeCreated();
    global.fetch = jest.fn();
    const res = await post(pestBody());
    expect(res.status).toBe(201);
    expect(mockDetectionAlert.create.mock.calls[0][0].whatsapp_status).toBe("Skipped");
    expect(global.fetch).not.toHaveBeenCalled();
    expect(res.body.whatsapp.status).toBe("Skipped");
  });

  test("mock mode -> Simulated (status persisted, timestamp set)", async () => {
    process.env.WHATSAPP_DETECTION_ALERTS_ENABLED = "true";
    process.env.WHATSAPP_SECURITY_RECIPIENTS = "6590000000";
    const created = primeCreated();
    global.fetch = jest.fn(); // mock mode must not call the API
    const res = await post(pestBody());
    expect(res.status).toBe(201);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(res.body.whatsapp.status).toBe("Simulated");
    // Created 'Pending', then updated to Simulated with a sent_at timestamp.
    expect(mockDetectionAlert.create.mock.calls[0][0].whatsapp_status).toBe("Pending");
    const waUpdate = created.update.mock.calls.map(([arg]) => arg).find((a) => a.whatsapp_status);
    expect(waUpdate.whatsapp_status).toBe("Simulated");
    expect(waUpdate.whatsapp_sent_at).toBeInstanceOf(Date);
  });

  test("real send success -> Sent, posts to the security recipient (not a driver phone)", async () => {
    enableRealWhatsapp();
    process.env.WHATSAPP_DETECTION_ALERTS_ENABLED = "true";
    process.env.WHATSAPP_SECURITY_RECIPIENTS = "6591234567";
    const created = primeCreated();
    global.fetch = okFetch();
    const res = await post(pestBody());
    expect(res.status).toBe(201);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).to).toBe("6591234567");
    expect(res.body.whatsapp.status).toBe("Sent");
    const waUpdate = created.update.mock.calls.map(([a]) => a).find((a) => a.whatsapp_status);
    expect(waUpdate.whatsapp_status).toBe("Sent");
  });

  test("Meta API failure -> alert still 201, status Failed", async () => {
    enableRealWhatsapp();
    process.env.WHATSAPP_DETECTION_ALERTS_ENABLED = "true";
    process.env.WHATSAPP_SECURITY_RECIPIENTS = "6591234567";
    const created = primeCreated();
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: { message: "boom" } }) });
    const res = await post(pestBody());
    expect(res.status).toBe(201);
    expect(res.body.whatsapp.status).toBe("Failed");
    expect(res.body.whatsapp.error).toBe("Notification delivery failed.");
    expect(JSON.stringify(res.body.whatsapp)).not.toContain("boom");
    const waUpdate = created.update.mock.calls.map(([a]) => a).find((a) => a.whatsapp_status);
    expect(waUpdate.whatsapp_status).toBe("Failed");
  });

  test("severity threshold skips lower alerts -> Skipped, no send", async () => {
    process.env.WHATSAPP_DETECTION_ALERTS_ENABLED = "true";
    process.env.WHATSAPP_SECURITY_RECIPIENTS = "6590000000";
    process.env.WHATSAPP_DETECTION_MIN_SEVERITY = "Critical";
    primeCreated();
    global.fetch = jest.fn();
    const res = await post(pestBody({ severity: "High" }));
    expect(res.status).toBe(201);
    expect(res.body.whatsapp.status).toBe("Skipped");
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("edge idempotency — a retried event_id never duplicates", () => {
  test("duplicate of a Sent event -> 200, no create, no resend", async () => {
    process.env.WHATSAPP_DETECTION_ALERTS_ENABLED = "true";
    process.env.WHATSAPP_SECURITY_RECIPIENTS = "6590000000";
    mockDetectionAlert.findOne.mockResolvedValue({ id: 9, whatsapp_status: "Sent", update: jest.fn() });
    global.fetch = jest.fn();
    const res = await post(pestBody());
    expect(res.status).toBe(200);
    expect(mockDetectionAlert.create).not.toHaveBeenCalled();
    expect(mockIncidentLog.create).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(res.body.whatsapp).toEqual(expect.objectContaining({ duplicate: true, resent: false, status: "Sent" }));
  });

  test("duplicate of a Failed event -> one controlled retry, still no new create", async () => {
    enableRealWhatsapp();
    process.env.WHATSAPP_DETECTION_ALERTS_ENABLED = "true";
    process.env.WHATSAPP_SECURITY_RECIPIENTS = "6591234567";
    const existing = { id: 9, whatsapp_status: "Failed", update: jest.fn().mockResolvedValue() };
    mockDetectionAlert.findOne.mockResolvedValue(existing);
    global.fetch = okFetch();
    const res = await post(pestBody());
    expect(res.status).toBe(200);
    expect(mockDetectionAlert.create).not.toHaveBeenCalled();
    expect(mockIncidentLog.create).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(1); // the one permitted retry
    expect(res.body.whatsapp).toEqual(expect.objectContaining({ duplicate: true, resent: true, status: "Sent" }));
  });

  test("malformed event_id -> 400, nothing created", async () => {
    const res = await post(pestBody({ event_id: "bad id with spaces/and*chars" }));
    expect(res.status).toBe(400);
    expect(mockDetectionAlert.create).not.toHaveBeenCalled();
  });

  test("concurrent duplicate: unique-constraint violation recovers to the winning row (no 2nd create)", async () => {
    const existing = { id: 9, whatsapp_status: "Simulated", update: jest.fn() };
    // First lookup (pre-create) misses; create loses the race; recovery lookup finds the row.
    mockDetectionAlert.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(existing);
    const uniqueErr = new Error("duplicate key");
    uniqueErr.name = "SequelizeUniqueConstraintError";
    mockDetectionAlert.create.mockRejectedValue(uniqueErr);
    global.fetch = jest.fn();
    const res = await post(pestBody());
    expect(res.status).toBe(200);
    expect(mockDetectionAlert.create).toHaveBeenCalledTimes(1); // the losing attempt only
    expect(mockIncidentLog.create).not.toHaveBeenCalled();      // rolled back / never reached
    expect(global.fetch).not.toHaveBeenCalled();                // already Simulated -> no resend
    expect(res.body.whatsapp).toEqual(expect.objectContaining({ duplicate: true }));
  });

  test("restricted-motion edge alert bridges to RESTRICTED_MOTION incident", async () => {
    primeCreated();
    const res = await post(pestBody({ alert_type: "Restricted-Zone Motion", object_class: undefined, event_id: undefined }));
    expect(res.status).toBe(201);
    expect(mockIncidentLog.create.mock.calls[0][0].status).toBe("RESTRICTED_MOTION");
  });
});
