// Backend tests — dual-mode loading-bay gate verification
// (POST /api/bookings/gate-verification). Booking/User/GateAccessLog are mocked,
// so no DB is required; WhatsApp runs in disabled/simulated mode.
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");

const mockBooking = { create: jest.fn(), findAll: jest.fn(), findByPk: jest.fn(), findOne: jest.fn() };
const mockUser = { findByPk: jest.fn() };
const mockGateAccessLog = { create: jest.fn() };
jest.mock("../../models", () => ({ Booking: mockBooking, User: mockUser, GateAccessLog: mockGateAccessLog }));

delete process.env.WHATSAPP_ENABLED;
process.env.APP_SECRET = "test-secret";
process.env.GATE_EARLY_MINUTES = "30";
process.env.GATE_LATE_MINUTES = "60";

const bookingRouter = require("../../routes/booking");
const whatsapp = require("../../services/whatsappService");

const app = express();
app.use(express.json());
app.use("/api/bookings", bookingRouter);

const ID_BY_ROLE = { FM: 1, Staff: 9, Tenant: 7 };
const DB_USERS = {
  1: { id: 1, role: "FM", isActive: true, email: "fm@harrison.com" },
  7: { id: 7, role: "Tenant", isActive: true, email: "tenant@harrison.com" },
  9: { id: 9, role: "Staff", isActive: true, email: "staff@harrison.com" },
};
const tokenFor = (role) => jwt.sign({ id: ID_BY_ROLE[role], role }, process.env.APP_SECRET);

const bookingWith = (status, extra = {}) => ({
  id: 1,
  booking_ref: "FG-ABC123",
  transport_company: "NinjaVan",
  driver_name: "Tester Tan",
  driver_phone: "+6591234567",
  license_plate: "GBG 1234M",
  loading_bay: "Bay A",
  slot_start: null,
  slot_end: null,
  status,
  arrived_at: null,
  completed_at: null,
  update: jest.fn().mockResolvedValue(true),
  ...extra,
});

// Slot helpers relative to "now" so window tests are deterministic.
const minutesFromNow = (m) => new Date(Date.now() + m * 60000).toISOString();

const post = (body, role = "FM") =>
  request(app)
    .post("/api/bookings/gate-verification")
    .set("Authorization", `Bearer ${tokenFor(role)}`)
    .send(body);

beforeEach(() => {
  jest.clearAllMocks();
  mockUser.findByPk.mockImplementation((id) => Promise.resolve(DB_USERS[id] || null));
  mockGateAccessLog.create.mockResolvedValue({ id: "log-1" });
});

// ---------------------------------------------------------------------------
describe("Access control (FM only)", () => {
  test("1/2. Staff is denied (403) and never reaches the booking lookup", async () => {
    const res = await post({ action: "entry", bookingRef: "FG-ABC123" }, "Staff");
    expect(res.status).toBe(403);
    expect(mockBooking.findOne).not.toHaveBeenCalled();
  });

  test("2. Tenant is denied (403)", async () => {
    const res = await post({ action: "entry", bookingRef: "FG-ABC123" }, "Tenant");
    expect(res.status).toBe(403);
    expect(mockBooking.findOne).not.toHaveBeenCalled();
  });

  test("unauthenticated is denied (401)", async () => {
    const res = await request(app).post("/api/bookings/gate-verification").send({ action: "entry", bookingRef: "FG-ABC123" });
    expect(res.status).toBe(401);
  });
});

describe("Request validation", () => {
  test("3. invalid action → 400 INVALID_ACTION", async () => {
    const res = await post({ action: "teleport", bookingRef: "FG-ABC123" });
    expect(res.status).toBe(400);
    expect(res.body.reasonCode).toBe("INVALID_ACTION");
    expect(mockBooking.findOne).not.toHaveBeenCalled();
  });

  test("4. booking not found → DENIED BOOKING_NOT_FOUND", async () => {
    mockBooking.findOne.mockResolvedValueOnce(null);
    const res = await post({ action: "entry", bookingRef: "FG-NOPE", verificationMode: "automatic", plateSource: "ocr", observedPlate: "GBG1234M" });
    expect(res.status).toBe(200);
    expect(res.body.access).toBe("DENIED");
    expect(res.body.reasonCode).toBe("BOOKING_NOT_FOUND");
  });
});

