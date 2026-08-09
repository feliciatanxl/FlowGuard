// Backend tests for the /api/detection-alerts ingest RULES that decide what actually
// gets written — as opposed to detection-alerts.test.js, which covers authentication,
// the incident bridge, the lifecycle verbs, and snapshot retrieval.
//
// Covered here:
//   * event_id / cycle_id idempotency (a repeated event returns 200, never a 2nd row)
//   * type-aware default severity for every alert family
//   * sensor_metadata folding of identity/track/cycle fields
//   * the 'UNKNOWN' person convention on the linked incident
//   * confidence clamping and timestamp parsing
//   * list ordering by event time (COALESCE(occurred_at, createdAt))
//   * two snapshot authorisation paths not exercised elsewhere
const request = require("supertest");
const express = require("express");
const jwt = require("jsonwebtoken");

process.env.APP_SECRET = "test-secret";
process.env.AI_SERVICE_KEY = "test-service-key";
// Left unset/false so the notification branch is a no-op here — WhatsApp delivery has
// its own dedicated suites and must not make these assertions order-dependent.
delete process.env.WHATSAPP_DETECTION_ALERTS_ENABLED;

const mockDetectionAlert = {
  findAll: jest.fn(),
  findByPk: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
};
const mockIncidentLog = {
  findByPk: jest.fn(),
  create: jest.fn(),
};
const mockMonitoringZone = { findOne: jest.fn() };
const mockCamera = { findOne: jest.fn() };
const mockTx = { id: "tx" };
// fn/col are stubbed so the route takes its real ordering branch: the production
// order clause is only built when sequelize exposes fn(), otherwise it degrades to
// plain createdAt. Returning identifiable sentinels lets the test assert the shape.
const mockSequelize = {
  transaction: jest.fn(async (fn) => fn(mockTx)),
  fn: jest.fn((name, ...args) => ({ __fn: name, args })),
  col: jest.fn((name) => ({ __col: name })),
};

jest.mock("../../models", () => ({
  DetectionAlert: mockDetectionAlert,
  IncidentLog: mockIncidentLog,
  MonitoringZone: mockMonitoringZone,
  Camera: mockCamera,
  sequelize: mockSequelize,
}));

const detectionAlertsRouter = require("../../routes/detectionAlerts");

const app = express();
app.use(express.json());
app.use("/api/detection-alerts", detectionAlertsRouter);

const token = (role) => jwt.sign({ id: 1, role }, process.env.APP_SECRET);
const fmToken = token("FM");
const staffToken = token("Staff");

const basePayload = { zone_name: "Zone A", camera_location: "Loading Bay" };

const makeAlertInstance = (overrides = {}) => ({
  id: 1,
  incident_log_id: null,
  update: jest.fn().mockResolvedValue(),
  destroy: jest.fn().mockResolvedValue(),
  ...overrides,
});

// Happy-path create mocks. findOne defaults to "no prior event" so an idempotency
// lookup never accidentally short-circuits a test that isn't about idempotency.
const primeCreateMocks = () => {
  mockMonitoringZone.findOne.mockResolvedValue(null);
  mockCamera.findOne.mockResolvedValue(null);
  mockDetectionAlert.findOne.mockResolvedValue(null);
  const created = makeAlertInstance();
  mockDetectionAlert.create.mockResolvedValue(created);
  mockIncidentLog.create.mockResolvedValue({ id: 55 });
  return created;
};

// The route logs a line per ingest; silenced so the suite output stays readable.
let logSpy;
beforeAll(() => { logSpy = jest.spyOn(console, "log").mockImplementation(() => {}); });
afterAll(() => { logSpy.mockRestore(); });

const postAlert = (payload) => request(app)
  .post("/api/detection-alerts")
  .set("x-service-key", "test-service-key")
  .send({ ...basePayload, ...payload });

const alertArgs = () => mockDetectionAlert.create.mock.calls[0][0];
const incidentArgs = () => mockIncidentLog.create.mock.calls[0][0];

