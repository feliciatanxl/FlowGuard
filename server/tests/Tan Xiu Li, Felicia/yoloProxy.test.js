// Backend tests - /api/yolo proxy + AI-service auth headers.
// The AI service is deployed PRIVATE on Cloud Run, so the browser can never
// call FastAPI's YOLO endpoints directly: object-detection traffic flows
// Browser -> Node (JWT/RBAC) -> AI service (Google ID token + service key).
// These tests cover the proxy's RBAC, field whitelisting, error mapping, and
// the aiServiceHeaders helper's local-vs-Cloud-Run behaviour.
const request = require("supertest");
const express = require("express");
const jwt = require("jsonwebtoken");

const mockUser = { findByPk: jest.fn() };
jest.mock("../../models", () => ({ User: mockUser }));

const mockAxios = { post: jest.fn(), get: jest.fn() };
jest.mock("axios", () => mockAxios);

process.env.APP_SECRET = "test-secret";
process.env.FACE_AI_URL = "http://fake-ai:8501";
process.env.AI_SERVICE_KEY = "test-ai-key";
delete process.env.K_SERVICE; // simulate local development (not Cloud Run)
delete process.env.AI_ID_TOKEN;

const yoloRouter = require("../../routes/yolo");
const { aiServiceHeaders, shouldUseIdToken, audienceFor, _clearTokenCache } = require("../../services/aiServiceAuth");

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use("/api/yolo", yoloRouter);

const fmToken = jwt.sign({ id: 1, role: "FM" }, process.env.APP_SECRET);
const staffToken = jwt.sign({ id: 60, role: "Staff" }, process.env.APP_SECRET);
const tenantToken = jwt.sign({ id: 9, role: "Tenant" }, process.env.APP_SECRET);

const FRAME = "data:image/jpeg;base64,dGVzdA==";

const AUTH_USERS = {
  1: { id: 1, role: "FM", isActive: true },
  60: { id: 60, role: "Staff", isActive: true },
  9: { id: 9, role: "Tenant", isActive: true },
};
const primeDb = () => {
  mockUser.findByPk.mockImplementation((id) => Promise.resolve(AUTH_USERS[id] ?? null));
};

