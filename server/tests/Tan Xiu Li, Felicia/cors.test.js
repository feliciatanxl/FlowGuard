// Backend tests — environment-based CORS allowlist.
const { buildAllowedOrigins, buildCorsOptions } = require("../../middlewares/corsOptions");

const originAllowed = (options, origin) =>
  new Promise((resolve) => options.origin(origin, (err, allowed) => resolve(allowed)));

describe("buildAllowedOrigins", () => {
  test("combines frontend URL variables and ALLOWED_ORIGINS, trimmed and deduplicated", () => {
    const env = {
      FRONTEND_URL: "https://flowguard-client-staging-590663319889.asia-southeast1.run.app/",
      CLIENT_URL: "http://localhost:5173/",
      ALLOWED_ORIGINS: " https://flowguard.vercel.app , http://192.168.1.20:5173, http://localhost:5173",
    };
    expect(buildAllowedOrigins(env)).toEqual([
      "https://flowguard-client-staging-590663319889.asia-southeast1.run.app",
      "http://localhost:5173",
      "https://flowguard.vercel.app",
      "http://192.168.1.20:5173",
    ]);
  });

  test("empty env → empty allowlist", () => {
    expect(buildAllowedOrigins({})).toEqual([]);
  });
});

describe("buildCorsOptions", () => {
  // SECURITY CHANGE (was: no origins → { origin: '*' }). The wildcard fallback
  // was replaced by fail-closed behaviour: production/staging with nothing
  // configured denies browser origins, and development with nothing configured
  // uses an explicit localhost allowlist — never a wildcard. See report Part 3.
  test("NEVER returns a wildcard, in any environment", () => {
    for (const env of [{}, { NODE_ENV: "production" }, { NODE_ENV: "staging" }, { NODE_ENV: "development" }]) {
      const options = buildCorsOptions(env);
      expect(options.origin).not.toBe("*");
      expect(typeof options.origin).toBe("function"); // allowlist checker, not a wildcard string
      expect(options.credentials).toBeUndefined(); // never wildcard + credentials
    }
  });

  test("configured origins: listed origins are allowed", async () => {
    const options = buildCorsOptions({
      CLIENT_URL: "http://localhost:5173",
      ALLOWED_ORIGINS: "https://flowguard.vercel.app",
    });
    expect(await originAllowed(options, "http://localhost:5173")).toBe(true);
    expect(await originAllowed(options, "https://flowguard.vercel.app")).toBe(true);
  });

  test("multiple ALLOWED_ORIGINS are each honoured", async () => {
    const options = buildCorsOptions({
      NODE_ENV: "production",
      ALLOWED_ORIGINS: "https://a.example.com, https://b.example.com , https://c.example.com",
    });
    expect(await originAllowed(options, "https://a.example.com")).toBe(true);
    expect(await originAllowed(options, "https://b.example.com")).toBe(true);
    expect(await originAllowed(options, "https://c.example.com")).toBe(true);
    expect(await originAllowed(options, "https://d.example.com")).toBe(false);
  });

  test("production FRONTEND_URL alone creates an exact staging allowlist", async () => {
    const staging = "https://flowguard-client-staging-590663319889.asia-southeast1.run.app";
    const options = buildCorsOptions({ NODE_ENV: "production", FRONTEND_URL: staging });
    expect(buildAllowedOrigins({ NODE_ENV: "production", FRONTEND_URL: staging })).toEqual([staging]);
    expect(await originAllowed(options, staging)).toBe(true);
    expect(await originAllowed(options, "http://localhost:5173")).toBe(false);
    expect(options.credentials).toBeUndefined();
  });

  test("production: an attacker origin is rejected", async () => {
    const options = buildCorsOptions({
      NODE_ENV: "production",
      FRONTEND_URL: "https://app.flowguard.example",
    });
    expect(await originAllowed(options, "https://app.flowguard.example.attacker.com")).toBe(false);
    expect(await originAllowed(options, "https://evil.example.com")).toBe(false);
  });

  test("production FAIL-CLOSED: nothing configured → browser origins denied, no-Origin allowed", async () => {
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const options = buildCorsOptions({ NODE_ENV: "production" });
    expect(await originAllowed(options, "https://flowguard.vercel.app")).toBe(false); // any browser origin blocked
    expect(await originAllowed(options, undefined)).toBe(true); // server-to-server still works
    expect(errSpy).toHaveBeenCalled(); // loud misconfiguration log
    errSpy.mockRestore();
  });

  test("development zero-config: localhost is allowed, other origins are not", async () => {
    const options = buildCorsOptions({}); // no NODE_ENV → development
    expect(await originAllowed(options, "http://localhost:5173")).toBe(true);
    expect(await originAllowed(options, "http://127.0.0.1:5173")).toBe(true);
    expect(await originAllowed(options, "https://evil.example.com")).toBe(false);
  });

  test("configured origins: unlisted origins are rejected", async () => {
    const options = buildCorsOptions({ CLIENT_URL: "http://localhost:5173" });
    expect(await originAllowed(options, "https://evil.example.com")).toBe(false);
  });

  test("requests with no Origin header (curl / server-to-server) pass through", async () => {
    const options = buildCorsOptions({ CLIENT_URL: "http://localhost:5173" });
    expect(await originAllowed(options, undefined)).toBe(true);
  });

  test("trailing slashes on the incoming origin are tolerated", async () => {
    const options = buildCorsOptions({ CLIENT_URL: "http://localhost:5173" });
    expect(await originAllowed(options, "http://localhost:5173/")).toBe(true);
  });
});