describe("Entry rules", () => {
  test("5. Pending entry is denied automatically (BOOKING_NOT_CONFIRMED)", async () => {
    const b = bookingWith("Pending");
    mockBooking.findOne.mockResolvedValueOnce(b);
    const res = await post({ action: "entry", bookingRef: "FG-ABC123", verificationMode: "automatic", plateSource: "ocr", observedPlate: "GBG 1234M" });
    expect(res.body.access).toBe("DENIED");
    expect(res.body.reasonCode).toBe("BOOKING_NOT_CONFIRMED");
    expect(b.update).not.toHaveBeenCalled();
  });

  test("6. Confirmed entry with matching plate is GRANTED and marks Arrived", async () => {
    const b = bookingWith("Confirmed");
    mockBooking.findOne.mockResolvedValueOnce(b);
    const res = await post({ action: "entry", bookingRef: "FG-ABC123", verificationMode: "automatic", plateSource: "ocr", plateConfidence: 92, observedPlate: "GBG 1234M" });
    expect(res.body.access).toBe("GRANTED");
    expect(res.body.reasonCode).toBe("VERIFIED");
    expect(res.body.plateMatched).toBe(true);
    // No slot on the booking → schedule validation flagged as unavailable.
    expect(res.body.warning).toBe("SCHEDULE_UNVERIFIED");
    expect(b.update.mock.calls[0][0]).toEqual(expect.objectContaining({ status: "Arrived" }));
  });

  test("7. Confirmed entry with mismatched plate is DENIED (not reviewable)", async () => {
    const b = bookingWith("Confirmed");
    mockBooking.findOne.mockResolvedValueOnce(b);
    const res = await post({ action: "entry", bookingRef: "FG-ABC123", verificationMode: "automatic", plateSource: "ocr", observedPlate: "GBG 9999Z" });
    expect(res.body.access).toBe("DENIED");
    expect(res.body.reasonCode).toBe("PLATE_MISMATCH");
    expect(res.body.manualReviewRequired).toBe(false);
    expect(b.update).not.toHaveBeenCalled();
  });

  test("8. Missing plate in automatic mode is denied (no barrier)", async () => {
    const b = bookingWith("Confirmed");
    mockBooking.findOne.mockResolvedValueOnce(b);
    const res = await post({ action: "entry", bookingRef: "FG-ABC123", verificationMode: "automatic", plateSource: "ocr" });
    expect(res.body.access).toBe("DENIED");
    expect(["OCR_UNREADABLE", "PLATE_REQUIRED"]).toContain(res.body.reasonCode);
    expect(b.update).not.toHaveBeenCalled();
  });

  test("13. Cancelled booking is denied and cannot be overridden", async () => {
    const b = bookingWith("Cancelled");
    mockBooking.findOne.mockResolvedValueOnce(b);
    const res = await post({
      action: "entry", bookingRef: "FG-ABC123", verificationMode: "manual", plateSource: "manual",
      observedPlate: "GBG 1234M", manualOverride: true, overrideReason: "let them in",
    });
    expect(res.body.access).toBe("DENIED");
    expect(res.body.reasonCode).toBe("BOOKING_CANCELLED");
    expect(res.body.overrideUsed).toBe(false);
    expect(b.update).not.toHaveBeenCalled();
  });

  test("14. Too-early arrival is denied", async () => {
    const b = bookingWith("Confirmed", { slot_start: minutesFromNow(300), slot_end: minutesFromNow(360) });
    mockBooking.findOne.mockResolvedValueOnce(b);
    const res = await post({ action: "entry", bookingRef: "FG-ABC123", verificationMode: "automatic", plateSource: "ocr", observedPlate: "GBG 1234M" });
    expect(res.body.access).toBe("DENIED");
    expect(res.body.reasonCode).toBe("TOO_EARLY");
    expect(b.update).not.toHaveBeenCalled();
  });

  test("15. Too-late arrival is denied", async () => {
    const b = bookingWith("Confirmed", { slot_start: minutesFromNow(-360), slot_end: minutesFromNow(-300) });
    mockBooking.findOne.mockResolvedValueOnce(b);
    const res = await post({ action: "entry", bookingRef: "FG-ABC123", verificationMode: "automatic", plateSource: "ocr", observedPlate: "GBG 1234M" });
    expect(res.body.access).toBe("DENIED");
    expect(res.body.reasonCode).toBe("TOO_LATE");
  });

  test("16. Configured early grace (30 min) is respected — 20 min early is granted", async () => {
    const b = bookingWith("Confirmed", { slot_start: minutesFromNow(20), slot_end: minutesFromNow(80) });
    mockBooking.findOne.mockResolvedValueOnce(b);
    const res = await post({ action: "entry", bookingRef: "FG-ABC123", verificationMode: "automatic", plateSource: "ocr", observedPlate: "GBG 1234M" });
    expect(res.body.access).toBe("GRANTED");
    expect(b.update.mock.calls[0][0]).toEqual(expect.objectContaining({ status: "Arrived" }));
  });

  test("17. Repeated entry is idempotent — no second transition, no re-notify", async () => {
    const b = bookingWith("Arrived");
    mockBooking.findOne.mockResolvedValueOnce(b);
    const waSpy = jest.spyOn(whatsapp, "sendBookingArrived");
    const res = await post({ action: "entry", bookingRef: "FG-ABC123", verificationMode: "automatic", plateSource: "ocr", observedPlate: "GBG 1234M" });
    expect(res.body.access).toBe("GRANTED");
    expect(res.body.reasonCode).toBe("ALREADY_ARRIVED");
    expect(b.update).not.toHaveBeenCalled();
    expect(waSpy).not.toHaveBeenCalled();
    waSpy.mockRestore();
  });

  test("plate normalisation lets differently-formatted plates match end-to-end", async () => {
    const b = bookingWith("Confirmed"); // booked "GBG 1234M"
    mockBooking.findOne.mockResolvedValueOnce(b);
    const res = await post({ action: "entry", bookingRef: "FG-ABC123", verificationMode: "manual", plateSource: "manual", observedPlate: "gbg-1234 m" });
    expect(res.body.access).toBe("GRANTED");
    expect(res.body.plateMatched).toBe(true);
  });
});

