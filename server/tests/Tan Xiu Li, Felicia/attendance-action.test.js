// Backend tests — POST /api/attendance/action (§3/§4).
// V-Patrol's operator-selected Check In / Check Out. Server-authoritative:
// explicit IN/OUT (never a blind toggle), server time, DB-resolved identity,
// per-cycle + business-state idempotency, and a preserved safe SecurityLog.
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const mockUser = { findByPk: jest.fn() };
const mockAttendance = { findAll: jest.fn(), create: jest.fn() };
const mockSecurityLog = { create: jest.fn() };
jest.mock('../../models', () => ({
  User: mockUser,
  Attendance: mockAttendance,
  SecurityLog: mockSecurityLog,
}));

process.env.APP_SECRET = 'test-secret';

const attendanceRouter = require('../../routes/attendance');
const { resetLogCooldowns } = require('../../services/securityAudit');

const app = express();
app.use(express.json());
app.use('/api/attendance', attendanceRouter);

const fmToken = jwt.sign({ id: 1, role: 'FM' }, process.env.APP_SECRET);
const staffToken = jwt.sign({ id: 60, role: 'Staff' }, process.env.APP_SECRET);

const activeUser = { id: 25, name: 'Tan Xiu Li, Felicia', role: 'Staff', isActive: true, isEnrolled: true };
const CYCLE_A = '11111111-1111-4111-8111-111111111111';
const CYCLE_B = '22222222-2222-4222-8222-222222222222';

const AUTH_USERS = {
  1: { id: 1, role: 'FM', isActive: true },
  60: { id: 60, role: 'Staff', isActive: true },
};
const primeDb = (extra = {}) => {
  const table = { ...AUTH_USERS, ...extra };
  mockUser.findByPk.mockImplementation((id) => Promise.resolve(table[id] ?? null));
};

const post = (body, token = fmToken) =>
  request(app).post('/api/attendance/action').set('Authorization', `Bearer ${token}`).send(body);

beforeEach(() => {
  jest.clearAllMocks();
  resetLogCooldowns();
  primeDb();
  mockAttendance.findAll.mockResolvedValue([]);
  mockAttendance.create.mockImplementation(async (v) => ({ ...v, timestamp: v.timestamp || new Date() }));
  mockSecurityLog.create.mockResolvedValue({});
});

