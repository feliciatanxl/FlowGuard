// Backend tests — central route-aware rate limiting (Felicia).
// Verifies the express-rate-limit-backed factory + named policies: limits,
// 429 shape/headers, per-user isolation, IP fallback, window reset, that the
// limiter never breaks authentication, internal-service bypass, no data leak,
// and that real polling peaks fit under the production defaults.
process.env.APP_SECRET = "test-secret";
process.env.AI_SERVICE_KEY = "svc-secret";

// verifyToken lazy-requires ../models; with no User model it keeps the JWT-only
// path, which is all this suite needs.
jest.mock("../../models", () => ({}));

const request = require("supertest");
const express = require("express");
const jwt = require("jsonwebtoken");

const {
  makeLimiter,
  createRateLimiter,
  keyByUserOrIp,
  ipKey,
  readLimiter,
  aiProxyLimiter,
} = require("../../middlewares/rateLimit");
const { verifyToken } = require("../../middlewares/auth");

const bearer = (id, secret = "test-secret") => `Bearer ${jwt.sign({ id }, secret)}`;

const appWith = (limiter, handler) => {
  const app = express();
  app.use(express.json());
  const h = handler || ((req, res) => res.json({ ok: true, user: req.user?.id ?? null }));
  app.get("/x", limiter, h);
  app.post("/x", limiter, h);
  return app;
};

describe("limit enforcement + 429 contract", () => {
  test("requests under the limit succeed; the next one is 429 with headers and a safe body", async () => {
    const app = appWith(makeLimiter({ windowMs: 60000, max: 3, keyGenerator: ipKey }));
    const under = [await request(app).get("/x"), await request(app).get("/x"), await request(app).get("/x")];
    expect(under.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(under[0].body).toEqual({ ok: true, user: null }); // response body unchanged under the limit

    const blocked = await request(app).get("/x");
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ message: "Too many requests. Please try again later." });
    // Standard RateLimit-* headers + a Retry-After hint are present.
    expect(blocked.headers["ratelimit-limit"] ?? blocked.headers["ratelimit"]).toBeDefined();
    expect(blocked.headers["retry-after"] ?? blocked.headers["ratelimit-reset"]).toBeDefined();
  });

  test("the safe 429 body leaks neither the user id nor the client IP", async () => {
    const app = appWith(makeLimiter({ windowMs: 60000, max: 1, keyGenerator: keyByUserOrIp }));
    await request(app).get("/x").set("Authorization", bearer(4242));
    const blocked = await request(app).get("/x").set("Authorization", bearer(4242));
    expect(blocked.status).toBe(429);
    const body = JSON.stringify(blocked.body);
    expect(body).not.toMatch(/4242/);
    expect(body).not.toMatch(/127\.0\.0\.1|::1|::ffff/);
    expect(body).toBe(JSON.stringify({ message: "Too many requests. Please try again later." }));
  });

  test("counter resets after the window elapses", async () => {
    const app = appWith(makeLimiter({ windowMs: 150, max: 1, keyGenerator: ipKey }));
    expect((await request(app).get("/x")).status).toBe(200);
    expect((await request(app).get("/x")).status).toBe(429);
    await new Promise((r) => setTimeout(r, 220));
    expect((await request(app).get("/x")).status).toBe(200);
  });
});

describe("keying — per-user isolation and IP fallback", () => {
  test("separate authenticated users do not consume each other's quota", async () => {
    const app = appWith(makeLimiter({ windowMs: 60000, max: 2, keyGenerator: keyByUserOrIp }));
    await request(app).get("/x").set("Authorization", bearer(1));
    await request(app).get("/x").set("Authorization", bearer(1));
    expect((await request(app).get("/x").set("Authorization", bearer(1))).status).toBe(429); // user 1 exhausted
    expect((await request(app).get("/x").set("Authorization", bearer(2))).status).toBe(200); // user 2 unaffected
  });

  test("unauthenticated requests fall back to per-IP limiting", async () => {
    const app = appWith(makeLimiter({ windowMs: 60000, max: 2, keyGenerator: keyByUserOrIp }));
    await request(app).get("/x");
    await request(app).get("/x");
    expect((await request(app).get("/x")).status).toBe(429); // same IP bucket
  });
});

describe("interaction with authentication and internal services", () => {
  test("a limiter placed before auth does not break authentication", async () => {
    const app = express();
    app.use(express.json());
    app.get(
      "/p",
      makeLimiter({ windowMs: 60000, max: 5, keyGenerator: keyByUserOrIp }),
      verifyToken,
      (req, res) => res.json({ id: req.user.id })
    );
    expect((await request(app).get("/p")).status).toBe(401); // no token → still rejected
    const ok = await request(app).get("/p").set("Authorization", bearer(7));
    expect(ok.status).toBe(200);
    expect(ok.body.id).toBe(7);
  });

  test("trusted internal service-key calls bypass the user-facing limiter", async () => {
    const app = appWith(makeLimiter({ windowMs: 60000, max: 1, skipInternalService: true, keyGenerator: ipKey }));
    expect((await request(app).get("/x")).status).toBe(200);
    expect((await request(app).get("/x")).status).toBe(429); // browser IP bucket exhausted
    for (let i = 0; i < 5; i++) {
      const r = await request(app).get("/x").set("x-service-key", "svc-secret");
      expect(r.status).toBe(200); // service never throttled
    }
  });
});

describe("backward-compatible factory + polling headroom", () => {
  test("createRateLimiter keeps the { windowMs, max } contract (forgot-password style)", async () => {
    const app = appWith(createRateLimiter({ windowMs: 60000, max: 2 }));
    expect((await request(app).post("/x")).status).toBe(200);
    expect((await request(app).post("/x")).status).toBe(200);
    expect((await request(app).post("/x")).status).toBe(429);
  });

  test("GateScanner peak (~300 req/min: 250ms track + 1s recognition) fits under the aiProxyLimiter default", async () => {
    const app = appWith(aiProxyLimiter);
    for (let i = 0; i < 300; i++) {
      const r = await request(app).get("/x").set("Authorization", bearer(90001));
      expect(r.status).toBe(200);
    }
  }, 30000);

  test("dashboard/alert polling burst stays well under the readLimiter default", async () => {
    const app = appWith(readLimiter);
    for (let i = 0; i < 60; i++) {
      const r = await request(app).get("/x").set("Authorization", bearer(90002));
      expect(r.status).toBe(200);
    }
  }, 15000);
});
