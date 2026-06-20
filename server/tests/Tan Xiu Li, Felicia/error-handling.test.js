// Backend error-handling tests — 404 fallback + global error handler.
// Verifies unknown routes return 404 and thrown errors return a safe generic 500
// (never leaking the underlying error message/stack).
const express = require("express");
const request = require("supertest");
const { notFound, errorHandler } = require("../../middlewares/errorHandlers");

const buildApp = () => {
  const app = express();
  app.get("/ok", (req, res) => res.json({ ok: true }));
  app.get("/boom", () => { throw new Error("SECRET INTERNAL DB STRING"); });
  app.use(notFound);
  app.use(errorHandler);
  return app;
};

describe("Fallback error handlers", () => {
  const app = buildApp();

  test("known route still works", async () => {
    const res = await request(app).get("/ok");
    expect(res.status).toBe(200);
  });

  test("unknown route returns 404 JSON", async () => {
    const res = await request(app).get("/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  test("thrown error returns 500 without leaking internals", async () => {
    const res = await request(app).get("/boom");
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Internal server error.");
    expect(JSON.stringify(res.body)).not.toMatch(/SECRET INTERNAL DB STRING/);
  });
});