describe("GET /api/yolo/people-count - RBAC", () => {
  beforeEach(() => { jest.clearAllMocks(); primeDb(); });

  test("unauthenticated -> 401, AI never called", async () => {
    const res = await request(app).get("/api/yolo/people-count");
    expect(res.status).toBe(401);
    expect(mockAxios.get).not.toHaveBeenCalled();
  });

  test("Tenant -> 403 (FM/Staff only, same as the detection-alert dashboards)", async () => {
    const res = await request(app)
      .get("/api/yolo/people-count")
      .set("Authorization", `Bearer ${tenantToken}`);
    expect(res.status).toBe(403);
    expect(mockAxios.get).not.toHaveBeenCalled();
  });

  test("Staff -> 200, forwards to FastAPI with the service key", async () => {
    mockAxios.get.mockResolvedValue({ data: { count: 3, detection_active: true, camera_status: "browser_camera" } });
    const res = await request(app)
      .get("/api/yolo/people-count")
      .set("Authorization", `Bearer ${staffToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 3, detection_active: true, camera_status: "browser_camera" });
    expect(mockAxios.get).toHaveBeenCalledWith(
      "http://fake-ai:8501/api/yolo/people-count",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-AI-Service-Key": "test-ai-key" })
      })
    );
  });

  test("AI offline -> controlled 503", async () => {
    mockAxios.get.mockRejectedValue({ code: "ECONNREFUSED" });
    const res = await request(app)
      .get("/api/yolo/people-count")
      .set("Authorization", `Bearer ${fmToken}`);
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/offline/i);
  });
});

describe("POST /api/yolo/analyze-frame - validation & forwarding", () => {
  beforeEach(() => { jest.clearAllMocks(); primeDb(); });

  test("non-data-URL image -> 400, AI never called", async () => {
    const res = await request(app)
      .post("/api/yolo/analyze-frame")
      .set("Authorization", `Bearer ${fmToken}`)
      .send({ image: "not-an-image" });
    expect(res.status).toBe(400);
    expect(mockAxios.post).not.toHaveBeenCalled();
  });

  test("non-raster and malformed image data URLs -> 400, AI never called", async () => {
    for (const image of ["data:image/svg+xml;base64,PHN2Zy8+", "data:image/jpeg,not-base64"]) {
      const res = await request(app)
        .post("/api/yolo/analyze-frame")
        .set("Authorization", `Bearer ${fmToken}`)
        .send({ image });
      expect(res.status).toBe(400);
    }
    expect(mockAxios.post).not.toHaveBeenCalled();
  });

  test("invalid camera or zone identifiers -> 400, AI never called", async () => {
    for (const body of [
      { image: FRAME, camera_id: 0 },
      { image: FRAME, zone_id: "not-an-id" },
    ]) {
      const res = await request(app)
        .post("/api/yolo/analyze-frame")
        .set("Authorization", `Bearer ${fmToken}`)
        .send(body);
      expect(res.status).toBe(400);
    }
    expect(mockAxios.post).not.toHaveBeenCalled();
  });

  test("forwards ONLY whitelisted fields (image/camera_id/zone_id/source)", async () => {
    mockAxios.post.mockResolvedValue({ data: { count: 1, detections: [] } });
    await request(app)
      .post("/api/yolo/analyze-frame")
      .set("Authorization", `Bearer ${fmToken}`)
      .send({ image: FRAME, camera_id: 4, zone_id: 2, source: "Browser Webcam", evil_extra: "x" });
    expect(mockAxios.post).toHaveBeenCalledWith(
      "http://fake-ai:8501/api/yolo/analyze-frame",
      { image: FRAME, camera_id: 4, zone_id: 2, source: "Browser Webcam" },
      expect.objectContaining({
        headers: expect.objectContaining({ "X-AI-Service-Key": "test-ai-key" })
      })
    );
  });

  test("omits camera/zone/source when not supplied (legacy global fallback)", async () => {
    mockAxios.post.mockResolvedValue({ data: { count: 0, detections: [] } });
    await request(app)
      .post("/api/yolo/analyze-frame")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ image: FRAME });
    expect(mockAxios.post).toHaveBeenCalledWith(
      "http://fake-ai:8501/api/yolo/analyze-frame",
      { image: FRAME },
      expect.anything()
    );
  });

  test("passes the AI response through (annotation payload is identity-free)", async () => {
    const aiPayload = { count: 2, detections: [{ type: "person", box: [1, 2, 3, 4] }], camera_status: "browser_camera" };
    mockAxios.post.mockResolvedValue({ data: aiPayload });
    const res = await request(app)
      .post("/api/yolo/analyze-frame")
      .set("Authorization", `Bearer ${fmToken}`)
      .send({ image: FRAME });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(aiPayload);
  });

  test("AI 400 (bad image) passes through as 400; other AI errors -> 502", async () => {
    mockAxios.post.mockRejectedValue({ response: { status: 400 } });
    const bad = await request(app)
      .post("/api/yolo/analyze-frame")
      .set("Authorization", `Bearer ${fmToken}`)
      .send({ image: FRAME });
    expect(bad.status).toBe(400);

    mockAxios.post.mockRejectedValue({ response: { status: 500 } });
    const boom = await request(app)
      .post("/api/yolo/analyze-frame")
      .set("Authorization", `Bearer ${fmToken}`)
      .send({ image: FRAME });
    expect(boom.status).toBe(502);
  });
});

describe("aiServiceHeaders - private Cloud Run authentication", () => {
  beforeEach(() => { jest.clearAllMocks(); _clearTokenCache(); });

  test("local development (no K_SERVICE): service key only, metadata server never contacted", async () => {
    const headers = await aiServiceHeaders("http://fake-ai:8501", { AI_SERVICE_KEY: "k" });
    expect(headers).toEqual({ "X-AI-Service-Key": "k" });
    expect(mockAxios.get).not.toHaveBeenCalled();
  });

  test("on Cloud Run (K_SERVICE set): fetches a metadata ID token for the service-URL audience", async () => {
    // Minimal JWT with a far-future exp so the cache accepts it.
    const fakeJwt = ["e30", Buffer.from(JSON.stringify({ exp: 4102444800 })).toString("base64url"), "sig"].join(".");
    mockAxios.get.mockResolvedValue({ data: fakeJwt });

    const env = { AI_SERVICE_KEY: "k", K_SERVICE: "flowguard-server" };
    const headers = await aiServiceHeaders("https://flowguard-ai-xyz.asia-southeast1.run.app/user/track", env);

    expect(headers["X-AI-Service-Key"]).toBe("k");
    expect(headers["Authorization"]).toBe(`Bearer ${fakeJwt}`);
    expect(mockAxios.get).toHaveBeenCalledWith(
      expect.stringContaining("metadata.google.internal"),
      expect.objectContaining({
        params: { audience: "https://flowguard-ai-xyz.asia-southeast1.run.app" }, // origin only, path stripped
        headers: { "Metadata-Flavor": "Google" }
      })
    );

    // Second call within the token's lifetime is served from cache.
    await aiServiceHeaders("https://flowguard-ai-xyz.asia-southeast1.run.app", env);
    expect(mockAxios.get).toHaveBeenCalledTimes(1);
  });

  test("AI_ID_TOKEN=off disables the token even on Cloud Run", () => {
    expect(shouldUseIdToken({ K_SERVICE: "svc", AI_ID_TOKEN: "off" })).toBe(false);
    expect(shouldUseIdToken({})).toBe(false);
    expect(shouldUseIdToken({ AI_ID_TOKEN: "force" })).toBe(true);
    expect(shouldUseIdToken({ K_SERVICE: "svc" })).toBe(true);
  });

  test("audience is always the URL origin, never a path", () => {
    expect(audienceFor("https://ai.example.run.app/recognize")).toBe("https://ai.example.run.app");
    expect(audienceFor("http://127.0.0.1:8501")).toBe("http://127.0.0.1:8501");
  });
});