describe("OCR quality gate (server-authoritative)", () => {
  test("automatic OCR garbage (YWERETANCLPPEMYY) is OCR_UNREADABLE, not a mismatch", async () => {
    const b = bookingWith("Confirmed", { license_plate: "SKL9081A" });
    mockBooking.findOne.mockResolvedValueOnce(b);
    const res = await post({ action: "entry", bookingRef: "FG-ABC123", verificationMode: "automatic", plateSource: "ocr", observedPlate: "YWERETANCLPPEMYY" });
    expect(res.body.access).toBe("DENIED");
    expect(res.body.reasonCode).toBe("OCR_UNREADABLE");
    // Never claims a detected plate that differs — it simply could not be read.
    expect(res.body.plateMatched).toBeNull();
    expect(res.body.observedPlate).toBeNull();
    expect(b.update).not.toHaveBeenCalled();
  });

  test("OCR_UNREADABLE requires manual review", async () => {
    const b = bookingWith("Confirmed", { license_plate: "SKL9081A" });
    mockBooking.findOne.mockResolvedValueOnce(b);
    const res = await post({ action: "entry", bookingRef: "FG-ABC123", verificationMode: "automatic", plateSource: "ocr", observedPlate: "TOYOTA" });
    expect(res.body.reasonCode).toBe("OCR_UNREADABLE");
    expect(res.body.manualReviewRequired).toBe(true);
  });

  test("automatic OCR with SKL9081A against an SKL9081A booking is GRANTED", async () => {
    const b = bookingWith("Confirmed", { license_plate: "SKL9081A" });
    mockBooking.findOne.mockResolvedValueOnce(b);
    const res = await post({ action: "entry", bookingRef: "FG-ABC123", verificationMode: "automatic", plateSource: "ocr", plateConfidence: 90, observedPlate: "SKL9081A" });
    expect(res.body.access).toBe("GRANTED");
    expect(res.body.reasonCode).toBe("VERIFIED");
    expect(res.body.plateMatched).toBe(true);
  });

  test("automatic OCR with a plausible DIFFERENT plate (SBA5678Z) is PLATE_MISMATCH", async () => {
    const b = bookingWith("Confirmed", { license_plate: "SKL9081A" });
    mockBooking.findOne.mockResolvedValueOnce(b);
    const res = await post({ action: "entry", bookingRef: "FG-ABC123", verificationMode: "automatic", plateSource: "ocr", observedPlate: "SBA5678Z" });
    expect(res.body.access).toBe("DENIED");
    expect(res.body.reasonCode).toBe("PLATE_MISMATCH");
    expect(res.body.observedPlate).toBe("SBA5678Z");
    expect(b.update).not.toHaveBeenCalled();
  });

  test("automatic OCR 'GBG 1234 M' still matches a GBG1234M booking", async () => {
    const b = bookingWith("Confirmed"); // booked "GBG 1234M"
    mockBooking.findOne.mockResolvedValueOnce(b);
    const res = await post({ action: "entry", bookingRef: "FG-ABC123", verificationMode: "automatic", plateSource: "ocr", observedPlate: "GBG 1234 M" });
    expect(res.body.access).toBe("GRANTED");
    expect(res.body.plateMatched).toBe(true);
  });

  test("a plausible plate with clearly-unusable confidence is OCR_UNREADABLE", async () => {
    const b = bookingWith("Confirmed"); // booked "GBG 1234M"
    mockBooking.findOne.mockResolvedValueOnce(b);
    const res = await post({ action: "entry", bookingRef: "FG-ABC123", verificationMode: "automatic", plateSource: "ocr", plateConfidence: 2, observedPlate: "GBG1234M" });
    expect(res.body.reasonCode).toBe("OCR_UNREADABLE");
    expect(b.update).not.toHaveBeenCalled();
  });

  test("a plausible matching plate with NO confidence is still GRANTED (absence never rejects)", async () => {
    const b = bookingWith("Confirmed"); // booked "GBG 1234M"
    mockBooking.findOne.mockResolvedValueOnce(b);
    const res = await post({ action: "entry", bookingRef: "FG-ABC123", verificationMode: "automatic", plateSource: "ocr", observedPlate: "GBG1234M" });
    expect(res.body.access).toBe("GRANTED");
    expect(res.body.plateMatched).toBe(true);
  });

  test("manual mode is unaffected by the OCR plausibility gate", async () => {
    // A manual observed value that is not a "plausible" auto-plate is still compared
    // as the FM typed it (mismatch here), never silently turned into OCR_UNREADABLE.
    const b = bookingWith("Confirmed", { license_plate: "SKL9081A" });
    mockBooking.findOne.mockResolvedValueOnce(b);
    const res = await post({ action: "entry", bookingRef: "FG-ABC123", verificationMode: "manual", plateSource: "manual", observedPlate: "SBA5678Z" });
    expect(res.body.reasonCode).toBe("PLATE_MISMATCH");
  });
});

