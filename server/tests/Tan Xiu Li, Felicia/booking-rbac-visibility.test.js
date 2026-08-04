// Backend tests — Logistics booking visibility RBAC (§9).
// Ownership is server-resolved from the authenticated account (never a client
// query/body): FM sees all units, Tenant only their own tenantId, Staff only
// their managerId's unit, a manager-less Staff sees none, and /all stays FM-only.
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const mockBooking = { create: jest.fn(), findAll: jest.fn(), findByPk: jest.fn(), findOne: jest.fn() };
const mockUser = { findByPk: jest.fn() };
jest.mock('../../models', () => ({ Booking: mockBooking, User: mockUser }));

delete process.env.WHATSAPP_ENABLED;
process.env.APP_SECRET = 'test-secret';

const bookingRouter = require('../../routes/booking');

const app = express();
app.use(express.json());
app.use('/api/bookings', bookingRouter);

// DB-backed auth: verifyToken re-reads the account; the DB role/managerId wins.
const DB_USERS = {
  1: { id: 1, role: 'FM', isActive: true },
  7: { id: 7, role: 'Tenant', isActive: true },
  9: { id: 9, role: 'Staff', isActive: true, managerId: 50 },
  8: { id: 8, role: 'Staff', isActive: true, managerId: null }, // no tenant/unit link
};
const token = (id, role) => jwt.sign({ id, role }, process.env.APP_SECRET);

const validBody = {
  transport_company: 'NinjaVan',
  license_plate: 'GBG 1234M',
  driver_phone: '+6591234567',
  loading_bay: 'Bay A',
  slot_start: '2026-08-10T02:00:00.000Z',
  slot_end: '2026-08-10T03:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUser.findByPk.mockImplementation((id) => Promise.resolve(DB_USERS[id] || null));
  mockBooking.findAll.mockResolvedValue([]);
  mockBooking.findOne.mockResolvedValue(null); // no slot clash
  mockBooking.create.mockImplementation(async (v) => ({ id: 99, ...v }));
});

describe('GET /api/bookings — list visibility', () => {
  test('FM list is unscoped (all units)', async () => {
    await request(app).get('/api/bookings/').set('Authorization', `Bearer ${token(1, 'FM')}`);
    expect(mockBooking.findAll).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  test('Staff list is scoped to their managerId tenant/unit', async () => {
    await request(app).get('/api/bookings/').set('Authorization', `Bearer ${token(9, 'Staff')}`);
    expect(mockBooking.findAll).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 50 } }));
  });

  test('a Staff member with no managerId sees no bookings (matches nothing)', async () => {
    await request(app).get('/api/bookings/').set('Authorization', `Bearer ${token(8, 'Staff')}`);
    expect(mockBooking.findAll).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: -1 } }));
  });

  test('Tenant cannot widen visibility via a ?tenantId query — still scoped to own id', async () => {
    await request(app).get('/api/bookings/?tenantId=999').set('Authorization', `Bearer ${token(7, 'Tenant')}`);
    expect(mockBooking.findAll).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 7 } }));
  });
});

describe('POST /api/bookings/create — ownership is server-resolved', () => {
  test('Staff cannot override ownership through body.tenantId (resolves from managerId)', async () => {
    const res = await request(app)
      .post('/api/bookings/create')
      .set('Authorization', `Bearer ${token(9, 'Staff')}`)
      .send({ ...validBody, tenantId: 999 });
    expect(res.status).toBe(201);
    expect(mockBooking.create).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 50 }));
  });

  test('Tenant cannot override ownership through body.tenantId (resolves to own id)', async () => {
    const res = await request(app)
      .post('/api/bookings/create')
      .set('Authorization', `Bearer ${token(7, 'Tenant')}`)
      .send({ ...validBody, tenantId: 999 });
    expect(res.status).toBe(201);
    expect(mockBooking.create).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 7 }));
  });
});

describe('GET /api/bookings/all — FM only', () => {
  test('FM is allowed', async () => {
    const res = await request(app).get('/api/bookings/all').set('Authorization', `Bearer ${token(1, 'FM')}`);
    expect(res.status).toBe(200);
  });

  test('Tenant is rejected (403)', async () => {
    const res = await request(app).get('/api/bookings/all').set('Authorization', `Bearer ${token(7, 'Tenant')}`);
    expect(res.status).toBe(403);
  });

  test('Staff is rejected (403)', async () => {
    const res = await request(app).get('/api/bookings/all').set('Authorization', `Bearer ${token(9, 'Staff')}`);
    expect(res.status).toBe(403);
  });
});