describe("POST /api/detection-alerts — event idempotency", () => {
  beforeEach(() => jest.clearAllMocks());

  test("a repeated event_id returns the existing alert with 200 and creates nothing", async () => {
    primeCreateMocks();
    const existing = { id: 42, edge_event_id: "cycle-7", zone_name: "Zone A" };
    mockDetectionAlert.findOne.mockResolvedValue(existing);

    const res = await postAlert({ event_id: "cycle-7" });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(42);
    expect(mockDetectionAlert.findOne).toHaveBeenCalledWith({ where: { edge_event_id: "cycle-7" } });
    expect(mockDetectionAlert.create).not.toHaveBeenCalled();
    expect(mockIncidentLog.create).not.toHaveBeenCalled();
    expect(mockSequelize.transaction).not.toHaveBeenCalled();
  });

  test("cycle_id is accepted as the idempotency key (the Security Camera page sends this)", async () => {
    primeCreateMocks();
    mockDetectionAlert.findOne.mockResolvedValue({ id: 43 });

    const res = await postAlert({ cycle_id: "inspection-99" });

    expect(res.status).toBe(200);
    expect(mockDetectionAlert.findOne).toHaveBeenCalledWith({ where: { edge_event_id: "inspection-99" } });
    expect(mockDetectionAlert.create).not.toHaveBeenCalled();
  });

  test("a cycle id nested in sensor_metadata is also honoured", async () => {
    primeCreateMocks();
    mockDetectionAlert.findOne.mockResolvedValue({ id: 44 });

    const res = await postAlert({ sensor_metadata: { cycle_id: "meta-cycle-3", pir: true } });

    expect(res.status).toBe(200);
    expect(mockDetectionAlert.findOne).toHaveBeenCalledWith({ where: { edge_event_id: "meta-cycle-3" } });
    expect(mockDetectionAlert.create).not.toHaveBeenCalled();
  });

  test("a first-time event_id is stored as edge_event_id and the alert is created (201)", async () => {
    primeCreateMocks();

    const res = await postAlert({ event_id: "cycle-8" });

    expect(res.status).toBe(201);
    expect(alertArgs().edge_event_id).toBe("cycle-8");
    expect(mockDetectionAlert.create).toHaveBeenCalledTimes(1);
  });

  test("an alert with no event id at all skips the lookup entirely and is created", async () => {
    primeCreateMocks();

    const res = await postAlert({});

    expect(res.status).toBe(201);
    expect(mockDetectionAlert.findOne).not.toHaveBeenCalled();
    expect(alertArgs().edge_event_id).toBeNull();
  });

  test("a failing idempotency lookup degrades to creating the alert, not a 500", async () => {
    primeCreateMocks();
    mockDetectionAlert.findOne.mockRejectedValue(new Error("index unavailable"));

    const res = await postAlert({ event_id: "cycle-9" });

    expect(res.status).toBe(201);
    expect(mockDetectionAlert.create).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/detection-alerts — type-aware default severity", () => {
  beforeEach(() => jest.clearAllMocks());

  // Each row: alert_type, extra payload, expected severity when the caller sends none.
  test.each([
    ["PEST_DETECTION", {}, "High"],
    ["Pest Detection", {}, "High"],
    ["RESTRICTED_MOTION", {}, "High"],
    ["RESTRICTED_MOTION", { identity_status: "SUSPICIOUS" }, "Critical"],
    ["RESTRICTED_MOTION", { identity_status: "SUSPENDED" }, "Critical"],
    ["RESTRICTED_MOTION", { person_name: "Unknown Person" }, "Critical"],
    ["FORGOTTEN_BELONGING", { duration_seconds: 120 }, "Medium"],
    ["FORGOTTEN_BELONGING", { duration_seconds: 300 }, "High"],
    ["ITEM_PICKED_UP", {}, "Medium"],
    ["ITEM_SET_DOWN", {}, "Medium"],
    ["ITEM_MOVEMENT", {}, "Medium"],
    ["UNATTENDED_OBJECT", { duration_seconds: 60 }, "Low"],
    ["UNATTENDED_OBJECT", { duration_seconds: 200 }, "Medium"],
    ["UNATTENDED_OBJECT", { duration_seconds: 400 }, "High"],
    ["UNATTENDED_OBJECT", { duration_seconds: 900 }, "Critical"],
  ])("%s %j defaults to %s on both records", async (alert_type, extra, expected) => {
    primeCreateMocks();

    const res = await postAlert({ alert_type, ...extra });

    expect(res.status).toBe(201);
    expect(alertArgs().severity).toBe(expected);
    expect(incidentArgs().severity).toBe(expected);
  });

  test("an explicit severity always wins over the type-aware default", async () => {
    primeCreateMocks();

    const res = await postAlert({ alert_type: "PEST_DETECTION", severity: "Low" });

    expect(res.status).toBe(201);
    expect(alertArgs().severity).toBe("Low");
    expect(incidentArgs().severity).toBe("Low");
  });

  test("an unrecognised alert_type falls back to duration-based severity", async () => {
    primeCreateMocks();

    const res = await postAlert({ alert_type: "Something New", duration_seconds: 700 });

    expect(res.status).toBe(201);
    expect(alertArgs().severity).toBe("Critical");
  });
});

describe("POST /api/detection-alerts — defaults and field normalisation", () => {
  beforeEach(() => jest.clearAllMocks());

  test("object_class and alert_type fall back to the shared ingest defaults", async () => {
    primeCreateMocks();

    const res = await postAlert({});

    expect(res.status).toBe(201);
    expect(alertArgs().object_class).toBe("package-like object");
    expect(alertArgs().alert_type).toBe("Unattended Object");
  });

  test("confidence above 1 is clamped rather than rejected", async () => {
    primeCreateMocks();
    const res = await postAlert({ confidence: 4.2 });
    expect(res.status).toBe(201);
    expect(alertArgs().confidence).toBe(1);
  });

  test("negative confidence is clamped to 0", async () => {
    primeCreateMocks();
    const res = await postAlert({ confidence: -0.5 });
    expect(res.status).toBe(201);
    expect(alertArgs().confidence).toBe(0);
  });

  test("a non-numeric confidence becomes null instead of failing the request", async () => {
    primeCreateMocks();
    const res = await postAlert({ confidence: "very sure" });
    expect(res.status).toBe(201);
    expect(alertArgs().confidence).toBeNull();
  });

  test("timestamp is preferred over occurred_at and parsed to a Date", async () => {
    primeCreateMocks();
    const res = await postAlert({
      timestamp: "2026-07-11T10:00:00.000Z",
      occurred_at: "2026-01-01T00:00:00.000Z",
    });
    expect(res.status).toBe(201);
    expect(alertArgs().occurred_at).toEqual(new Date("2026-07-11T10:00:00.000Z"));
  });

  test("an unparseable timestamp becomes null on this route (no server-time fallback)", async () => {
    primeCreateMocks();
    const res = await postAlert({ timestamp: "last Tuesday-ish" });
    expect(res.status).toBe(201);
    expect(alertArgs().occurred_at).toBeNull();
  });

  test("snapshot_path is accepted as an alias when snapshot_url is absent", async () => {
    primeCreateMocks();
    const res = await postAlert({ snapshot_path: "runtime/snapshots/event.jpg" });
    expect(res.status).toBe(201);
    expect(alertArgs().snapshot_url).toBe("runtime/snapshots/event.jpg");
  });
});

describe("POST /api/detection-alerts — sensor_metadata folding", () => {
  beforeEach(() => jest.clearAllMocks());

  test("identity, role, track, person and cycle fields are folded into sensor_metadata", async () => {
    primeCreateMocks();

    const res = await postAlert({
      event_id: "cycle-11",
      identity_status: "SUSPICIOUS",
      person_role: "Contractor",
      track_id: 7,
      person_name: "Jia Wei",
      sensor_metadata: { pir: true, distance_cm: 42.5 },
    });

    expect(res.status).toBe(201);
    expect(alertArgs().sensor_metadata).toEqual({
      pir: true,
      distance_cm: 42.5,
      identity_status: "SUSPICIOUS",
      person_role: "Contractor",
      track_id: 7,
      person_name: "Jia Wei",
      cycle_id: "cycle-11",
    });
  });

  test("values already present in sensor_metadata are never overwritten by top-level fields", async () => {
    primeCreateMocks();

    const res = await postAlert({
      identity_status: "SUSPICIOUS",
      track_id: 7,
      sensor_metadata: { identity_status: "KNOWN", track_id: 0 },
    });

    expect(res.status).toBe(201);
    expect(alertArgs().sensor_metadata).toEqual(
      expect.objectContaining({ identity_status: "KNOWN", track_id: 0 })
    );
  });

  test("identity fields alone still produce a sensor_metadata object", async () => {
    primeCreateMocks();

    const res = await postAlert({ identity_status: "SUSPICIOUS" });

    expect(res.status).toBe(201);
    expect(alertArgs().sensor_metadata).toEqual({ identity_status: "SUSPICIOUS" });
  });

  test("an alert with no sensor context stores null rather than an empty object", async () => {
    primeCreateMocks();

    const res = await postAlert({});

    expect(res.status).toBe(201);
    expect(alertArgs().sensor_metadata).toBeNull();
  });

  test("a non-object sensor_metadata is ignored rather than persisted verbatim", async () => {
    primeCreateMocks();

    const res = await postAlert({ sensor_metadata: "pir=true" });

    expect(res.status).toBe(201);
    expect(alertArgs().sensor_metadata).toBeNull();
  });
});

describe("POST /api/detection-alerts — person identity on the linked incident", () => {
  beforeEach(() => jest.clearAllMocks());

  test("a named person is mirrored onto the incident", async () => {
    primeCreateMocks();
    const res = await postAlert({ person_name: "Jia Wei" });
    expect(res.status).toBe(201);
    expect(incidentArgs().person_name).toBe("Jia Wei");
  });

  test("the literal 'UNKNOWN' is stored on the alert but not on the incident", async () => {
    primeCreateMocks();

    const res = await postAlert({ person_name: "UNKNOWN" });

    expect(res.status).toBe(201);
    expect(alertArgs().person_name).toBe("UNKNOWN");
    expect(incidentArgs().person_name).toBeNull();
  });

  test("the incident notes record the originating zone", async () => {
    primeCreateMocks();
    const res = await postAlert({});
    expect(res.status).toBe(201);
    expect(incidentArgs().notes).toBe("[Object Detection] Zone: Zone A");
  });

  test("a bridged incident never carries a facial-recognition confidence score", async () => {
    primeCreateMocks();
    const res = await postAlert({ confidence: 0.9 });
    expect(res.status).toBe(201);
    expect(incidentArgs().confidence_score).toBeNull();
    expect(incidentArgs().resolutionStatus).toBe("Active");
  });
});

describe("GET /api/detection-alerts — ordering and filtering", () => {
  beforeEach(() => jest.clearAllMocks());

  test("alerts are ordered by event time, falling back to row-creation time", async () => {
    mockDetectionAlert.findAll.mockResolvedValue([]);

    const res = await request(app)
      .get("/api/detection-alerts")
      .set("Authorization", `Bearer ${staffToken}`);

    expect(res.status).toBe(200);
    const options = mockDetectionAlert.findAll.mock.calls[0][0];
    expect(mockSequelize.fn).toHaveBeenCalledWith(
      "COALESCE",
      { __col: "occurred_at" },
      { __col: "createdAt" }
    );
    expect(options.order).toEqual([
      [{ __fn: "COALESCE", args: [{ __col: "occurred_at" }, { __col: "createdAt" }] }, "DESC"],
      ["createdAt", "DESC"],
    ]);
  });

  test("the list is capped at 50 rows", async () => {
    mockDetectionAlert.findAll.mockResolvedValue([]);
    await request(app).get("/api/detection-alerts").set("Authorization", `Bearer ${fmToken}`);
    expect(mockDetectionAlert.findAll.mock.calls[0][0].limit).toBe(50);
  });

  test("a status query param filters on an exact match", async () => {
    mockDetectionAlert.findAll.mockResolvedValue([]);
    await request(app)
      .get("/api/detection-alerts?status=Active")
      .set("Authorization", `Bearer ${fmToken}`);
    expect(mockDetectionAlert.findAll.mock.calls[0][0].where).toEqual({ status: "Active" });
  });

  test("no status param means no status filter", async () => {
    mockDetectionAlert.findAll.mockResolvedValue([]);
    await request(app).get("/api/detection-alerts").set("Authorization", `Bearer ${fmToken}`);
    expect(mockDetectionAlert.findAll.mock.calls[0][0].where).toEqual({});
  });
});

describe("GET /api/detection-alerts/:id/snapshot/:filename — remaining authorisation paths", () => {
  const filename = "123e4567-e89b-42d3-a456-426614174000.jpg";
  beforeEach(() => jest.clearAllMocks());

  test("an alert that never had a snapshot returns 404 without touching storage", async () => {
    mockDetectionAlert.findByPk.mockResolvedValue({ id: 4, snapshot_url: null });

    const res = await request(app)
      .get(`/api/detection-alerts/4/snapshot/${filename}`)
      .set("Authorization", `Bearer ${staffToken}`);

    expect(res.status).toBe(404);
  });

  test("an on-device edge path stored in snapshot_url is never served as a file", async () => {
    mockDetectionAlert.findByPk.mockResolvedValue({ id: 4, snapshot_url: "runtime/snapshots/event.jpg" });

    const res = await request(app)
      .get(`/api/detection-alerts/4/snapshot/${filename}`)
      .set("Authorization", `Bearer ${staffToken}`);

    expect(res.status).toBe(404);
  });

  test("a snapshot belonging to a DIFFERENT alert cannot be read through this alert's id", async () => {
    // Alert 4 exists, but its stored URL is scoped to alert 9 — the prefix check must
    // refuse it rather than serving another alert's evidence.
    mockDetectionAlert.findByPk.mockResolvedValue({
      id: 4,
      snapshot_url: `/api/detection-alerts/9/snapshot/${filename}`,
    });

    const res = await request(app)
      .get(`/api/detection-alerts/4/snapshot/${filename}`)
      .set("Authorization", `Bearer ${staffToken}`);

    expect(res.status).toBe(404);
  });

  test("a non-numeric alert id is refused before any database lookup", async () => {
    const res = await request(app)
      .get(`/api/detection-alerts/not-a-number/snapshot/${filename}`)
      .set("Authorization", `Bearer ${staffToken}`);

    expect(res.status).toBe(404);
    expect(mockDetectionAlert.findByPk).not.toHaveBeenCalled();
  });

  test("an unauthenticated snapshot request is rejected (401)", async () => {
    const res = await request(app).get(`/api/detection-alerts/4/snapshot/${filename}`);
    expect(res.status).toBe(401);
    expect(mockDetectionAlert.findByPk).not.toHaveBeenCalled();
  });
});