describe('POST /api/attendance/action — auth + validation', () => {
  test('unauthenticated → 401', async () => {
    const res = await request(app).post('/api/attendance/action').send({ userId: 25, action: 'IN', cycleId: CYCLE_A });
    expect(res.status).toBe(401);
    expect(mockAttendance.create).not.toHaveBeenCalled();
  });

  test('Staff session → 403 (FM kiosk or trusted edge service only)', async () => {
    const res = await post({ userId: 25, action: 'IN', cycleId: CYCLE_A }, staffToken);
    expect(res.status).toBe(403);
    expect(mockAttendance.create).not.toHaveBeenCalled();
  });

  test('missing userId → 400', async () => {
    const res = await post({ action: 'IN', cycleId: CYCLE_A });
    expect(res.status).toBe(400);
  });

  test('invalid action → 400 (only IN or OUT)', async () => {
    primeDb({ 25: activeUser });
    for (const action of ['TOGGLE', 'in', 'out', '', null]) {
      const res = await post({ userId: 25, action, cycleId: CYCLE_A });
      expect(res.status).toBe(400);
    }
    expect(mockAttendance.create).not.toHaveBeenCalled();
  });

  test('missing / malformed cycleId → 400', async () => {
    primeDb({ 25: activeUser });
    for (const cycleId of [undefined, 'not-a-uuid', '123']) {
      const res = await post({ userId: 25, action: 'IN', cycleId });
      expect(res.status).toBe(400);
    }
    expect(mockAttendance.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/attendance/action — recording', () => {
  test('Check In after a completed recognition creates exactly one IN (server time, safe fields)', async () => {
    primeDb({ 25: activeUser });
    const res = await post({ userId: 25, action: 'IN', cameraLocation: 'Biometric Gantry', cycleId: CYCLE_A });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ result: 'CHECK_IN_RECORDED', recorded: true, worker: 'Tan Xiu Li, Felicia', role: 'Staff', currentStatus: 'IN' });
    expect(mockAttendance.create).toHaveBeenCalledTimes(1);
    expect(mockAttendance.create.mock.calls[0][0]).toMatchObject({ userId: 25, type: 'IN' });
    expect(mockAttendance.create.mock.calls[0][0].timestamp instanceof Date).toBe(true);
    // Preserves the safe SecurityLog access event.
    expect(mockSecurityLog.create).toHaveBeenCalledTimes(1);
    expect(mockSecurityLog.create.mock.calls[0][0]).toMatchObject({ type: 'Gantry Access', severity: 'safe', matchedUserId: 25 });
    // Never leaks a biometric/role-spoof surface.
    expect(JSON.stringify(res.body)).not.toMatch(/faceVector|embedding|password/i);
  });

  test('Check Out after an active check-in creates exactly one OUT', async () => {
    primeDb({ 25: activeUser });
    mockAttendance.findAll.mockResolvedValue([{ type: 'IN', timestamp: new Date('2026-08-04T01:00:00.000Z') }]);
    const res = await post({ userId: 25, action: 'OUT', cycleId: CYCLE_A });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ result: 'CHECK_OUT_RECORDED', recorded: true, currentStatus: 'OUT' });
    expect(mockAttendance.create).toHaveBeenCalledTimes(1);
    expect(mockAttendance.create.mock.calls[0][0]).toMatchObject({ userId: 25, type: 'OUT' });
  });

  test('suspended account → 403 and no attendance / no log', async () => {
    primeDb({ 25: { ...activeUser, isActive: false } });
    const res = await post({ userId: 25, action: 'IN', cycleId: CYCLE_A });
    expect(res.status).toBe(403);
    expect(mockAttendance.create).not.toHaveBeenCalled();
    expect(mockSecurityLog.create).not.toHaveBeenCalled();
  });

  test('non-enrolled account → 403 and no attendance', async () => {
    primeDb({ 25: { ...activeUser, isEnrolled: false } });
    const res = await post({ userId: 25, action: 'IN', cycleId: CYCLE_A });
    expect(res.status).toBe(403);
    expect(mockAttendance.create).not.toHaveBeenCalled();
  });

  test('unknown userId → 404 and no attendance', async () => {
    primeDb();
    const res = await post({ userId: 9999, action: 'IN', cycleId: CYCLE_A });
    expect(res.status).toBe(404);
    expect(mockAttendance.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/attendance/action — idempotency', () => {
  test('retrying the SAME cycle+action does not create a duplicate (dedup guard)', async () => {
    primeDb({ 25: activeUser });
    // findAll keeps returning [] (the race where the first write has not yet
    // committed): the per-cycle dedup guard must still block the second write.
    const first = await post({ userId: 25, action: 'IN', cycleId: CYCLE_A });
    const second = await post({ userId: 25, action: 'IN', cycleId: CYCLE_A });

    expect(first.status).toBe(201);
    expect(first.body.recorded).toBe(true);
    expect(second.status).toBe(200);
    expect(second.body.recorded).toBe(false);
    expect(second.body.result).toBe('DUPLICATE_CYCLE');
    expect(mockAttendance.create).toHaveBeenCalledTimes(1);
  });

  test('an already-IN Check In is idempotent (no toggle to OUT, no new row)', async () => {
    primeDb({ 25: activeUser });
    mockAttendance.findAll.mockResolvedValue([{ type: 'IN', timestamp: new Date('2026-08-04T01:00:00.000Z') }]);
    const res = await post({ userId: 25, action: 'IN', cycleId: CYCLE_B });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ result: 'ALREADY_ON_SITE', recorded: false, idempotent: true, currentStatus: 'IN' });
    expect(mockAttendance.create).not.toHaveBeenCalled();
  });

  test('an already-OUT Check Out is idempotent', async () => {
    primeDb({ 25: activeUser });
    mockAttendance.findAll.mockResolvedValue([
      { type: 'IN', timestamp: new Date('2026-08-04T01:00:00.000Z') },
      { type: 'OUT', timestamp: new Date('2026-08-04T09:00:00.000Z') },
    ]);
    const res = await post({ userId: 25, action: 'OUT', cycleId: CYCLE_B });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ result: 'ALREADY_OFF_SITE', recorded: false });
    expect(mockAttendance.create).not.toHaveBeenCalled();
  });

  test('Check Out with no active check-in today is idempotent (no invalid OUT row)', async () => {
    primeDb({ 25: activeUser });
    mockAttendance.findAll.mockResolvedValue([]);
    const res = await post({ userId: 25, action: 'OUT', cycleId: CYCLE_B });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ result: 'NO_ACTIVE_CHECK_IN', recorded: false });
    expect(mockAttendance.create).not.toHaveBeenCalled();
  });

  test('a later deliberate cycle with a new cycleId records the next legitimate event', async () => {
    primeDb({ 25: activeUser });
    // First: check IN (no prior logs).
    const inRes = await post({ userId: 25, action: 'IN', cycleId: CYCLE_A });
    expect(inRes.status).toBe(201);
    // Later: an active IN exists, operator chooses OUT with a fresh cycle id.
    mockAttendance.findAll.mockResolvedValue([{ type: 'IN', timestamp: new Date('2026-08-04T01:00:00.000Z') }]);
    const outRes = await post({ userId: 25, action: 'OUT', cycleId: CYCLE_B });
    expect(outRes.status).toBe(201);
    expect(outRes.body.result).toBe('CHECK_OUT_RECORDED');
    expect(mockAttendance.create).toHaveBeenCalledTimes(2);
  });
});
