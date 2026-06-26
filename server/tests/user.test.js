const request = require("supertest");
const express = require("express");

// Mock models BEFORE requiring the route
const mockUser = {
  findByPk: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  destroy: jest.fn(),
};

jest.mock("../models", () => ({
  User: mockUser,
  Attendance: { findAll: jest.fn(), destroy: jest.fn() },
  Invite: { findOne: jest.fn(), create: jest.fn() },
  SecurityLog: { update: jest.fn() },
}));

jest.mock("axios", () => ({
  post: jest.fn(() => Promise.resolve({ data: { vector: Array(512).fill(0.1) } })),
  get: jest.fn(() => Promise.resolve({ data: { message: "Staff list updated from database" } })),
}));

// Stable secret for JWT
process.env.APP_SECRET = "test-secret";

const jwt = require("jsonwebtoken");
const userRouter = require("../routes/user");

const app = express();
app.use(express.json());
app.use("/user", userRouter);

const fmPayload = { id: 99, role: "FM" };
const fmToken = jwt.sign(fmPayload, process.env.APP_SECRET);

describe("User routes", () => {
  beforeEach(() => jest.clearAllMocks());

  test("POST /user/enroll-face enrolls a face and triggers AI cache refresh", async () => {
    mockUser.findByPk.mockResolvedValue({ id: 99, role: "FM", isActive: true });
    mockUser.update.mockResolvedValue([1]);
    const axios = require("axios");
    const res = await request(app)
      .post("/user/enroll-face")
      .set("Authorization", `Bearer ${fmToken}`)
      .send({ images: { front: "a", left: "b", right: "c" } });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/successful/i);
    // refresh endpoint was hit on the FACE_AI_URL base
    expect(axios.get).toHaveBeenCalledWith(expect.stringMatching(/\/refresh$/), expect.any(Object));
  });

  test("POST /user/enroll-face still succeeds (refresh pending) when AI refresh fails", async () => {
    mockUser.findByPk.mockResolvedValue({ id: 99, role: "FM", isActive: true });
    mockUser.update.mockResolvedValue([1]);
    require("axios").get.mockRejectedValueOnce({ message: "connect ECONNREFUSED" });
    const res = await request(app)
      .post("/user/enroll-face")
      .set("Authorization", `Bearer ${fmToken}`)
      .send({ images: { front: "a", left: "b", right: "c" } });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/refresh pending/i);
  });

  test("POST /user/enroll-face returns 400 for missing images", async () => {
    mockUser.findByPk.mockResolvedValue({ id: 99, role: "FM", isActive: true });
    const res = await request(app)
      .post("/user/enroll-face")
      .set("Authorization", `Bearer ${fmToken}`)
      .send({ images: { front: "a" } });
    expect(res.status).toBe(400);
  });

  test("POST /user/enroll-face returns 503 when the AI service is offline", async () => {
    mockUser.findByPk.mockResolvedValue({ id: 99, role: "FM", isActive: true });
    require("axios").post.mockRejectedValueOnce({ code: "ECONNREFUSED" });
    const res = await request(app)
      .post("/user/enroll-face")
      .set("Authorization", `Bearer ${fmToken}`)
      .send({ images: { front: "a", left: "b", right: "c" } });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/offline/i);
  });

  test("DELETE /user/:id removes a user and wipes biometric data", async () => {
    const update = jest.fn().mockResolvedValue(true);
    const destroy = jest.fn().mockResolvedValue(true);
    mockUser.findByPk.mockResolvedValue({ id: 1, name: "Worker Bee", managerId: 99, update, destroy });
    const res = await request(app)
      .delete("/user/1")
      .set("Authorization", `Bearer ${fmToken}`);
    expect(res.status).toBe(200);
    // PDPA: biometric vector explicitly nulled, and access logs anonymised by name.
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ faceVector: null }));
    expect(require("../models").SecurityLog.update).toHaveBeenCalledWith(
      { personnelName: null },
      { where: { personnelName: "Worker Bee" } }
    );
  });
});
