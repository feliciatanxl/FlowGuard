// Backend tests — driver-pass link generation for local + LAN (phone) access.
// Verifies the canonical link, the optional dev-only LAN link, trailing-slash
// safety, URL-encoding, production suppression, and that the booking message
// content stays intact.
const whatsapp = require("../../services/whatsappService");

const ENV_KEYS = [
  "FRONTEND_URL", "FRONTEND_NETWORK_URL", "CLIENT_URL", "NODE_ENV",
  "WHATSAPP_ENABLED", "WHATSAPP_API_URL", "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_API_KEY", "WHATSAPP_PHONE_NUMBER_ID",
];

let snapshot;
let origFetch;

beforeEach(() => {
  // Clean env slate; restore exactly after each test (NODE_ENV included).
  snapshot = {};
  ENV_KEYS.forEach((k) => { snapshot[k] = process.env[k]; delete process.env[k]; });
  origFetch = global.fetch;
});

afterEach(() => {
  ENV_KEYS.forEach((k) => {
    if (snapshot[k] === undefined) delete process.env[k];
    else process.env[k] = snapshot[k];
  });
  global.fetch = origFetch;
  jest.restoreAllMocks();
});

const BOOKING = {
  booking_ref: "FG-ABC123",
  transport_company: "NinjaVan",
  license_plate: "GBG 1234M",
  driver_phone: "+6591234567",
  loading_bay: "Bay A",
  slot_start: "2026-07-27T09:00:00.000Z",
  slot_end: "2026-07-27T10:00:00.000Z",
};

// Compose the real booking-created message body (real mode + mocked fetch).
const composedMessage = async (booking = BOOKING) => {
  process.env.WHATSAPP_ENABLED = "true";
  process.env.WHATSAPP_API_URL = "https://graph.facebook.com/v20.0";
  process.env.WHATSAPP_ACCESS_TOKEN = "EAAtoken1234567890";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "PNID123";
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  await whatsapp.sendBookingCreated(booking);
  return JSON.parse(global.fetch.mock.calls[0][1].body).text.body;
};

describe("driver-pass link builders", () => {
  test("1. FRONTEND_URL builds a valid localhost driver-pass link", () => {
    process.env.FRONTEND_URL = "http://localhost:5173";
    expect(whatsapp.driverPassLink(BOOKING)).toBe("http://localhost:5173/driver-pass/FG-ABC123");
  });

  test("2. FRONTEND_NETWORK_URL builds a valid network (phone) driver-pass link", () => {
    process.env.FRONTEND_NETWORK_URL = "http://172.26.178.147:5173";
    expect(whatsapp.driverPassNetworkLink(BOOKING)).toBe("http://172.26.178.147:5173/driver-pass/FG-ABC123");
  });

  test("5. trailing slashes never create a double slash", () => {
    process.env.FRONTEND_URL = "http://localhost:5173/";
    process.env.FRONTEND_NETWORK_URL = "http://172.26.178.147:5173///";
    expect(whatsapp.driverPassLink(BOOKING)).toBe("http://localhost:5173/driver-pass/FG-ABC123");
    expect(whatsapp.driverPassNetworkLink(BOOKING)).toBe("http://172.26.178.147:5173/driver-pass/FG-ABC123");
  });

  test("ref is URL-encoded; missing base/ref yields '' (never 'undefined')", () => {
    expect(whatsapp.buildDriverPassUrl("http://x:5173", "FG A/B")).toBe("http://x:5173/driver-pass/FG%20A%2FB");
    expect(whatsapp.buildDriverPassUrl("", "FG-1")).toBe("");
    expect(whatsapp.buildDriverPassUrl("http://x", "")).toBe("");
    expect(whatsapp.driverPassLink({})).toBe("");            // no booking_ref
    expect(whatsapp.driverPassNetworkLink(BOOKING)).toBe(""); // FRONTEND_NETWORK_URL unset
  });

  test("6. production never emits a LAN link even if FRONTEND_NETWORK_URL is set", () => {
    process.env.NODE_ENV = "production";
    process.env.FRONTEND_NETWORK_URL = "http://172.26.178.147:5173";
    expect(whatsapp.driverPassNetworkLink(BOOKING)).toBe("");
  });

  test("production without a canonical frontend never falls back to localhost", async () => {
    process.env.NODE_ENV = "production";
    process.env.FRONTEND_NETWORK_URL = "http://172.26.178.147:5173";
    expect(whatsapp.driverPassLink(BOOKING)).toBe("");
    const body = await composedMessage();
    expect(body).not.toContain("localhost");
    expect(body).not.toContain("172.26.178.147");
    expect(body).not.toContain("Driver pass:");
  });
});

describe("booking-created message composition", () => {
  test("3. both links appear in development when the network URL is set", async () => {
    process.env.FRONTEND_URL = "http://localhost:5173";
    process.env.FRONTEND_NETWORK_URL = "http://172.26.178.147:5173";
    const body = await composedMessage();
    expect(body).toContain("Driver pass:");
    expect(body).toContain("Phone/Wi-Fi: http://172.26.178.147:5173/driver-pass/FG-ABC123");
    expect(body).toContain("Laptop: http://localhost:5173/driver-pass/FG-ABC123");
  });

  test("4. only the canonical link appears when the network URL is absent", async () => {
    process.env.FRONTEND_URL = "http://localhost:5173";
    const body = await composedMessage();
    expect(body).toContain("Driver pass: http://localhost:5173/driver-pass/FG-ABC123");
    expect(body).not.toContain("Phone/Wi-Fi:");
    expect(body).not.toContain("Laptop:");
  });

  test("6b. production message uses only the HTTPS URL — no dev LAN link leaks", async () => {
    process.env.NODE_ENV = "production";
    process.env.FRONTEND_URL = "https://flowguard.example.com";
    process.env.FRONTEND_NETWORK_URL = "http://172.26.178.147:5173";
    const body = await composedMessage();
    expect(body).toContain("Driver pass: https://flowguard.example.com/driver-pass/FG-ABC123");
    expect(body).not.toContain("172.26.178.147");
    expect(body).not.toContain("Phone/Wi-Fi:");
  });

  test("7. existing booking content stays intact and never renders 'undefined'", async () => {
    process.env.FRONTEND_URL = "http://localhost:5173";
    const body = await composedMessage();
    expect(body).toContain("FlowGuard — Harrison Food Factory");
    expect(body).toContain("Booking FG-ABC123 received.");
    expect(body).toContain("Company: NinjaVan · Plate: GBG 1234M");
    expect(body).toContain("Bay: Bay A");
    expect(body).toContain("Please wait for confirmation before arriving.");
    expect(body).not.toContain("undefined");
  });
});
