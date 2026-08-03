// Backend tests — Singapore booking-time contract across the booking routes:
// create/edit store correct UTC instants, conflict checks use normalised
// instants, and the public Driver Pass returns the latest row with no-store
// caching. These prove the +8h Cloud Run bug is fixed regardless of host TZ.
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

const ID_BY_ROLE = { FM: 7, Tenant: 8 };
const DB_USERS = {
  7: { id: 7, role: "FM", isActive: true },
  8: { id: 8, role: "Tenant", isActive: true },
  50: { id: 50, role: "Tenant", isActive: true },
};
const tokenFor = (role, id = ID_BY_ROLE[role]) => jwt.sign({ id, role }, process.env.APP_SECRET);

const validCreate = {
  transport_company: "NinjaVan",
  license_plate: "GBG 1234M",
  driver_phone: "+6591234567",
  loading_bay: "Bay A",
};

const makeBooking = (overrides = {}) => ({
  id: 42,
  booking_ref: "FG-TZ01",
  transport_company: "NinjaVan",
  license_plate: "GBG 1234M",
  driver_phone: "+6591234567",
  driver_name: "Ahmad",
  loading_bay: "Bay A",
  slot_start: new Date("2026-07-27T10:01:00.000Z"),
  slot_end: new Date("2026-07-27T10:03:00.000Z"),
  notes: null,
  status: "Pending",
  tenantId: 50,
  arrived_at: null,
  completed_at: null,
  update: jest.fn().mockResolvedValue(true),
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUser.findByPk.mockImplementation((id) => Promise.resolve(DB_USERS[id] || null));
});

describe("POST /create — stores Singapore wall clock as UTC", () => {
  test("timezone-less 6:01 PM SG is stored as 10:01 UTC", async () => {
    mockBooking.findOne.mockResolvedValue(null); // no clash
    mockBooking.create.mockResolvedValue({ id: 1, ...validCreate, booking_ref: "FG-NEW" });

    // A valid 1-hour window (6:01–7:01 PM SG) so the duration rule passes while this
    // test stays focused on the Singapore→UTC conversion.
    const res = await request(app)
      .post("/api/bookings/create")
      .set("Authorization", `Bearer ${tokenFor("FM")}`)
      .send({ ...validCreate, slot_start: "2026-07-27T18:01", slot_end: "2026-07-27T19:01" });

    expect(res.status).toBe(201);
    const arg = mockBooking.create.mock.calls[0][0];
    expect(arg.slot_start).toBeInstanceOf(Date);
    expect(arg.slot_start.toISOString()).toBe("2026-07-27T10:01:00.000Z");
    expect(arg.slot_end.toISOString()).toBe("2026-07-27T11:01:00.000Z");
  });

  test("an explicit-Z ISO payload (what the fixed frontend sends) is preserved", async () => {
    mockBooking.findOne.mockResolvedValue(null);
    mockBooking.create.mockResolvedValue({ id: 1, ...validCreate, booking_ref: "FG-NEW" });

    await request(app)
      .post("/api/bookings/create")
      .set("Authorization", `Bearer ${tokenFor("FM")}`)
      .send({ ...validCreate, slot_start: "2026-07-27T10:01:00.000Z", slot_end: "2026-07-27T11:01:00.000Z" });

    const arg = mockBooking.create.mock.calls[0][0];
    expect(arg.slot_start.toISOString()).toBe("2026-07-27T10:01:00.000Z");
  });

  test("invalid slot value → 400 (no create)", async () => {
    const res = await request(app)
      .post("/api/bookings/create")
      .set("Authorization", `Bearer ${tokenFor("FM")}`)
      .send({ ...validCreate, slot_start: "not-a-date", slot_end: "2026-07-27T18:03" });
    expect(res.status).toBe(400);
    expect(mockBooking.create).not.toHaveBeenCalled();
  });

  test("slot_end before slot_start → 400 after normalisation", async () => {
    const res = await request(app)
      .post("/api/bookings/create")
      .set("Authorization", `Bearer ${tokenFor("FM")}`)
      .send({ ...validCreate, slot_start: "2026-07-27T18:03", slot_end: "2026-07-27T18:01" });
    expect(res.status).toBe(400);
  });

  test("conflict detection queries the DB with NORMALISED instants", async () => {
    mockBooking.findOne.mockResolvedValue(null);
    mockBooking.create.mockResolvedValue({ id: 1, ...validCreate, booking_ref: "FG-NEW" });

    await request(app)
      .post("/api/bookings/create")
      .set("Authorization", `Bearer ${tokenFor("FM")}`)
      .send({ ...validCreate, slot_start: "2026-07-27T18:30", slot_end: "2026-07-27T19:30" });

    const where = mockBooking.findOne.mock.calls[0][0].where;
    // overlap test: existing.start < newEnd AND existing.end > newStart, both in UTC.
    expect(where.slot_start[Op.lt].toISOString()).toBe("2026-07-27T11:30:00.000Z");
    expect(where.slot_end[Op.gt].toISOString()).toBe("2026-07-27T10:30:00.000Z");
  });
});

