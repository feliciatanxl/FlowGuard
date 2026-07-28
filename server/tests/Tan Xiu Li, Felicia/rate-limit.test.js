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
const { rateLimit } = require("express-rate-limit");
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
const { parseTrustProxy } = require("../../config/serverConfig");

const bearer = (id, secret = "test-secret") => `Bearer ${jwt.sign({ id }, secret)}`;
// A token signed with the WRONG secret — verifyToken rejects it; the limiter must
// never treat its claims as identity.
const forged = (id) => `Bearer ${jwt.sign({ id }, "attacker-secret")}`;

// Test-only baseline DoS guard recognised by CodeQL.
// The deliberately high threshold ensures it does not influence behavioural
// rate-limit or RBAC assertions.
const testHarnessLimiter = rateLimit({
  windowMs: 60_000,
  limit: 100_000,
  standardHeaders: false,
  legacyHeaders: false,
  validate: false,
});

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

describe("keying — verified-user isolation, IP fallback, and no forged-token rotation", () => {
  // Authenticated limiter: runs AFTER verifyToken and keys on the VERIFIED id.
  const authedApp = (limiter) => {
    const app = express();
    app.use(express.json());
    app.get("/x", testHarnessLimiter, verifyToken, limiter, (req, res) => res.json({ ok: true, id: req.user.id }));
    return app;
  };

  test("separate VERIFIED users do not consume each other's authenticated quota", async () => {
    const app = authedApp(makeLimiter({ windowMs: 60000, max: 2, keyGenerator: keyByUserOrIp }));
    await request(app).get("/x").set("Authorization", bearer(1));
    await request(app).get("/x").set("Authorization", bearer(1));
    expect((await request(app).get("/x").set("Authorization", bearer(1))).status).toBe(429); // user 1 exhausted
    expect((await request(app).get("/x").set("Authorization", bearer(2))).status).toBe(200); // user 2 unaffected
  });

  test("unauthenticated (pre-auth) requests fall back to per-IP limiting", async () => {
    const app = appWith(makeLimiter({ windowMs: 60000, max: 2, keyGenerator: keyByUserOrIp }));
    await request(app).get("/x");
    await request(app).get("/x");
    expect((await request(app).get("/x")).status).toBe(429); // same IP bucket
  });

  test("a forged/unsigned JWT cannot rotate the rate-limit identity (pre-auth ⇒ one IP bucket)", async () => {
    // Pre-auth limiter (no verifyToken): the key never reads the token, so
    // rotating a fake `id` claim cannot mint fresh quota — every request shares
    // the single client-IP bucket.
    const app = appWith(makeLimiter({ windowMs: 60000, max: 2, keyGenerator: keyByUserOrIp }));
    expect((await request(app).get("/x").set("Authorization", forged(1))).status).toBe(200);
    expect((await request(app).get("/x").set("Authorization", forged(2))).status).toBe(200);
    // A third request with yet another forged id is still blocked — no rotation.
    expect((await request(app).get("/x").set("Authorization", forged(9999))).status).toBe(429);
  });

  test("post-auth: a forged JWT is rejected by verifyToken and never reaches user keying", async () => {
    const app = authedApp(makeLimiter({ windowMs: 60000, max: 5, keyGenerator: keyByUserOrIp }));
    const res = await request(app).get("/x").set("Authorization", forged(1));
    expect(res.status).toBe(403); // invalid signature → rejected before the limiter keys on it
  });
});

describe("parseTrustProxy — env string → Express trust-proxy value", () => {
  test("undefined / empty → default single hop (Number 1)", () => {
    expect(parseTrustProxy(undefined)).toBe(1);
    expect(parseTrustProxy("")).toBe(1);
    expect(parseTrustProxy("   ")).toBe(1);
  });
  test('numeric strings become Numbers: "0" → 0, "1" → 1, "2" → 2', () => {
    expect(parseTrustProxy("0")).toBe(0);
    expect(parseTrustProxy("1")).toBe(1);
    expect(parseTrustProxy("2")).toBe(2);
    expect(typeof parseTrustProxy("1")).toBe("number");
  });
  test('"true"/"false" become booleans', () => {
    expect(parseTrustProxy("true")).toBe(true);
    expect(parseTrustProxy("false")).toBe(false);
  });
  test("named presets / subnets / lists pass through as strings (never NaN)", () => {
    expect(parseTrustProxy("loopback")).toBe("loopback");
    expect(parseTrustProxy("10.0.0.0/8")).toBe("10.0.0.0/8");
    expect(parseTrustProxy("127.0.0.1, 10.0.0.0/8")).toBe("127.0.0.1, 10.0.0.0/8");
    expect(Number.isNaN(parseTrustProxy("loopback"))).toBe(false);
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