// The controlled OCR character-repair happens CLIENT-side on the grammar alone
// (SBA56787 → SBA5678Z), so the server receives the already-repaired plate. These
// assert the server's authoritative decision on that repaired value end-to-end.
describe("Controlled OCR repair — decision behaviour (server receives repaired plate)", () => {
  test("repaired SBA5678Z against an SBA5678Z booking is VERIFIED", async () => {
    const b = bookingWith("Confirmed", { license_plate: "SBA5678Z" });
    mockBooking.findOne.mockResolvedValueOnce(b);
    const res = await post({ action: "entry", bookingRef: "FG-ABC123", verificationMode: "automatic", plateSource: "ocr", plateConfidence: 47, observedPlate: "SBA5678Z" });
    expect(res.body.access).toBe("GRANTED");
    expect(res.body.reasonCode).toBe("VERIFIED");
    expect(res.body.plateMatched).toBe(true);
    expect(b.update.mock.calls[0][0]).toEqual(expect.objectContaining({ status: "Arrived" }));
  });

  test("repaired SBA5678Z against an SKL9081A booking is PLATE_MISMATCH", async () => {
    const b = bookingWith("Confirmed", { license_plate: "SKL9081A" });
    mockBooking.findOne.mockResolvedValueOnce(b);
    const res = await post({ action: "entry", bookingRef: "FG-ABC123", verificationMode: "automatic", plateSource: "ocr", observedPlate: "SBA5678Z" });
    expect(res.body.access).toBe("DENIED");
    expect(res.body.reasonCode).toBe("PLATE_MISMATCH");
    expect(res.body.observedPlate).toBe("SBA5678Z");
    expect(b.update).not.toHaveBeenCalled();
  });

  test("an OCR value with NO unique repair reaches the server as unreadable → OCR_UNREADABLE", async () => {
    // The client could not produce a plausible plate; the server independently
    // treats the leftover raw value as unreadable (rescan), never a mismatch.
    const b = bookingWith("Confirmed", { license_plate: "SBA5678Z" });
    mockBooking.findOne.mockResolvedValueOnce(b);
    const res = await post({ action: "entry", bookingRef: "FG-ABC123", verificationMode: "automatic", plateSource: "ocr", observedPlate: "SSSA" });
    expect(res.body.access).toBe("DENIED");
    expect(res.body.reasonCode).toBe("OCR_UNREADABLE");
    expect(res.body.plateMatched).toBeNull();
    expect(res.body.observedPlate).toBeNull();
  });

  test("simulated-LPR behaviour is unchanged by the repair work", async () => {
    const b = bookingWith("Confirmed", { license_plate: "SBA5678Z" });
    mockBooking.findOne.mockResolvedValueOnce(b);
    const res = await post({ action: "entry", bookingRef: "FG-ABC123", verificationMode: "automatic", plateSource: "simulation", observedPlate: "SBA5678Z" });
    expect(res.body.access).toBe("GRANTED");
    expect(res.body.reasonCode).toBe("VERIFIED");
    expect(res.body.plateMatched).toBe(true);
  });
});

