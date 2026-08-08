const request = require("supertest");
const express = require("express");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const os = require("os");
const path = require("path");

// --- Mocks for @google-cloud/storage ---
const mockSave = jest.fn().mockResolvedValue([{}]);
const mockDownload = jest.fn().mockResolvedValue([Buffer.from([0xff, 0xd8, 0xff, 0xd9])]);
const mockDelete = jest.fn().mockResolvedValue([{}]);
const mockFile = jest.fn().mockImplementation((objectName) => ({
  save: mockSave,
  download: mockDownload,
  delete: mockDelete,
}));
const mockBucket = jest.fn().mockImplementation((bucketName) => ({
  file: mockFile,
}));
const mockStorage = jest.fn().mockImplementation(() => ({
  bucket: mockBucket,
}));

jest.mock("@google-cloud/storage", () => ({
  Storage: mockStorage,
}));

// --- Database & Models Mocks ---
const mockDetectionAlert = {
  create: jest.fn(),
  findByPk: jest.fn(),
  findAll: jest.fn(),
  destroy: jest.fn(),
  findOne: jest.fn(),
};
const mockIncidentLog = {
  create: jest.fn(),
  findByPk: jest.fn(),
  destroy: jest.fn(),
};
const mockMonitoringZone = { findOne: jest.fn() };
const mockCamera = { findOne: jest.fn() };
const mockTx = { id: "tx" };
const mockSequelize = { transaction: jest.fn(async (fn) => fn(mockTx)) };

jest.mock("../models", () => ({
  DetectionAlert: mockDetectionAlert,
  IncidentLog: mockIncidentLog,
  MonitoringZone: mockMonitoringZone,
  Camera: mockCamera,
  sequelize: mockSequelize,
}));

process.env.APP_SECRET = "test-secret";
process.env.EDGE_INGEST_TOKEN = "test-edge-token";
process.env.AI_SERVICE_KEY = "test-service-key";

const edgeDetectionAlertsRouter = require("../routes/edgeDetectionAlerts");
const detectionAlertsRouter = require("../routes/detectionAlerts");
const snapshotStorage = require("../utils/detectionSnapshotStorage");
const { createDetectionAlertRetentionTask } = require("../services/detectionAlertRetention");

const app = express();
app.use(express.json());
app.use("/api/edge", edgeDetectionAlertsRouter);
app.use("/api/detection-alerts", detectionAlertsRouter);

const fmToken = jwt.sign({ id: 1, role: "FM" }, process.env.APP_SECRET);
const staffToken = jwt.sign({ id: 2, role: "Staff" }, process.env.APP_SECRET);
const tenantToken = jwt.sign({ id: 3, role: "Tenant" }, process.env.APP_SECRET);

const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const testUuid = "550e8400-e29b-41d4-a716-446655440000";
const testFilename = `${testUuid}.jpg`;

const primeCreateMocks = () => {
  mockMonitoringZone.findOne.mockResolvedValue(null);
  mockCamera.findOne.mockResolvedValue(null);
  const created = { id: 9, snapshot_url: null };
  created.update = jest.fn(async (fields) => {
    Object.assign(created, fields);
  });
  mockDetectionAlert.create.mockResolvedValue(created);
  mockIncidentLog.create.mockResolvedValue({ id: 77 });
  return created;
};

