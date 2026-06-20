// Backend tests — Smart Logistics booking CRUD + WhatsApp (disabled/mock-safe).
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");

const mockBooking = {
  create: jest.fn(),
  findAll: jest.fn(),
  findByPk: jest.fn(),
  findOne: jest.fn(),
};

jest.mock("../../models", () => ({ Booking: mockBooking }));

// Ensure WhatsApp runs in disabled/simulated mode (no real sends, no crash).
delete process.env.WHATSAPP_ENABLED;
process.env.APP_SECRET = "test-secret";

const bookingRouter = require("../../routes/booking");
const whatsapp = require("../../services/whatsappService");

const app = express();
app.use(express.json());
app.use("/api/bookings", bookingRouter);

const tokenFor = (role) => jwt.sign({ id: 7, role, email: `${role}@harrison.com` }, process.env.APP_SECRET);

const validBody = {
  transport_company: "NinjaVan",
  license_plate: "GBG 1234M",
  driver_phone: "+6591234567",
  loading_bay: "Bay A",
};

describe("Booking routes", () => {
  beforeEach(() => jest.clearAllMocks());

  test("POST /create rejects missing required fields (400)", async () => {
    const res = await request(app)
      .post("/api/bookings/create")
      .set("Authorization", `Bearer ${tokenFor("FM")}`)
      .send({ transport_company: "NinjaVan" });
    expect(res.status).toBe(400);
  });

  test("POST /create creates a Pending booking (201)", async () => {
    mockBooking.create.mockResolvedValue({ id: 1, ...validBody, status: "Pending" });
    const res = await request(app)
      .post("/api/bookings/create")
      .set("Authorization", `Bearer ${tokenFor("FM")}`)
      .send(validBody);
    expect(res.status).toBe(201);
    expect(mockBooking.create).toHaveBeenCalledWith(expect.objectContaining({ status: "Pending" }));
  });

  test("GET / requires authentication (401)", async () => {
    const res = await request(app).get("/api/bookings/");
    expect(res.status).toBe(401);
  });

  test("GET / returns a list for an authenticated FM (200)", async () => {
    mockBooking.findAll.mockResolvedValue([{ id: 1, status: "Pending" }]);
    const res = await request(app).get("/api/bookings/").set("Authorization", `Bearer ${tokenFor("FM")}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test("GET / scopes a Tenant to their own bookings", async () => {
    mockBooking.findAll.mockResolvedValue([]);
    await request(app).get("/api/bookings/").set("Authorization", `Bearer ${tokenFor("Tenant")}`);
    expect(mockBooking.findAll).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 7 } }));
  });

  test("PATCH /:id/status by Staff updates status + simulates WhatsApp (200)", async () => {
    const update = jest.fn().mockResolvedValue(true);
    mockBooking.findByPk.mockResolvedValue({ id: 1, ...validBody, booking_ref: "FG-AAA", update });
    const res = await request(app)
      .patch("/api/bookings/1/status")
      .set("Authorization", `Bearer ${tokenFor("Staff")}`)
      .send({ status: "Confirmed" });
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith({ status: "Confirmed" });
    expect(res.body.whatsapp).toEqual(expect.objectContaining({ simulated: true, success: true }));
  });

  test("PATCH /:id/status to Completed fires a next-in-line alert", async () => {
    const update = jest.fn().mockResolvedValue(true);
    mockBooking.findByPk.mockResolvedValue({ id: 1, ...validBody, booking_ref: "FG-AAA", update });
    mockBooking.findOne.mockResolvedValue({ id: 2, ...validBody, booking_ref: "FG-NEXT" });
    const res = await request(app)
      .patch("/api/bookings/1/status")
      .set("Authorization", `Bearer ${tokenFor("FM")}`)
      .send({ status: "Completed" });
    expect(res.status).toBe(200);
    expect(res.body.nextInLine).toBe("FG-NEXT");
  });

  test("PATCH /:id/status is forbidden for Tenant (403)", async () => {
    const res = await request(app)
      .patch("/api/bookings/1/status")
      .set("Authorization", `Bearer ${tokenFor("Tenant")}`)
      .send({ status: "Confirmed" });
    expect(res.status).toBe(403);
  });

  test("PATCH /:id/status returns 404 when booking missing", async () => {
    mockBooking.findByPk.mockResolvedValue(null);
    const res = await request(app)
      .patch("/api/bookings/999/status")
      .set("Authorization", `Bearer ${tokenFor("FM")}`)
      .send({ status: "Confirmed" });
    expect(res.status).toBe(404);
  });

  test("PATCH /:id/status rejects an invalid status (400)", async () => {
    const res = await request(app)
      .patch("/api/bookings/1/status")
      .set("Authorization", `Bearer ${tokenFor("FM")}`)
      .send({ status: "Teleported" });
    expect(res.status).toBe(400);
  });

  test("PATCH /:id/cancel soft-cancels a booking (200)", async () => {
    const update = jest.fn().mockResolvedValue(true);
    mockBooking.findByPk.mockResolvedValue({ id: 1, ...validBody, booking_ref: "FG-AAA", tenantId: 7, update });
    const res = await request(app)
      .patch("/api/bookings/1/cancel")
      .set("Authorization", `Bearer ${tokenFor("FM")}`);
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith({ status: "Cancelled" });
  });
});

describe("WhatsApp service (disabled mode)", () => {
  test("is not configured without WHATSAPP_ENABLED=true", () => {
    expect(whatsapp.isConfigured()).toBe(false);
  });

  test("sendBookingConfirmed returns a simulated success and does not throw", async () => {
    const result = await whatsapp.sendBookingConfirmed({ driver_phone: "+6500000000", loading_bay: "Bay A" });
    expect(result).toEqual(expect.objectContaining({ success: true, simulated: true }));
  });

  test("masks the API key in logs", () => {
    expect(whatsapp._maskKey("supersecret1234")).toBe("****1234");
    expect(whatsapp._maskKey("")).toBe("(none)");
  });
});
