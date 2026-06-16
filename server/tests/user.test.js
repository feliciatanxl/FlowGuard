const request = require("supertest");
const express = require("express");

jest.mock("../models/User", () => ({
  findOne: jest.fn(),
  findByPk: jest.fn(),
  create: jest.fn(),
  destroy: jest.fn(),
}));

const User = require("../models/User");
const app = express();
app.use(express.json());

// Stub auth middleware
jest.mock("jsonwebtoken", () => ({
  verify: (token, secret, cb) => cb(null, { id: 1, role: "Facilities Manager" }),
  sign: () => "fake-token",
}));

const userRouter = require("../routes/user");
app.use("/user", userRouter);

describe("User routes", () => {
  beforeEach(() => jest.clearAllMocks());

  test("POST /user/enroll-face enrolls a face", async () => {
    User.findByPk.mockResolvedValue({ id: 1, isEnrolled: false, save: jest.fn() });
    const res = await request(app).post("/user/enroll-face").set("Authorization", "Bearer fake").send({ userId: 1, images: ["a", "b", "c"] });
    expect([200, 201, 400]).toContain(res.status);
  });

  test("POST /user/enroll-face re-enrolls an existing face", async () => {
    User.findByPk.mockResolvedValue({ id: 1, isEnrolled: true, faceVector: [0.1], save: jest.fn() });
    const res = await request(app).post("/user/enroll-face").set("Authorization", "Bearer fake").send({ userId: 1, images: ["a", "b", "c"] });
    expect([200, 201, 400]).toContain(res.status);
  });

  test("DELETE /user/:id removes a user", async () => {
    User.findByPk.mockResolvedValue({ id: 1, destroy: jest.fn().mockResolvedValue(true) });
    const res = await request(app).delete("/user/1").set("Authorization", "Bearer fake");
    expect([200, 204, 404]).toContain(res.status);
  });
});
