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
}));

jest.mock("axios", () => ({
  post: jest.fn(() => Promise.resolve({ data: { vector: Array(512).fill(0.1) } })),
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

  test("POST /user/enroll-face enrolls a face", async () => {
    mockUser.findByPk.mockResolvedValue({ id: 99, role: "FM", isActive: true });
    mockUser.update.mockResolvedValue([1]);
    const res = await request(app)
      .post("/user/enroll-face")
      .set("Authorization", `Bearer ${fmToken}`)
      .send({ images: { front: "a", left: "b", right: "c" } });
    expect(res.status).toBe(200);
  });

  test("POST /user/enroll-face returns 400 for missing images", async () => {
    mockUser.findByPk.mockResolvedValue({ id: 99, role: "FM", isActive: true });
    const res = await request(app)
      .post("/user/enroll-face")
      .set("Authorization", `Bearer ${fmToken}`)
      .send({ images: { front: "a" } });
    expect(res.status).toBe(400);
  });

  test("DELETE /user/:id removes a user", async () => {
    mockUser.findByPk.mockResolvedValue({ id: 1, managerId: 99, destroy: jest.fn().mockResolvedValue(true) });
    const res = await request(app)
      .delete("/user/1")
      .set("Authorization", `Bearer ${fmToken}`);
    expect(res.status).toBe(200);
  });
});
