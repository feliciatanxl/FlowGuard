// Backend tests — 1–2 hour Smart Logistics booking-window rule.
// Backend validation is authoritative and applies to BOTH create and edit. 60 and 120
// minutes are valid (inclusive); 59 and 121 minutes are invalid. Singapore wall-clock →
// UTC normalisation and loading-bay overlap rejection must both still work.

// --- Unit: validateBookingWindow (pure, host-timezone independent) -----------------
const { validateBookingWindow } = require("../../utils/bookingDateTime");

describe("validateBookingWindow (unit)", () => {
  const start = "2026-08-10T02:00:00.000Z";

  test("exactly 60 minutes is accepted", () => {
    const r = validateBookingWindow(start, "2026-08-10T03:00:00.000Z");
    expect(r.ok).toBe(true);
    expect(r.durationMinutes).toBe(60);
  });

  test("exactly 120 minutes is accepted", () => {
    const r = validateBookingWindow(start, "2026-08-10T04:00:00.000Z");
    expect(r.ok).toBe(true);
    expect(r.durationMinutes).toBe(120);
  });

  test("59 minutes is rejected (below 1 hour)", () => {
    const r = validateBookingWindow(start, "2026-08-10T02:59:00.000Z");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("Booking duration must be at least 1 hour.");
  });

  test("121 minutes is rejected (above 2 hours)", () => {
    const r = validateBookingWindow(start, "2026-08-10T04:01:00.000Z");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("Booking duration cannot exceed 2 hours.");
  });

  test("missing start is rejected", () => {
    expect(validateBookingWindow(null, "2026-08-10T03:00:00.000Z").error)
      .toBe("slot_start and slot_end are required.");
    expect(validateBookingWindow("", "2026-08-10T03:00:00.000Z").error)
      .toBe("slot_start and slot_end are required.");
  });

  test("missing end is rejected", () => {
    expect(validateBookingWindow(start, null).error)
      .toBe("slot_start and slot_end are required.");
    expect(validateBookingWindow(start, undefined).error)
      .toBe("slot_start and slot_end are required.");
  });

  test("end equal to / before start is rejected", () => {
    expect(validateBookingWindow(start, start).error).toBe("slot_end must be after slot_start.");
    expect(validateBookingWindow(start, "2026-08-10T01:00:00.000Z").error)
      .toBe("slot_end must be after slot_start.");
  });

  test("an unparseable slot is reported per-field", () => {
    expect(validateBookingWindow("nonsense", "2026-08-10T03:00:00.000Z").error)
      .toBe("slot_start is not a valid date/time.");
    expect(validateBookingWindow(start, "nonsense").error)
      .toBe("slot_end is not a valid date/time.");
  });

  test("Singapore wall-clock windows are measured correctly (60 min across the +08 offset)", () => {
    // 6:00 PM → 7:00 PM Singapore is exactly 60 minutes regardless of host timezone.
    const r = validateBookingWindow("2026-08-10T18:00", "2026-08-10T19:00");
    expect(r.ok).toBe(true);
    expect(r.durationMinutes).toBe(60);
    expect(r.startAt.toISOString()).toBe("2026-08-10T10:00:00.000Z");
  });
});

// --- Route: POST /create + PATCH /:id enforce the same rule ------------------------
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const { Op } = require("sequelize");

const mockBooking = {
  create: jest.fn(),
  findAll: jest.fn(),
  findByPk: jest.fn(),
  findOne: jest.fn(),
};
const mockUser = { findByPk: jest.fn() };
jest.mock("../../models", () => ({ Booking: mockBooking, User: mockUser }));

delete process.env.WHATSAPP_ENABLED;
process.env.APP_SECRET = "test-secret";

const bookingRouter = require("../../routes/booking");
const app = express();
app.use(express.json());
app.use("/api/bookings", bookingRouter);

const DB_USERS = { 7: { id: 7, role: "FM", isActive: true }, 50: { id: 50, role: "Tenant", isActive: true } };
const tokenFor = (role, id = 7) => jwt.sign({ id, role }, process.env.APP_SECRET);

const base = {
  transport_company: "NinjaVan",
  license_plate: "GBG 1234M",
  driver_phone: "+6591234567",
  loading_bay: "Bay A",
};

const makeBooking = (overrides = {}) => ({
  id: 42,
  booking_ref: "FG-DUR01",
  ...base,
  driver_name: "Ahmad",
  slot_start: new Date("2026-08-10T02:00:00.000Z"),
  slot_end: new Date("2026-08-10T03:00:00.000Z"),
  status: "Pending",
  tenantId: 50,
  update: jest.fn().mockResolvedValue(true),
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUser.findByPk.mockImplementation((id) => Promise.resolve(DB_USERS[id] || null));
  mockBooking.findOne.mockResolvedValue(null); // no clash unless a test says so
  mockBooking.create.mockResolvedValue({ id: 1, ...base, booking_ref: "FG-NEW", status: "Pending" });
});

const createWith = (slot_start, slot_end) =>
  request(app)
    .post("/api/bookings/create")
    .set("Authorization", `Bearer ${tokenFor("FM")}`)
    .send({ ...base, slot_start, slot_end });