describe("Manual mode + override", () => {
  test("9. Manual mode with matching plate is GRANTED", async () => {
    const b = bookingWith("Confirmed");
    mockBooking.findOne.mockResolvedValueOnce(b);
    const res = await post({ action: "entry", bookingRef: "FG-ABC123", verificationMode: "manual", plateSource: "manual", observedPlate: "GBG 1234M" });
    expect(res.body.access).toBe("GRANTED");
    expect(res.body.verificationMode).toBe("manual");
  });

  test("10. Manual mismatch WITHOUT override is denied", async () => {
    const b = bookingWith("Confirmed");
    mockBooking.findOne.mockResolvedValueOnce(b);
    const res = await post({ action: "entry", bookingRef: "FG-ABC123", verificationMode: "manual", plateSource: "manual", observedPlate: "GBG 9999Z", manualOverride: false });
    expect(res.body.access).toBe("DENIED");
    expect(res.body.reasonCode).toBe("PLATE_MISMATCH");
    expect(b.update).not.toHaveBeenCalled();
  });

  test("11. Genuine plate mismatch CANNOT be overridden into a grant", async () => {
    const b = bookingWith("Confirmed");
    mockBooking.findOne.mockResolvedValueOnce(b);
    const res = await post({
      action: "entry", bookingRef: "FG-ABC123", verificationMode: "manual", plateSource: "manual",
      observedPlate: "GBG 9999Z", manualOverride: true, overrideReason: "Plate typed by FM does not match database",
    });
    expect(res.body.access).toBe("DENIED");
    expect(res.body.reasonCode).toBe("PLATE_MISMATCH");
    expect(res.body.overrideUsed).toBe(false);
    expect(b.update).not.toHaveBeenCalled();
  });

  test("12. Valid manual override on technical capture failure (OCR_UNREADABLE) with matching observed plate is GRANTED and audited", async () => {
    const b = bookingWith("Confirmed");
    mockBooking.findOne.mockResolvedValueOnce(b);
    const res = await post({
      action: "entry", bookingRef: "FG-ABC123", verificationMode: "manual", plateSource: "ocr", plateConfidence: 0,
      observedPlate: "GBG 1234M", manualOverride: true, overrideReason: "Camera lens foggy; FM verified physical plate",
    });
    expect(res.body.access).toBe("GRANTED");
    expect(res.body.overrideUsed).toBe(true);
    expect(b.update.mock.calls[0][0]).toEqual(expect.objectContaining({ status: "Arrived" }));

    const auditArg = mockGateAccessLog.create.mock.calls[0][0];
    expect(auditArg).toEqual(expect.objectContaining({
      decision: "granted",
      overrideUsed: true,
      overrideReason: "Camera lens foggy; FM verified physical plate",
      fmId: 1,
      fmEmail: "fm@harrison.com",
    }));
  });
});

