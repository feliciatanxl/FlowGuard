// Backend tests for /api/edge/detection-alerts — SecurePi hardware ingest.
// Edge alerts are created atomically with a linked IncidentLog so they surface
// in the Incident Dashboard with the same severity.
const request = require("supertest");
const express = require("express");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.EDGE_INGEST_TOKEN = "test-edge-token";
process.env.APP_SECRET = "test-secret";
process.env.DETECTION_SNAPSHOT_DIR = path.join(os.tmpdir(), "flowguard-edge-alert-test-snapshots");
const originalSnapshotMaxBytes = process.env.DETECTION_SNAPSHOT_MAX_BYTES;
process.env.DETECTION_SNAPSHOT_MAX_BYTES = "16";

const mockDetectionAlert = {
  create: jest.fn(),
};
const mockIncidentLog = {
  create: jest.fn(),
  findAll: jest.fn(),
  findByPk: jest.fn(),
};
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

const importMkdirSyncSpy = jest.spyOn(fs, "mkdirSync");
const importMkdirSpy = jest.spyOn(fs.promises, "mkdir");
const edgeDetectionAlertsRouter = require("../../routes/edgeDetectionAlerts");
const importMkdirSyncCalls = importMkdirSyncSpy.mock.calls.length;
const importMkdirCalls = importMkdirSpy.mock.calls.length;
importMkdirSyncSpy.mockRestore();
importMkdirSpy.mockRestore();
// Mounted alongside the incident router so the test can confirm an edge-ingested
// incident is visible through the Incident Dashboard API.
const incidentRouter = require("../../routes/incident");

const app = express();
app.use(express.json());
app.use("/api/edge", edgeDetectionAlertsRouter);
app.use("/api/incident", incidentRouter);

const fmToken = jwt.sign({ id: 1, role: "FM" }, process.env.APP_SECRET);

const securePiPayload = {
  zone_name: "Loading Bay",
  camera_location: "Loading Bay Camera 01",
  alert_type: "Unattended Object",
  object_class: "package-like object",
  duration_seconds: 65,
  severity: "High",
  status: "Active",
  source: "SecurePi Edge Node",
  confidence: 0.87,
  snapshot_url: "alerts/loading-bay/event.jpg",
  device_id: "securepi-loading-bay-01",
  sensor_metadata: {
    motion: true,
    pir_ready: true,
    distance_cm: 42.5,
    object_close: false,
  },
  timestamp: "2026-07-09T08:15:00.000Z",
  ignored_extra: "does not break the API",
};

const primeCreateMocks = () => {
  mockMonitoringZone.findOne.mockResolvedValue(null);
  mockCamera.findOne.mockResolvedValue(null);
  const created = { id: 9 };
  created.update = jest.fn(async (fields) => {
    Object.assign(created, fields);
  });
  mockDetectionAlert.create.mockResolvedValue(created);
  mockIncidentLog.create.mockResolvedValue({ id: 77 });
  return created;
};

const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const snapshotFiles = () => fs.existsSync(process.env.DETECTION_SNAPSHOT_DIR)
  ? fs.readdirSync(process.env.DETECTION_SNAPSHOT_DIR)
  : [];
const uploadSnapshot = ({ filename = "edge.jpg", contentType = "image/jpeg", bytes = jpegBytes } = {}) => request(app)
  .post("/api/edge/detection-alerts")
  .set("Authorization", "Bearer test-edge-token")
  .field("zone_name", "Loading Bay")
  .field("camera_location", "Loading Bay Camera 01")
  .field("alert_type", "Pest Detection")
  .field("object_class", "rat")
  .field("severity", "High")
  .field("confidence", "0.87")
  .attach("snapshot", bytes, { filename, contentType });