describe("POST /create — 1–2 hour rule", () => {
  test("exact 60-minute create is accepted (201)", async () => {
    const res = await createWith("2026-08-10T02:00:00.000Z", "2026-08-10T03:00:00.000Z");
    expect(res.status).toBe(201);
    expect(mockBooking.create).toHaveBeenCalled();
  });

  test("exact 120-minute create is accepted (201)", async () => {
    const res = await createWith("2026-08-10T02:00:00.000Z", "2026-08-10T04:00:00.000Z");
    expect(res.status).toBe(201);
  });

  test("59-minute create is rejected (400) and never persisted", async () => {
    const res = await createWith("2026-08-10T02:00:00.000Z", "2026-08-10T02:59:00.000Z");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least 1 hour/);
    expect(mockBooking.create).not.toHaveBeenCalled();
  });

  test("121-minute create is rejected (400)", async () => {
    const res = await createWith("2026-08-10T02:00:00.000Z", "2026-08-10T04:01:00.000Z");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot exceed 2 hours/);
    expect(mockBooking.create).not.toHaveBeenCalled();
  });

  test("missing start is rejected (400)", async () => {
    const res = await createWith(undefined, "2026-08-10T03:00:00.000Z");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/);
  });

  test("missing end is rejected (400)", async () => {
    const res = await createWith("2026-08-10T02:00:00.000Z", undefined);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/);
  });

  test("end before start is rejected (400)", async () => {
    const res = await createWith("2026-08-10T03:00:00.000Z", "2026-08-10T02:00:00.000Z");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/after slot_start/);
  });

  test("overlap on a valid window is still rejected (409)", async () => {
    mockBooking.findOne.mockResolvedValue(makeBooking({ id: 99 })); // clash
    const res = await createWith("2026-08-10T02:00:00.000Z", "2026-08-10T03:00:00.000Z");
    expect(res.status).toBe(409);
    expect(mockBooking.create).not.toHaveBeenCalled();
  });

  test("duration is validated BEFORE the overlap query (no clash lookup on a bad window)", async () => {
    const res = await createWith("2026-08-10T02:00:00.000Z", "2026-08-10T02:30:00.000Z"); // 30 min
    expect(res.status).toBe(400);
    expect(mockBooking.findOne).not.toHaveBeenCalled();
  });
});

const editWith = (body) =>
  request(app)
    .patch("/api/bookings/42")
    .set("Authorization", `Bearer ${tokenFor("FM")}`)
    .send(body);

describe("PATCH /:id — 1–2 hour rule", () => {
  beforeEach(() => mockBooking.findByPk.mockResolvedValue(makeBooking()));

  test("editing to an exact 60-minute window is accepted (200)", async () => {
    const res = await editWith({ slot_start: "2026-08-11T09:00:00.000Z", slot_end: "2026-08-11T10:00:00.000Z" });
    expect(res.status).toBe(200);
  });

  test("editing to an exact 120-minute window is accepted (200)", async () => {
    const res = await editWith({ slot_start: "2026-08-11T09:00:00.000Z", slot_end: "2026-08-11T11:00:00.000Z" });
    expect(res.status).toBe(200);
  });

  test("editing to 59 minutes is rejected (400)", async () => {
    const booking = makeBooking();
    mockBooking.findByPk.mockResolvedValue(booking);
    const res = await editWith({ slot_start: "2026-08-11T09:00:00.000Z", slot_end: "2026-08-11T09:59:00.000Z" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least 1 hour/);
    expect(booking.update).not.toHaveBeenCalled();
  });

  test("editing to 121 minutes is rejected (400)", async () => {
    const res = await editWith({ slot_start: "2026-08-11T09:00:00.000Z", slot_end: "2026-08-11T11:01:00.000Z" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot exceed 2 hours/);
  });

  test("editing only slot_end on an existing booking still validates the resulting window (400 when too short)", async () => {
    // Existing slot_start = 02:00Z; new slot_end = 02:30Z → 30 min → invalid.
    const res = await editWith({ slot_end: "2026-08-10T02:30:00.000Z" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least 1 hour/);
  });

  test("editing only slot_start to a valid distance from the existing end is accepted (200)", async () => {
    // Existing slot_end = 03:00Z; new slot_start = 02:00Z → 60 min → valid.
    const res = await editWith({ slot_start: "2026-08-10T02:00:00.000Z" });
    expect(res.status).toBe(200);
  });

  test("clearing a slot is rejected (400 required)", async () => {
    const res = await editWith({ slot_end: "" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/);
  });

  test("end before start on edit is rejected (400)", async () => {
    const res = await editWith({ slot_start: "2026-08-11T10:00:00.000Z", slot_end: "2026-08-11T09:00:00.000Z" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/after slot_start/);
  });

  test("overlap on a valid edited window is still rejected (409)", async () => {
    mockBooking.findOne.mockResolvedValue(makeBooking({ id: 99 })); // clash
    const res = await editWith({ slot_start: "2026-08-11T09:00:00.000Z", slot_end: "2026-08-11T10:00:00.000Z" });
    expect(res.status).toBe(409);
    // Overlap query must exclude the edited row itself.
    expect(mockBooking.findOne.mock.calls[0][0].where.id[Op.ne]).toBe(42);
  });

  test("a non-slot edit (driver name) does not force duration re-validation", async () => {
    const booking = makeBooking({ slot_start: null, slot_end: null }); // historical null-slot row
    mockBooking.findByPk.mockResolvedValue(booking);
    const res = await editWith({ driver_name: "New Driver" });
    expect(res.status).toBe(200);
    expect(booking.update).toHaveBeenCalledWith({ driver_name: "New Driver" });
  });
});