describe("Same-bay occupancy protection", () => {
  test("entry denied (BAY_OCCUPIED) when another booking is currently Arrived in the same loading bay", async () => {
    const b = bookingWith("Confirmed", { loading_bay: "Bay A" });
    const existingOccupant = { id: 99, booking_ref: "FG-OCCUPIED", loading_bay: "Bay A", status: "Arrived" };
    mockBooking.findOne
      .mockResolvedValueOnce(b)                // lookup requested booking
      .mockResolvedValueOnce(existingOccupant); // lookup occupancy in same bay

    const res = await post({ action: "entry", bookingRef: "FG-ABC123", verificationMode: "automatic", plateSource: "ocr", plateConfidence: 90, observedPlate: "GBG 1234M" });
    expect(res.body.access).toBe("DENIED");
    expect(res.body.reasonCode).toBe("BAY_OCCUPIED");
    expect(res.body.message).toContain("occupied by the previous vehicle");
    expect(b.update).not.toHaveBeenCalled();
  });

  test("manual mode and manual override CANNOT bypass BAY_OCCUPIED", async () => {
    const b = bookingWith("Confirmed", { loading_bay: "Bay A" });
    const existingOccupant = { id: 99, booking_ref: "FG-OCCUPIED", loading_bay: "Bay A", status: "Arrived" };
    mockBooking.findOne
      .mockResolvedValueOnce(b)
      .mockResolvedValueOnce(existingOccupant);

    const res = await post({
      action: "entry", bookingRef: "FG-ABC123", verificationMode: "manual", plateSource: "manual",
      observedPlate: "GBG 1234M", manualOverride: true, overrideReason: "Let them in anyway",
    });
    expect(res.body.access).toBe("DENIED");
    expect(res.body.reasonCode).toBe("BAY_OCCUPIED");
    expect(res.body.overrideUsed).toBe(false);
    expect(b.update).not.toHaveBeenCalled();
  });

  test("Arrived booking in a DIFFERENT loading bay does not block entry", async () => {
    const b = bookingWith("Confirmed", { loading_bay: "Bay A" });
    mockBooking.findOne
      .mockResolvedValueOnce(b)   // lookup requested booking
      .mockResolvedValueOnce(null); // no Arrived occupant in Bay A

    const res = await post({ action: "entry", bookingRef: "FG-ABC123", verificationMode: "automatic", plateSource: "ocr", plateConfidence: 90, observedPlate: "GBG 1234M" });
    expect(res.body.access).toBe("GRANTED");
    expect(res.body.reasonCode).toBe("VERIFIED");
    expect(b.update).toHaveBeenCalled();
  });
});