describe("GCS Detection Snapshot Storage & API Suite", () => {
  const originalBucket = process.env.DETECTION_SNAPSHOT_BUCKET;
  const originalPrefix = process.env.DETECTION_SNAPSHOT_PREFIX;
  const originalDir = process.env.DETECTION_SNAPSHOT_DIR;
  const tempDir = path.join(os.tmpdir(), `flowguard-gcs-test-${Date.now()}`);

  beforeEach(() => {
    jest.clearAllMocks();
    snapshotStorage.resetStorageClient();
    process.env.DETECTION_SNAPSHOT_BUCKET = "flowguard-staging-snapshots-590663319889";
    process.env.DETECTION_SNAPSHOT_PREFIX = "detection-snapshots";
    process.env.DETECTION_SNAPSHOT_DIR = tempDir;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalBucket === undefined) delete process.env.DETECTION_SNAPSHOT_BUCKET;
    else process.env.DETECTION_SNAPSHOT_BUCKET = originalBucket;
    if (originalPrefix === undefined) delete process.env.DETECTION_SNAPSHOT_PREFIX;
    else process.env.DETECTION_SNAPSHOT_PREFIX = originalPrefix;
    if (originalDir === undefined) delete process.env.DETECTION_SNAPSHOT_DIR;
    else process.env.DETECTION_SNAPSHOT_DIR = originalDir;
  });

  test("1 & 2. Uploads JPEG directly to GCS object with contentType image/jpeg", async () => {
    primeCreateMocks();
    const res = await request(app)
      .post("/api/edge/detection-alerts")
      .set("Authorization", "Bearer test-edge-token")
      .field("zone_name", "Loading Bay")
      .field("camera_location", "Cam 01")
      .field("alert_type", "Pest Detection")
      .field("object_class", "rat")
      .field("severity", "High")
      .attach("snapshot", jpegBytes, { filename: "pest.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(201);
    expect(mockBucket).toHaveBeenCalledWith("flowguard-staging-snapshots-590663319889");
    expect(mockFile).toHaveBeenCalledWith(expect.stringMatching(/^detection-snapshots\/[0-9a-f-]{36}\.jpg$/));
    expect(mockSave).toHaveBeenCalledWith(
      jpegBytes,
      expect.objectContaining({
        contentType: "image/jpeg",
        resumable: false,
        metadata: { contentType: "image/jpeg" },
      })
    );
  });

  test("3 & 4. DetectionAlert.snapshot_url remains protected FlowGuard API URL without public GCS URL", async () => {
    const created = primeCreateMocks();
    const res = await request(app)
      .post("/api/edge/detection-alerts")
      .set("Authorization", "Bearer test-edge-token")
      .field("zone_name", "Loading Bay")
      .field("camera_location", "Cam 01")
      .field("alert_type", "Unattended Object")
      .attach("snapshot", jpegBytes, { filename: "box.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(201);
    expect(created.snapshot_url).toMatch(/^\/api\/detection-alerts\/9\/snapshot\/[0-9a-f-]{36}\.jpg$/);
    expect(created.snapshot_url).not.toContain("storage.googleapis.com");
    expect(created.snapshot_url).not.toContain("flowguard-staging-snapshots");
    expect(JSON.stringify(res.body)).not.toContain("storage.googleapis.com");
  });

  test("5. Authenticated snapshot GET reads image from GCS", async () => {
    const snapshotUrl = `/api/detection-alerts/9/snapshot/${testFilename}`;
    mockDetectionAlert.findByPk.mockResolvedValue({ id: 9, snapshot_url: snapshotUrl });
    mockDownload.mockResolvedValueOnce([jpegBytes]);

    const res = await request(app)
      .get(snapshotUrl)
      .set("Authorization", `Bearer ${staffToken}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^image\/jpeg/);
    expect(res.body).toEqual(jpegBytes);
    expect(mockBucket).toHaveBeenCalledWith("flowguard-staging-snapshots-590663319889");
    expect(mockFile).toHaveBeenCalledWith(`detection-snapshots/${testFilename}`);
    expect(mockDownload).toHaveBeenCalled();
  });

  test("6. Unauthorized users cannot fetch snapshots (401 unauth, 403 Tenant)", async () => {
    const snapshotUrl = `/api/detection-alerts/9/snapshot/${testFilename}`;

    const res401 = await request(app).get(snapshotUrl);
    expect(res401.status).toBe(401);

    const res403 = await request(app)
      .get(snapshotUrl)
      .set("Authorization", `Bearer ${tenantToken}`);
    expect(res403.status).toBe(403);
  });

  test("7. Mismatched alert ID or filename cannot access another alert's image", async () => {
    const validUrl = `/api/detection-alerts/9/snapshot/${testFilename}`;
    mockDetectionAlert.findByPk.mockResolvedValue({ id: 9, snapshot_url: validUrl });

    // Wrong filename in param
    const wrongFileRes = await request(app)
      .get(`/api/detection-alerts/9/snapshot/11111111-2222-4333-8444-555555555555.jpg`)
      .set("Authorization", `Bearer ${fmToken}`);
    expect(wrongFileRes.status).toBe(404);

    // Wrong alert ID in path
    mockDetectionAlert.findByPk.mockResolvedValue({ id: 10, snapshot_url: `/api/detection-alerts/10/snapshot/${testFilename}` });
    const wrongAlertRes = await request(app)
      .get(`/api/detection-alerts/9/snapshot/${testFilename}`)
      .set("Authorization", `Bearer ${fmToken}`);
    expect(wrongAlertRes.status).toBe(404);
  });

  test("8. Invalid filename format remains rejected", async () => {
    const badFilenameRes = await request(app)
      .get("/api/detection-alerts/9/snapshot/../escape.jpg")
      .set("Authorization", `Bearer ${fmToken}`);
    expect(badFilenameRes.status).toBe(404);
    expect(mockDetectionAlert.findByPk).not.toHaveBeenCalled();
  });

  test("9. Missing GCS object returns safe 404", async () => {
    const snapshotUrl = `/api/detection-alerts/9/snapshot/${testFilename}`;
    mockDetectionAlert.findByPk.mockResolvedValue({ id: 9, snapshot_url: snapshotUrl });
    mockDownload.mockRejectedValueOnce({ code: 404, message: "No such object" });

    const res = await request(app)
      .get(snapshotUrl)
      .set("Authorization", `Bearer ${fmToken}`);

    expect(res.status).toBe(404);
    expect(res.text).toBe("Not Found");
  });

  test("10. GCS errors do not leak internal details (bucket/credentials/stack trace)", async () => {
    const snapshotUrl = `/api/detection-alerts/9/snapshot/${testFilename}`;
    mockDetectionAlert.findByPk.mockResolvedValue({ id: 9, snapshot_url: snapshotUrl });
    const sensitiveErr = new Error("GCS Error: AccessDenied for gs://flowguard-staging-snapshots-590663319889/secret-path");
    sensitiveErr.code = 403;
    mockDownload.mockRejectedValueOnce(sensitiveErr);

    const res = await request(app)
      .get(snapshotUrl)
      .set("Authorization", `Bearer ${fmToken}`);

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/flowguard-staging-snapshots|secret-path|AccessDenied/i);
  });

  test("11. Edge retries preserve edge_event_id idempotency", async () => {
    primeCreateMocks();
    mockDetectionAlert.findOne.mockResolvedValue(null);

    // First request
    const firstRes = await request(app)
      .post("/api/edge/detection-alerts")
      .set("Authorization", "Bearer test-edge-token")
      .send({
        event_id: "edge-event-unique-01",
        zone_name: "Loading Bay",
        camera_location: "Cam 01",
        alert_type: "Restricted-Zone Motion",
      });
    expect(firstRes.status).toBe(201);
    expect(mockDetectionAlert.create).toHaveBeenCalledTimes(1);

    // Second request (retried event)
    const existingRow = {
      id: 9,
      edge_event_id: "edge-event-unique-01",
      whatsapp_status: "Skipped",
      toJSON: () => ({ id: 9, edge_event_id: "edge-event-unique-01" }),
    };
    mockDetectionAlert.findOne.mockResolvedValue(existingRow);

    const secondRes = await request(app)
      .post("/api/edge/detection-alerts")
      .set("Authorization", "Bearer test-edge-token")
      .send({
        event_id: "edge-event-unique-01",
        zone_name: "Loading Bay",
        camera_location: "Cam 01",
        alert_type: "Restricted-Zone Motion",
      });

    expect(secondRes.status).toBe(200);
    expect(secondRes.body.whatsapp).toEqual(expect.objectContaining({ duplicate: true }));
    expect(mockDetectionAlert.create).toHaveBeenCalledTimes(1);
  });

  test("12. GCS upload failure does not duplicate alert, incident, or WhatsApp", async () => {
    primeCreateMocks();
    mockSave.mockRejectedValueOnce(new Error("GCS network timeout"));
    const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});

    try {
      const res = await request(app)
        .post("/api/edge/detection-alerts")
        .set("Authorization", "Bearer test-edge-token")
        .field("zone_name", "Loading Bay")
        .field("camera_location", "Cam 01")
        .attach("snapshot", jpegBytes, { filename: "pest.jpg", contentType: "image/jpeg" });

      expect(res.status).toBe(201);
      expect(mockDetectionAlert.create).toHaveBeenCalledTimes(1);
      expect(mockIncidentLog.create).toHaveBeenCalledTimes(1);
      expect(res.body.snapshot_url).toBeNull();
      expect(errorLog).toHaveBeenCalledWith("[Edge] Snapshot persistence failed:", expect.any(Error));
    } finally {
      errorLog.mockRestore();
    }
  });

  test("13. Local /tmp fallback works when DETECTION_SNAPSHOT_BUCKET is unset", async () => {
    delete process.env.DETECTION_SNAPSHOT_BUCKET;
    snapshotStorage.resetStorageClient();

    const created = primeCreateMocks();
    const res = await request(app)
      .post("/api/edge/detection-alerts")
      .set("Authorization", "Bearer test-edge-token")
      .field("zone_name", "Loading Bay")
      .field("camera_location", "Cam 01")
      .attach("snapshot", jpegBytes, { filename: "local.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(201);
    expect(mockSave).not.toHaveBeenCalled();
    expect(created.snapshot_url).toMatch(/^\/api\/detection-alerts\/9\/snapshot\/[0-9a-f-]{36}\.jpg$/);
    const filename = created.snapshot_url.split("/").pop();
    expect(fs.existsSync(path.join(tempDir, filename))).toBe(true);
  });

  test("14. Retention purge deletes exact corresponding GCS object", async () => {
    const snapshotUrl = `/api/detection-alerts/15/snapshot/${testFilename}`;
    mockDetectionAlert.findAll.mockResolvedValue([
      { id: 15, snapshot_url: snapshotUrl },
    ]);
    mockDetectionAlert.destroy.mockResolvedValue(1);

    const task = createDetectionAlertRetentionTask({
      DetectionAlert: mockDetectionAlert,
      Op: { lt: Symbol("lt") },
      logger: { log: jest.fn(), error: jest.fn() },
    });

    await task.purgeStaleLogs();

    expect(mockDetectionAlert.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ attributes: ["id", "snapshot_url"], paranoid: false })
    );
    expect(mockBucket).toHaveBeenCalledWith("flowguard-staging-snapshots-590663319889");
    expect(mockFile).toHaveBeenCalledWith(`detection-snapshots/${testFilename}`);
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDetectionAlert.destroy).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
  });

  test("15. Human / animal / object alert severity derivation remains unchanged", async () => {
    primeCreateMocks();
    // Pest alert -> High
    const pestRes = await request(app)
      .post("/api/edge/detection-alerts")
      .set("Authorization", "Bearer test-edge-token")
      .send({
        zone_name: "Food Prep",
        camera_location: "Kitchen Cam",
        alert_type: "Pest Detection",
        object_class: "rat",
      });
    expect(pestRes.status).toBe(201);
    expect(mockDetectionAlert.create.mock.calls[0][0].severity).toBe("High");

    // Suspicious unknown person restricted motion -> Critical
    primeCreateMocks();
    const personRes = await request(app)
      .post("/api/edge/detection-alerts")
      .set("Authorization", "Bearer test-edge-token")
      .send({
        zone_name: "Server Room",
        camera_location: "Rack 01",
        alert_type: "Restricted-Zone Motion",
        person_name: "Unknown Person",
        identity_status: "SUSPICIOUS",
      });
    expect(personRes.status).toBe(201);
    expect(mockDetectionAlert.create.mock.calls[1][0].severity).toBe("Critical");

    // Unattended package 65s -> Low (<120s)
    primeCreateMocks();
    const pkgRes = await request(app)
      .post("/api/edge/detection-alerts")
      .set("Authorization", "Bearer test-edge-token")
      .send({
        zone_name: "Lobby",
        camera_location: "Lobby Cam",
        alert_type: "Unattended Object",
        duration_seconds: 65,
      });
    expect(pkgRes.status).toBe(201);
    expect(mockDetectionAlert.create.mock.calls[2][0].severity).toBe("Low");
  });
});