// Superagent's high-level .attach() normalizes path separators in filenames.
// Build the multipart body directly so traversal metadata reaches Multer exactly
// as an attacker could send it over HTTP.
const uploadRawMultipartSnapshot = (filename) => {
  const boundary = "----flowguard-codeql-path-test";
  const field = (name, value) => Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
  );
  const body = Buffer.concat([
    field("zone_name", "Loading Bay"),
    field("camera_location", "Loading Bay Camera 01"),
    field("alert_type", "Pest Detection"),
    field("object_class", "rat"),
    field("severity", "High"),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="snapshot"; filename="${filename}"\r\nContent-Type: image/jpeg\r\n\r\n`
    ),
    jpegBytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return request(app)
    .post("/api/edge/detection-alerts")
    .set("Authorization", "Bearer test-edge-token")
    .set("Content-Type", `multipart/form-data; boundary=${boundary}`)
    .send(body);
};

describe("POST /api/edge/detection-alerts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.rmSync(process.env.DETECTION_SNAPSHOT_DIR, { recursive: true, force: true });
  });
  afterAll(() => {
    fs.rmSync(process.env.DETECTION_SNAPSHOT_DIR, { recursive: true, force: true });
    if (originalSnapshotMaxBytes === undefined) delete process.env.DETECTION_SNAPSHOT_MAX_BYTES;
    else process.env.DETECTION_SNAPSHOT_MAX_BYTES = originalSnapshotMaxBytes;
  });

  test("imports the edge route without creating a snapshot directory", () => {
    expect(importMkdirSyncCalls).toBe(0);
    expect(importMkdirCalls).toBe(0);
    expect(fs.existsSync(process.env.DETECTION_SNAPSHOT_DIR)).toBe(false);
  });

  test("rejects missing bearer token (401)", async () => {
    const res = await request(app)
      .post("/api/edge/detection-alerts")
      .send(securePiPayload);
    expect(res.status).toBe(401);
    expect(mockDetectionAlert.create).not.toHaveBeenCalled();
  });

  test("returns 503 when EDGE_INGEST_TOKEN is not configured", async () => {
    const saved = process.env.EDGE_INGEST_TOKEN;
    delete process.env.EDGE_INGEST_TOKEN;
    try {
      const res = await request(app)
        .post("/api/edge/detection-alerts")
        .set("Authorization", "Bearer test-edge-token")
        .send(securePiPayload);
      expect(res.status).toBe(503);
      expect(mockDetectionAlert.create).not.toHaveBeenCalled();
    } finally {
      process.env.EDGE_INGEST_TOKEN = saved;
    }
  });

  test("rejects wrong bearer token (401)", async () => {
    const res = await request(app)
      .post("/api/edge/detection-alerts")
      .set("Authorization", "Bearer wrong-token")
      .send(securePiPayload);
    expect(res.status).toBe(401);
    expect(mockDetectionAlert.create).not.toHaveBeenCalled();
  });

  test("accepts SecurePi alert metadata with EDGE_INGEST_TOKEN (201)", async () => {
    primeCreateMocks();
    const res = await request(app)
      .post("/api/edge/detection-alerts")
      .set("Authorization", "Bearer test-edge-token")
      .send(securePiPayload);
    expect(res.status).toBe(201);
    expect(mockDetectionAlert.create.mock.calls[0][0]).toEqual(expect.objectContaining({
      source: "SecurePi Edge Node",
      alert_type: "Unattended Object",
      object_class: "package-like object",
      severity: "High",
      confidence: 0.87,
      snapshot_url: null,
      device_id: "securepi-loading-bay-01",
      sensor_metadata: {
        motion: true,
        pir_ready: true,
        distance_cm: 42.5,
        object_close: false,
      },
      duration_seconds: 65,
    }));
    expect(mockDetectionAlert.create.mock.calls[0][0]).not.toHaveProperty("ignored_extra");
  });

  test("stores an uploaded JPEG as a protected snapshot URL", async () => {
    const created = primeCreateMocks();
    expect(fs.existsSync(process.env.DETECTION_SNAPSHOT_DIR)).toBe(false);
    const res = await uploadSnapshot({ filename: "pest_rat.jpeg" });

    expect(res.status).toBe(201);
    expect(fs.existsSync(process.env.DETECTION_SNAPSHOT_DIR)).toBe(true);
    expect(mockDetectionAlert.create.mock.calls[0][0].snapshot_url).toBeNull();
    expect(created.update).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot_url: expect.stringMatching(/^\/api\/detection-alerts\/9\/snapshot\/[0-9a-f-]{36}\.jpg$/),
      })
    );
    const storedFilename = created.snapshot_url.split("/").pop();
    expect(storedFilename).toMatch(/^[0-9a-f-]{36}\.jpg$/);
    expect(fs.readFileSync(path.join(process.env.DETECTION_SNAPSHOT_DIR, storedFilename))).toEqual(jpegBytes);
    expect(JSON.stringify(res.body)).not.toContain(process.env.DETECTION_SNAPSHOT_DIR);
    expect(JSON.stringify(res.body)).not.toMatch(/[A-Za-z]:\\|\/tmp\//);
  });

  test.each([
    ["parent traversal with forward slash", "../escape.jpg"],
    ["parent traversal with backslash", "..\\escape.jpg"],
    ["absolute Windows path", "C:\\temp\\escape.jpg"],
    ["absolute Unix path", "/tmp/escape.jpg"],
    ["encoded traversal", "%2e%2e%2fescape.jpg"],
    ["double-encoded traversal", "%252e%252e%252fescape.jpg"],
    ["nested forward-slash path", "nested/folder/escape.jpg"],
    ["nested backslash path", "nested\\folder\\escape.jpg"],
  ])("rejects %s multipart filename", async (_label, filename) => {
    const res = await uploadRawMultipartSnapshot(filename);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "snapshot filename is invalid." });
    expect(mockDetectionAlert.create).not.toHaveBeenCalled();
    expect(snapshotFiles()).toHaveLength(0);
  });

  test("rejects a non-JPEG extension even with a JPEG MIME type", async () => {
    const res = await uploadSnapshot({ filename: "edge.png", contentType: "image/jpeg" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "snapshot filename must use a .jpg or .jpeg extension." });
    expect(mockDetectionAlert.create).not.toHaveBeenCalled();
    expect(snapshotFiles()).toHaveLength(0);
  });

  test("rejects a non-JPEG MIME type even with a .jpg extension", async () => {
    const res = await uploadSnapshot({ filename: "edge.jpg", contentType: "image/png" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "snapshot must be a JPEG image." });
    expect(mockDetectionAlert.create).not.toHaveBeenCalled();
    expect(snapshotFiles()).toHaveLength(0);
  });

  test("rejects spoofed JPEG metadata when the bytes lack JPEG markers", async () => {
    const res = await uploadSnapshot({ filename: "edge.jpg", bytes: Buffer.from("not-a-jpeg") });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "snapshot content is not a valid JPEG image." });
    expect(mockDetectionAlert.create).not.toHaveBeenCalled();
    expect(snapshotFiles()).toHaveLength(0);
  });

  test("preserves the configured snapshot upload-size limit", async () => {
    const oversized = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      Buffer.alloc(16, 0x00),
      Buffer.from([0xff, 0xd9]),
    ]);
    const res = await uploadSnapshot({ bytes: oversized });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "snapshot exceeds the configured maximum size." });
    expect(mockDetectionAlert.create).not.toHaveBeenCalled();
    expect(snapshotFiles()).toHaveLength(0);
  });

  test("cleans the generated file when post-commit snapshot linking fails", async () => {
    const created = primeCreateMocks();
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    created.update.mockImplementation(async (fields) => {
      if (fields.snapshot_url) throw new Error("snapshot column unavailable at C:\\private\\db");
      Object.assign(created, fields);
    });
    try {
      const res = await uploadSnapshot();
      expect(res.status).toBe(201);
      expect(snapshotFiles()).toHaveLength(0);
      expect(JSON.stringify(res.body)).not.toMatch(/private|snapshot column|C:\\/i);
      expect(log).toHaveBeenCalledWith("[Edge] Snapshot persistence failed:", expect.any(Error));
    } finally {
      log.mockRestore();
    }
  });

  test("creates both records with matching severity, linked, in one transaction", async () => {
    const created = primeCreateMocks();
    const res = await request(app)
      .post("/api/edge/detection-alerts")
      .set("Authorization", "Bearer test-edge-token")
      .send({ ...securePiPayload, severity: undefined, duration_seconds: 400 });
    expect(res.status).toBe(201);
    // 400s with no explicit severity → High in BOTH records
    expect(mockDetectionAlert.create.mock.calls[0][0].severity).toBe("High");
    expect(mockIncidentLog.create.mock.calls[0][0].severity).toBe("High");
    expect(mockSequelize.transaction).toHaveBeenCalledTimes(1);
    expect(mockDetectionAlert.create.mock.calls[0][1]).toEqual({ transaction: mockTx });
    expect(mockIncidentLog.create.mock.calls[0][1]).toEqual({ transaction: mockTx });
    expect(created.update).toHaveBeenCalledWith({ incident_log_id: 77 }, { transaction: mockTx });
  });

  test("a person/crowd-count edge alert bridges to OVERCROWDING in the linked incident", async () => {
    primeCreateMocks();
    const res = await request(app)
      .post("/api/edge/detection-alerts")
      .set("Authorization", "Bearer test-edge-token")
      .send({ ...securePiPayload, alert_type: undefined, object_class: "Warning: 2 People Detected" });
    expect(res.status).toBe(201);
    expect(mockIncidentLog.create.mock.calls[0][0].status).toBe("OVERCROWDING");
  });

  test("incident creation failure rolls back the detection alert (500, shared transaction)", async () => {
    primeCreateMocks();
    const dbError = new Error("db down: incident_logs.private_column");
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockIncidentLog.create.mockRejectedValue(dbError);
    try {
      const res = await request(app)
        .post("/api/edge/detection-alerts")
        .set("Authorization", "Bearer test-edge-token")
        .send(securePiPayload);
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Unable to process the request.' });
      expect(JSON.stringify(res.body)).not.toMatch(/private_column|db down/i);
      expect(log).toHaveBeenCalledWith('Edge detection alert ingestion failed:', dbError);
      expect(mockDetectionAlert.create.mock.calls[0][1]).toEqual({ transaction: mockTx });
      expect(mockSequelize.transaction).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  });

  test("edge-ingested incident is visible through the Incident Dashboard API", async () => {
    primeCreateMocks();
    const ingest = await request(app)
      .post("/api/edge/detection-alerts")
      .set("Authorization", "Bearer test-edge-token")
      .send(securePiPayload);
    expect(ingest.status).toBe(201);

    // The dashboard lists whatever IncidentLog holds — return the row the bridge created.
    const bridged = mockIncidentLog.create.mock.calls[0][0];
    mockIncidentLog.findAll.mockResolvedValue([{ id: 77, ...bridged }]);
    const res = await request(app)
      .get("/api/incident")
      .set("Authorization", `Bearer ${fmToken}`);
    expect(res.status).toBe(200);
    expect(res.body[0]).toEqual(expect.objectContaining({
      camera_location: "Loading Bay Camera 01",
      severity: "High",
      source: "SecurePi Edge Node",
      resolutionStatus: "Active",
    }));
  });

  test("ignores a client-supplied source and always stamps SecurePi Edge Node on both records", async () => {
    primeCreateMocks();
    const res = await request(app)
      .post("/api/edge/detection-alerts")
      .set("Authorization", "Bearer test-edge-token")
      .send({ ...securePiPayload, source: "Browser Webcam" });
    expect(res.status).toBe(201);
    expect(mockDetectionAlert.create.mock.calls[0][0].source).toBe("SecurePi Edge Node");
    expect(mockIncidentLog.create.mock.calls[0][0].source).toBe("SecurePi Edge Node");
  });

  test("accepts VERIFIED person identity alert and defaults restricted motion to High severity", async () => {
    primeCreateMocks();
    const res = await request(app)
      .post("/api/edge/detection-alerts")
      .set("Authorization", "Bearer test-edge-token")
      .send({
        ...securePiPayload,
        alert_type: "Restricted-Zone Motion",
        object_class: "person",
        person_name: "Felicia",
        identity_status: "VERIFIED",
        person_role: "Staff",
        track_id: 3,
        severity: undefined,
      });
    expect(res.status).toBe(201);
    const createdAlert = mockDetectionAlert.create.mock.calls[0][0];
    expect(createdAlert.person_name).toBe("Felicia");
    expect(createdAlert.severity).toBe("High");
    expect(createdAlert.sensor_metadata).toEqual(expect.objectContaining({
      identity_status: "VERIFIED",
      person_role: "Staff",
      track_id: 3,
      person_name: "Felicia",
    }));
  });

  test("accepts SUSPICIOUS unknown person alert and defaults restricted motion to Critical severity", async () => {
    primeCreateMocks();
    const res = await request(app)
      .post("/api/edge/detection-alerts")
      .set("Authorization", "Bearer test-edge-token")
      .send({
        ...securePiPayload,
        alert_type: "Restricted-Zone Motion",
        object_class: "person",
        person_name: "Unknown Person",
        identity_status: "SUSPICIOUS",
        track_id: 7,
        severity: undefined,
      });
    expect(res.status).toBe(201);
    const createdAlert = mockDetectionAlert.create.mock.calls[0][0];
    expect(createdAlert.person_name).toBe("Unknown Person");
    expect(createdAlert.severity).toBe("Critical");
    expect(createdAlert.sensor_metadata.identity_status).toBe("SUSPICIOUS");
  });

  test("accepts SUSPENDED identity alert and sets Critical severity", async () => {
    primeCreateMocks();
    const res = await request(app)
      .post("/api/edge/detection-alerts")
      .set("Authorization", "Bearer test-edge-token")
      .send({
        ...securePiPayload,
        alert_type: "Restricted-Zone Motion",
        object_class: "person",
        person_name: "John Doe",
        identity_status: "SUSPENDED",
        person_role: "Driver",
        track_id: 12,
        severity: undefined,
      });
    expect(res.status).toBe(201);
    const createdAlert = mockDetectionAlert.create.mock.calls[0][0];
    expect(createdAlert.person_name).toBe("John Doe");
    expect(createdAlert.severity).toBe("Critical");
    expect(createdAlert.sensor_metadata.identity_status).toBe("SUSPENDED");
  });

  test("accepts UNAVAILABLE identity alert and preserves null person_name (never converted to UNKNOWN)", async () => {
    primeCreateMocks();
    const res = await request(app)
      .post("/api/edge/detection-alerts")
      .set("Authorization", "Bearer test-edge-token")
      .send({
        ...securePiPayload,
        alert_type: "Restricted-Zone Motion",
        object_class: "person",
        person_name: null,
        identity_status: "UNAVAILABLE",
        track_id: 2,
        severity: undefined,
      });
    expect(res.status).toBe(201);
    const createdAlert = mockDetectionAlert.create.mock.calls[0][0];
    expect(createdAlert.person_name).toBeNull();
    expect(createdAlert.severity).toBe("High");
    expect(createdAlert.sensor_metadata.identity_status).toBe("UNAVAILABLE");
    expect(mockIncidentLog.create.mock.calls[0][0].person_name).toBeNull();
  });

  test("rejects invalid severity (400)", async () => {
    const res = await request(app)
      .post("/api/edge/detection-alerts")
      .set("Authorization", "Bearer test-edge-token")
      .send({ ...securePiPayload, severity: "Emergency" });
    expect(res.status).toBe(400);
    expect(mockDetectionAlert.create).not.toHaveBeenCalled();
  });

  test("requires zone_name and camera_location (400)", async () => {
    const res = await request(app)
      .post("/api/edge/detection-alerts")
      .set("Authorization", "Bearer test-edge-token")
      .send({ object_class: "package-like object" });
    expect(res.status).toBe(400);
    expect(mockDetectionAlert.create).not.toHaveBeenCalled();
  });

  describe("Idempotent duplicate edge_event_id refresh", () => {
    test("duplicate edge_event_id with new JPEG refreshes snapshot_url and occurred_at timestamp", async () => {
      const existingAlert = {
        id: 99,
        edge_event_id: "evt-dup-100",
        snapshot_url: "/api/detection-alerts/99/snapshot/old-uuid.jpg",
        occurred_at: new Date("2026-08-01T10:00:00Z"),
        createdAt: new Date("2026-08-01T10:00:00Z"),
        whatsapp_status: "Sent",
        update: jest.fn().mockImplementation(async (fields) => {
          Object.assign(existingAlert, fields);
        }),
        toJSON: function() { return { ...this, update: undefined, toJSON: undefined }; },
      };
      mockDetectionAlert.findOne = jest.fn().mockResolvedValue(existingAlert);

      const newTimestamp = "2026-08-08T15:30:00.000Z";
      const res = await request(app)
        .post("/api/edge/detection-alerts")
        .set("Authorization", "Bearer test-edge-token")
        .field("event_id", "evt-dup-100")
        .field("zone_name", "Loading Bay")
        .field("camera_location", "Loading Bay Camera 01")
        .field("timestamp", newTimestamp)
        .attach("snapshot", jpegBytes, { filename: "new-evidence.jpg", contentType: "image/jpeg" });

      expect(res.status).toBe(200);
      expect(res.body.whatsapp.duplicate).toBe(true);
      expect(mockDetectionAlert.create).not.toHaveBeenCalled();
      expect(existingAlert.update).toHaveBeenCalledWith(expect.objectContaining({
        snapshot_url: expect.stringMatching(/^\/api\/detection-alerts\/99\/snapshot\/[0-9a-f-]{36}\.jpg$/),
        occurred_at: new Date(newTimestamp),
      }));
      expect(existingAlert.createdAt).toEqual(new Date("2026-08-01T10:00:00Z"));
    });

    test("duplicate edge_event_id without JPEG leaves snapshot_url and occurred_at unchanged", async () => {
      const existingAlert = {
        id: 99,
        edge_event_id: "evt-dup-200",
        snapshot_url: "/api/detection-alerts/99/snapshot/original.jpg",
        occurred_at: new Date("2026-08-01T10:00:00Z"),
        createdAt: new Date("2026-08-01T10:00:00Z"),
        whatsapp_status: "Sent",
        update: jest.fn(),
        toJSON: function() { return { ...this, update: undefined, toJSON: undefined }; },
      };
      mockDetectionAlert.findOne = jest.fn().mockResolvedValue(existingAlert);

      const res = await request(app)
        .post("/api/edge/detection-alerts")
        .set("Authorization", "Bearer test-edge-token")
        .send({
          event_id: "evt-dup-200",
          zone_name: "Loading Bay",
          camera_location: "Loading Bay Camera 01",
          timestamp: "2026-08-08T16:00:00.000Z",
        });

      expect(res.status).toBe(200);
      expect(res.body.whatsapp.duplicate).toBe(true);
      expect(existingAlert.update).not.toHaveBeenCalled();
      expect(existingAlert.snapshot_url).toBe("/api/detection-alerts/99/snapshot/original.jpg");
    });
  });
});