describe("Exit rules", () => {
  test("18. Exit requires a recorded arrival — Confirmed (not Arrived) is denied", async () => {
    const b = bookingWith("Confirmed");
    mockBooking.findOne.mockResolvedValueOnce(b);
    const res = await post({ action: "exit", bookingRef: "FG-ABC123", verificationMode: "manual", plateSource: "manual", observedPlate: "GBG 1234M" });
    expect(res.body.access).toBe("DENIED");
    expect(res.body.reasonCode).toBe("NOT_ARRIVED");
    expect(b.update).not.toHaveBeenCalled();
  });

  test("19. Successful exit completes the booking and notifies only the next Confirmed booking in same bay", async () => {
    const b = bookingWith("Arrived");
    mockBooking.findOne
      .mockResolvedValueOnce(b)                                                // lookup
      .mockResolvedValueOnce({ id: 2, booking_ref: "FG-NEXT", driver_phone: "+6580000000", loading_bay: "Bay A", status: "Confirmed" }); // next-in-line
    const res = await post({ action: "exit", bookingRef: "FG-ABC123", verificationMode: "manual", plateSource: "manual", observedPlate: "GBG 1234M" });
    expect(res.body.access).toBe("GRANTED");
    expect(b.update.mock.calls[0][0]).toEqual(expect.objectContaining({ status: "Completed" }));
    expect(res.body.nextInLine).toBe("FG-NEXT");

    // Verify next-in-line query filtered status: 'Confirmed'
    const findCall = mockBooking.findOne.mock.calls[1][0];
    expect(findCall.where.status).toBe("Confirmed");
  });

  test("20. Repeated exit does not resend WhatsApp or re-trigger next-in-line", async () => {
    const b = bookingWith("Completed");
    mockBooking.findOne.mockResolvedValueOnce(b);
    const completedSpy = jest.spyOn(whatsapp, "sendBookingCompleted");
    const nextSpy = jest.spyOn(whatsapp, "sendNextInLine");
    const res = await post({ action: "exit", bookingRef: "FG-ABC123", verificationMode: "manual", plateSource: "manual", observedPlate: "GBG 1234M" });
    expect(res.body.access).toBe("GRANTED");
    expect(res.body.reasonCode).toBe("ALREADY_COMPLETED");
    expect(b.update).not.toHaveBeenCalled();
    expect(completedSpy).not.toHaveBeenCalled();
    expect(nextSpy).not.toHaveBeenCalled();
    expect(mockBooking.findOne).toHaveBeenCalledTimes(1); // no next-in-line lookup
    completedSpy.mockRestore();
    nextSpy.mockRestore();
  });
});

describe("Audit + fail-closed", () => {
  test("22. Audit metadata carries no images/JWT/password/secret fields", async () => {
    const b = bookingWith("Confirmed");
    mockBooking.findOne.mockResolvedValueOnce(b);
    await post({ action: "entry", bookingRef: "FG-ABC123", verificationMode: "automatic", plateSource: "ocr", plateConfidence: 88, observedPlate: "GBG 1234M" });

    const auditArg = mockGateAccessLog.create.mock.calls[0][0];
    const keys = Object.keys(auditArg).map((k) => k.toLowerCase());
    for (const banned of ["image", "images", "frame", "photo", "jwt", "token", "password", "secret", "authorization"]) {
      expect(keys.some((k) => k.includes(banned))).toBe(false);
    }
    expect(auditArg).toEqual(expect.objectContaining({
      bookingRef: "FG-ABC123", action: "entry", decision: "granted", reasonCode: "VERIFIED",
    }));
  });

  test("a granted decision that cannot be audited fails CLOSED (500, no transition)", async () => {
    const b = bookingWith("Confirmed");
    mockBooking.findOne.mockResolvedValueOnce(b);
    mockGateAccessLog.create.mockRejectedValueOnce(new Error("audit db down"));
    const res = await post({ action: "entry", bookingRef: "FG-ABC123", verificationMode: "automatic", plateSource: "ocr", observedPlate: "GBG 1234M" });
    expect(res.status).toBe(500);
    expect(res.body.access).toBe("DENIED");
    expect(res.body.reasonCode).toBe("AUDIT_FAILED");
    expect(b.update).not.toHaveBeenCalled(); // audited BEFORE mutation → no status change
  });
});

describe("Concurrency (idempotent transitions)", () => {
  test("23. A duplicate scan on an already-transitioned booking makes no second change", async () => {
    // First scan sees Confirmed → grants + marks Arrived.
    const first = bookingWith("Confirmed");
    mockBooking.findOne.mockResolvedValueOnce(first);
    const res1 = await post({ action: "entry", bookingRef: "FG-ABC123", verificationMode: "automatic", plateSource: "ocr", observedPlate: "GBG 1234M" });
    expect(res1.body.access).toBe("GRANTED");
    expect(first.update).toHaveBeenCalledTimes(1);

    // Second (racing) scan now reads the row as Arrived (row lock serialised them).
    const second = bookingWith("Arrived");
    mockBooking.findOne.mockResolvedValueOnce(second);
    const res2 = await post({ action: "entry", bookingRef: "FG-ABC123", verificationMode: "automatic", plateSource: "ocr", observedPlate: "GBG 1234M" });
    expect(res2.body.reasonCode).toBe("ALREADY_ARRIVED");
    expect(second.update).not.toHaveBeenCalled();
  });
});
