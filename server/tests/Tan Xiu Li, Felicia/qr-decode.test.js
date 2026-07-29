// Server tests — Cloud QR decode PROXY (POST /api/qr/decode).
// The route forwards a still to the FastAPI OpenCV decoder and returns a
// CANDIDATE booking reference. It is FM-gated and NON-authoritative: it never
// verifies a booking, grants access, or writes GateAccessLog.
process.env.APP_SECRET = "test-secret";
process.env.FACE_AI_URL = "http://fake-ai:8501";
process.env.AI_SERVICE_KEY = "test-ai-key";

const jwt = require("jsonwebtoken");
const express = require("express");
const request = require("supertest");

const mockAxios = { post: jest.fn() };
jest.mock("axios", () => mockAxios);

// No real DB — verifyToken falls back to JWT-only decoding when User is absent.
jest.mock("../../models", () => ({}));

// Avoid any metadata-server call for the AI ID token; assert the key header is set.
jest.mock("../../services/aiServiceAuth", () => ({
  aiServiceHeaders: jest.fn().mockResolvedValue({ "X-AI-Service-Key": "test-ai-key" }),
}));

const qrRoutes = require("../../routes/qr");

const app = express();
app.use(express.json({ limit: "12mb" }));
app.use("/api/qr", qrRoutes);

const fmToken = jwt.sign({ id: 1, role: "FM" }, process.env.APP_SECRET);
const tenantToken = jwt.sign({ id: 2, role: "Tenant" }, process.env.APP_SECRET);
const IMG = "data:image/jpeg;base64,ZmFrZQ==";

beforeEach(() => {
  mockAxios.post.mockReset();
});

describe("POST /api/qr/decode — access control", () => {
  test("requires authentication", async () => {
    const res = await request(app).post("/api/qr/decode").send({ image: IMG });
    expect([401, 403]).toContain(res.status);
    expect(mockAxios.post).not.toHaveBeenCalled();
  });

  test("is FM-only (a Tenant is rejected)", async () => {
    const res = await request(app)
      .post("/api/qr/decode")
      .set("Authorization", `Bearer ${tenantToken}`)
      .send({ image: IMG });
    expect(res.status).toBe(403);
    expect(mockAxios.post).not.toHaveBeenCalled();
  });
});

describe("POST /api/qr/decode — validation", () => {
  test("rejects a missing / non-data-URL image (400)", async () => {
    const res = await request(app)
      .post("/api/qr/decode")
      .set("Authorization", `Bearer ${fmToken}`)
      .send({ image: "not-a-data-url" });
    expect(res.status).toBe(400);
    expect(res.body.bookingRef).toBeNull();
    expect(mockAxios.post).not.toHaveBeenCalled();
  });

  test("rejects an oversized payload (413) before forwarding", async () => {
    const huge = "data:image/jpeg;base64," + "A".repeat(8 * 1024 * 1024 + 16);
    const res = await request(app)
      .post("/api/qr/decode")
      .set("Authorization", `Bearer ${fmToken}`)
      .send({ image: huge });
    expect(res.status).toBe(413);
    expect(mockAxios.post).not.toHaveBeenCalled();
  });
});

describe("POST /api/qr/decode — forwarding + result", () => {
  test("forwards to the FastAPI decoder with the service key and returns the candidate", async () => {
    mockAxios.post.mockResolvedValue({
      data: { success: true, bookingRef: "FG-ABC123", decodeMs: 12, decoder: "opencv-cloud" },
    });
    const res = await request(app)
      .post("/api/qr/decode")
      .set("Authorization", `Bearer ${fmToken}`)
      .send({ image: IMG });

    expect(res.status).toBe(200);
    expect(res.body.bookingRef).toBe("FG-ABC123");
    // Forwarded to the AI service's QR path with the shared-secret header.
    expect(mockAxios.post).toHaveBeenCalledWith(
      "http://fake-ai:8501/api/qr/decode",
      { image: IMG },
      expect.objectContaining({ headers: expect.objectContaining({ "X-AI-Service-Key": "test-ai-key" }) })
    );
  });

  test("is NON-authoritative: the response carries only a candidate, no access/approval fields", async () => {
    mockAxios.post.mockResolvedValue({
      data: { success: true, bookingRef: "FG-ABC123", decodeMs: 5, decoder: "opencv-cloud" },
    });
    const res = await request(app)
      .post("/api/qr/decode")
      .set("Authorization", `Bearer ${fmToken}`)
      .send({ image: IMG });
    expect(res.body).not.toHaveProperty("access");
    expect(res.body).not.toHaveProperty("reasonCode");
  });

  test("surfaces an AI-service 400 as a sanitized 400 (no upstream stack)", async () => {
    mockAxios.post.mockRejectedValue({ response: { status: 400, data: { detail: "Invalid image data." } } });
    const res = await request(app)
      .post("/api/qr/decode")
      .set("Authorization", `Bearer ${fmToken}`)
      .send({ image: IMG });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.bookingRef).toBeNull();
  });

  test("returns 503 (non-fatal) when the cloud decoder is unavailable", async () => {
    mockAxios.post.mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await request(app)
      .post("/api/qr/decode")
      .set("Authorization", `Bearer ${fmToken}`)
      .send({ image: IMG });
    expect(res.status).toBe(503);
    expect(res.body.bookingRef).toBeNull();
    expect(res.body.message).toMatch(/unavailable/i);
  });
});