describe("PATCH /:id — edit stores correct UTC + isolates the record", () => {
  test("edited timezone-less slot is stored as UTC", async () => {
    const booking = makeBooking();
    mockBooking.findByPk.mockResolvedValue(booking);
    mockBooking.findOne.mockResolvedValue(null);

    const res = await request(app)
      .patch("/api/bookings/42")
      .set("Authorization", `Bearer ${tokenFor("FM")}`)
      .send({ slot_start: "2026-07-27T19:00", slot_end: "2026-07-27T20:00" });

    expect(res.status).toBe(200);
    const patch = booking.update.mock.calls[0][0];
    expect(patch.slot_start.toISOString()).toBe("2026-07-27T11:00:00.000Z");
    expect(patch.slot_end.toISOString()).toBe("2026-07-27T12:00:00.000Z");
  });

  test("editing booking 42 only touches booking 42", async () => {
    const booking = makeBooking({ id: 42 });
    mockBooking.findByPk.mockResolvedValue(booking);
    mockBooking.findOne.mockResolvedValue(null);

    await request(app)
      .patch("/api/bookings/42")
      .set("Authorization", `Bearer ${tokenFor("FM")}`)
      .send({ driver_name: "Only Me" });

    expect(mockBooking.findByPk).toHaveBeenCalledWith("42");
    expect(booking.update).toHaveBeenCalledTimes(1);
    // The conflict guard, when it runs, must exclude the edited row itself.
    if (mockBooking.findOne.mock.calls.length) {
      const where = mockBooking.findOne.mock.calls[0][0].where;
      expect(where.id[Op.ne]).toBe(booking.id);
    }
  });

  test("the response carries the updated booking object", async () => {
    const booking = makeBooking();
    mockBooking.findByPk.mockResolvedValue(booking);
    mockBooking.findOne.mockResolvedValue(null);

    const res = await request(app)
      .patch("/api/bookings/42")
      .set("Authorization", `Bearer ${tokenFor("FM")}`)
      .send({ driver_name: "Updated Driver" });

    expect(res.status).toBe(200);
    expect(res.body.booking).toBeDefined();
    expect(res.body.booking.booking_ref).toBe("FG-TZ01");
  });
});

describe("GET /:ref — public Driver Pass reflects the latest row, no-store", () => {
  test("returns the current slot + status from the DB", async () => {
    mockBooking.findOne.mockResolvedValue(
      makeBooking({ status: "Cancelled", slot_start: new Date("2026-07-27T10:01:00.000Z") })
    );
    const res = await request(app).get("/api/bookings/FG-TZ01");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("Cancelled");
    expect(new Date(res.body.slot_start).toISOString()).toBe("2026-07-27T10:01:00.000Z");
  });

  test("sends no-store cache headers", async () => {
    mockBooking.findOne.mockResolvedValue(makeBooking());
    const res = await request(app).get("/api/bookings/FG-TZ01");

    expect(res.headers["cache-control"]).toMatch(/no-store/);
    expect(res.headers["pragma"]).toBe("no-cache");
    expect(res.headers["expires"]).toBe("0");
  });

  test("no-store headers are present even on a 404", async () => {
    mockBooking.findOne.mockResolvedValue(null);
    const res = await request(app).get("/api/bookings/FG-NONE");
    expect(res.status).toBe(404);
    expect(res.headers["cache-control"]).toMatch(/no-store/);
  });
});
