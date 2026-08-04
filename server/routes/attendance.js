const express = require('express');
const router = express.Router();
const { readLimiter } = require('../middlewares/rateLimit');
router.use(readLimiter); // route-wide rate limiting (trusted AI service scan is skipped)
const { Attendance, User } = require('../models');
const { Op } = require('sequelize');
const { verifyToken, verifyServiceOrRole } = require('../middlewares/auth');
const { shouldWriteLog, createSecurityLog } = require('../services/securityAudit');
const {
  getSingaporeWindow,
  deriveDailySummaries,
  summarizeForDate,
  buildAttendanceWhere
} = require('../services/attendanceSummary');

const attendanceInclude = (where) => ({
  model: User,
  attributes: ['id', 'name', 'role', 'managerId'],
  ...(where ? { where } : {})
});

const recordDto = (summary) => ({
  user: summary.user ? {
    id: summary.user.id,
    name: summary.user.name,
    role: summary.user.role
  } : null,
  userId: summary.userId,
  date: summary.date,
  firstCheckIn: summary.firstCheckIn,
  latestCheckOut: summary.latestCheckOut,
  currentStatus: summary.currentStatus,
  punctuality: summary.punctuality
});

// FM emergency-accountability view: facility-wide daily summaries without
// personal punctuality/lateness analytics or raw movement history.
const fmRecordDto = (summary) => ({
  user: summary.user ? {
    id: summary.user.id,
    name: summary.user.name,
    role: summary.user.role
  } : null,
  userId: summary.userId,
  date: summary.date,
  firstCheckIn: summary.firstCheckIn,
  latestCheckOut: summary.latestCheckOut,
  currentStatus: summary.currentStatus
});

router.get('/logs', verifyToken, async (req, res) => {
  try {
    const { id: loggedInUserId, role: userRole } = req.user;
    const window = getSingaporeWindow({
      filter: req.query.filter || 'today',
      date: req.query.date,
      now: req.query.now ? new Date(req.query.now) : new Date()
    });

    let attendanceRecords;

    if (userRole === 'FM') {
      res.set('Cache-Control', 'no-store');
      attendanceRecords = await Attendance.findAll({
        where: buildAttendanceWhere(window),
        include: [attendanceInclude()],
        order: [['timestamp', 'ASC']]
      });
      const dailySummaries = deriveDailySummaries(attendanceRecords);
      // Historical filters may change the reviewed activity window, but current
      // occupancy must always be derived from today's authoritative SG state.
      const todayWindow = getSingaporeWindow({
        filter: 'today',
        now: req.query.now ? new Date(req.query.now) : new Date()
      });
      const selectedWindowIsToday = window.startKey === todayWindow.startKey
        && window.endExclusiveKey === todayWindow.endExclusiveKey;
      const currentRecords = selectedWindowIsToday ? attendanceRecords : await Attendance.findAll({
        where: buildAttendanceWhere(todayWindow),
        include: [attendanceInclude()],
        order: [['timestamp', 'ASC']]
      });
      const currentSummaries = deriveDailySummaries(currentRecords);
      const today = summarizeForDate(currentSummaries, todayWindow.todayKey);
      const currentOccupancy = today.summaries
        .filter((summary) => summary.currentStatus === 'IN' && summary.user)
        .map((summary) => ({
          userId: summary.userId,
          person: summary.user.name,
          role: summary.user.role,
          currentStatus: 'IN',
          checkInTime: summary.firstCheckIn,
          lastAccessEventTime: summary.lastAccessEventTime
        }));
      return res.status(200).json({
        role: 'FM',
        filter: { type: window.filter, startDate: window.startKey, endDateExclusive: window.endExclusiveKey, timezone: 'Asia/Singapore' },
        summary: {
          peopleOnSite: currentOccupancy.length,
          checkedInToday: today.checkedIn,
          checkedOutToday: today.checkedOut,
          activityCount: dailySummaries.length
        },
        currentOccupancy,
        records: dailySummaries.map(fmRecordDto)
      });
    }

    if (userRole === 'Tenant') {
      attendanceRecords = await Attendance.findAll({
        where: buildAttendanceWhere(window),
        include: [attendanceInclude({ role: 'Staff', managerId: loggedInUserId })],
        order: [['timestamp', 'ASC']]
      });
      const records = deriveDailySummaries(attendanceRecords).map(recordDto);
      const today = summarizeForDate(records, window.todayKey);
      return res.status(200).json({
        role: 'Tenant',
        filter: { type: window.filter, startDate: window.startKey, endDateExclusive: window.endExclusiveKey, timezone: 'Asia/Singapore' },
        summary: {
          staffOnSite: today.onSite,
          onTimeToday: today.onTime,
          lateToday: today.late
        },
        records
      });
    }

    attendanceRecords = await Attendance.findAll({
      where: { ...buildAttendanceWhere(window), userId: loggedInUserId },
      include: [attendanceInclude()],
      order: [['timestamp', 'ASC']]
    });
    const records = deriveDailySummaries(attendanceRecords).map(recordDto);
    const today = summarizeForDate(records, window.todayKey);
    const ownToday = today.summaries[0] || null;
    return res.status(200).json({
      role: 'Staff',
      filter: { type: window.filter, startDate: window.startKey, endDateExclusive: window.endExclusiveKey, timezone: 'Asia/Singapore' },
      summary: {
        currentStatus: ownToday?.currentStatus || 'OUT',
        firstCheckIn: ownToday?.firstCheckIn || null,
        latestCheckOut: ownToday?.latestCheckOut || null,
        punctuality: ownToday?.punctuality || 'NO_IN'
      },
      records
    });
  } catch (error) {
    console.error('Attendance Extraction Error:', error);
    const status = /Custom date/.test(error.message) ? 400 : 500;
    res.status(status).json({ error: status === 400 ? error.message : 'Internal server error reading logs.' });
  }
});

router.post('/scan', verifyServiceOrRole('FM'), async (req, res) => {
  try {
    const { userId: scannedUserId } = req.body;

    if (scannedUserId == null || !Number.isInteger(Number(scannedUserId))) {
      return res.status(400).json({ error: 'Missing required parameter: userId' });
    }

    const user = await User.findByPk(scannedUserId);
    if (!user) {
      return res.status(404).json({ error: 'User not recognized in system registry.' });
    }
    if (!user.isEnrolled) {
      return res.status(403).json({ error: 'User has no enrolled Face ID.' });
    }
    if (!user.isActive) {
      return res.status(403).json({ error: 'Account suspended. Gate access denied.' });
    }

    const userId = user.id;
    const todayWindow = getSingaporeWindow({ filter: 'today' });

    const existingLogsToday = await Attendance.findAll({
      where: {
        userId,
        timestamp: {
          [Op.gte]: todayWindow.start,
          [Op.lt]: todayWindow.end
        }
      },
      order: [['timestamp', 'ASC']]
    });

    let actionTaken = '';
    let finalLog = null;

    const hasClockedInToday = existingLogsToday.some((log) => log.type === 'IN');
    const hasClockedOutToday = existingLogsToday.some((log) => log.type === 'OUT');

    if (!hasClockedInToday) {
      finalLog = await Attendance.create({ userId, type: 'IN', timestamp: new Date() });
      actionTaken = 'CLOCK_IN_SUCCESSFUL';
    } else if (!hasClockedOutToday) {
      finalLog = await Attendance.create({ userId, type: 'OUT', timestamp: new Date() });
      actionTaken = 'CLOCK_OUT_SUCCESSFUL';
    } else {
      const lastOutLog = [...existingLogsToday].reverse().find((log) => log.type === 'OUT');
      if (lastOutLog) {
        lastOutLog.timestamp = new Date();
        await lastOutLog.save();
        finalLog = lastOutLog;
        actionTaken = 'CLOCK_OUT_TIMESTAMP_UPDATED';
      }
    }

    const cameraLocation = typeof req.body.cameraLocation === 'string' && req.body.cameraLocation.trim()
      ? req.body.cameraLocation.trim().slice(0, 100)
      : 'Main Gate';
    if (shouldWriteLog(`granted:${user.id}:${cameraLocation}`)) {
      await createSecurityLog({
        type: 'Gantry Access',
        desc: `Identity & liveness verified - ${actionTaken.replace(/_/g, ' ').toLowerCase()}: ${user.name} (${user.role}) at ${cameraLocation}.`,
        severity: 'safe',
        icon: 'UNLOCK',
        personnelName: user.name,
        matchedUserId: user.id,
        cameraLocation
      });
    }

    return res.status(200).json({
      status: 'SUCCESS',
      action: actionTaken,
      worker: user.name,
      role: user.role,
      timestamp: finalLog.timestamp,
      openTurnstile: true
    });
  } catch (error) {
    console.error('IoT Gate Processing Loop Fault:', error);
    return res.status(500).json({ error: 'Internal processing crash inside gatekeeper module.' });
  }
});

// POST /api/attendance/action
// Server-authoritative EXPLICIT attendance action for V-Patrol's operator-selected
// Check In / Check Out. Unlike /scan (which toggles IN↔OUT on every scan), this
// records exactly the action the operator chose, and only after V-Patrol has
// completed its authoritative recognition + liveness + final same-person cycle.
//
// The client submits { userId, action: 'IN' | 'OUT', cameraLocation, cycleId }. The
// server NEVER trusts a client-supplied name/role — it re-loads the account from
// PostgreSQL, stamps the record with server time, and returns safe fields only.
//
// Idempotency (no schema column added for this task, per scope):
//   1. A stable per-recognition-cycle UUID + a bounded in-memory dedup window
//      (services/securityAudit.shouldWriteLog) make retries of the SAME cycle+action
//      a no-op — and win the race if two near-simultaneous requests arrive.
//   2. Business-state validation on today's Asia/Singapore window is naturally
//      idempotent: an already-IN Check In and an already-OUT / no-check-in Check Out
//      return an idempotent result instead of writing a duplicate/invalid row.
// Limitation (documented honestly): durable cross-restart cycle idempotency would
// need an Attendance.cycleId column, which this task must not add. The dedup window
// is per-process; the client one-request-per-cycle guard + the business-state check
// above are what keep a person standing in frame from being toggled.
const CYCLE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

router.post('/action', verifyServiceOrRole('FM'), async (req, res) => {
  try {
    const { userId: scannedUserId, action, cycleId } = req.body || {};

    if (scannedUserId == null || !Number.isInteger(Number(scannedUserId))) {
      return res.status(400).json({ error: 'Missing required parameter: userId' });
    }
    if (action !== 'IN' && action !== 'OUT') {
      return res.status(400).json({ error: "action must be exactly 'IN' or 'OUT'." });
    }
    if (typeof cycleId !== 'string' || !CYCLE_ID_PATTERN.test(cycleId)) {
      return res.status(400).json({ error: 'cycleId must be a valid UUID.' });
    }

    const user = await User.findByPk(scannedUserId);
    if (!user) {
      return res.status(404).json({ error: 'User not recognized in system registry.' });
    }
    if (!user.isEnrolled) {
      return res.status(403).json({ error: 'User has no enrolled Face ID.' });
    }
    if (!user.isActive) {
      return res.status(403).json({ error: 'Account suspended. Attendance action denied.' });
    }

    const userId = user.id;
    const cameraLocation = typeof req.body.cameraLocation === 'string' && req.body.cameraLocation.trim()
      ? req.body.cameraLocation.trim().slice(0, 100)
      : 'Biometric Gantry';

    // Today's authoritative Asia/Singapore attendance state (never the browser clock).
    const todayWindow = getSingaporeWindow({ filter: 'today' });
    const todayLogs = await Attendance.findAll({
      where: { userId, timestamp: { [Op.gte]: todayWindow.start, [Op.lt]: todayWindow.end } },
      order: [['timestamp', 'ASC']]
    });
    const hasCheckedInToday = todayLogs.some((log) => log.type === 'IN');
    const currentStatus = todayLogs.length ? todayLogs[todayLogs.length - 1].type : 'OUT';

    const safeResult = (result, extra = {}) => ({
      status: 'SUCCESS',
      action,
      result,
      recorded: false,
      idempotent: true,
      worker: user.name,
      role: user.role,
      currentStatus,
      ...extra
    });

    // Business-state idempotency — never write a duplicate IN or an invalid OUT.
    if (action === 'IN' && currentStatus === 'IN') {
      return res.status(200).json(safeResult('ALREADY_ON_SITE'));
    }
    if (action === 'OUT' && !hasCheckedInToday) {
      return res.status(200).json(safeResult('NO_ACTIVE_CHECK_IN'));
    }
    if (action === 'OUT' && currentStatus === 'OUT') {
      return res.status(200).json(safeResult('ALREADY_OFF_SITE'));
    }

    // A write is warranted. The per-cycle dedup guard makes a retry of this exact
    // cycle+action a no-op and, for concurrent requests, lets exactly one proceed.
    if (!shouldWriteLog(`attendance-action:${userId}:${action}:${cycleId}`)) {
      return res.status(200).json(safeResult('DUPLICATE_CYCLE', { deduplicated: true }));
    }

    const record = await Attendance.create({ userId, type: action, timestamp: new Date() });

    // Preserve the existing safe SecurityLog access event (audit metadata only —
    // never a snapshot or biometric template). Non-fatal.
    const actionLabel = action === 'IN' ? 'checked in' : 'checked out';
    await createSecurityLog({
      type: 'Gantry Access',
      desc: `Identity & liveness verified - ${actionLabel}: ${user.name} (${user.role}) at ${cameraLocation}.`,
      severity: 'safe',
      icon: 'UNLOCK',
      personnelName: user.name,
      matchedUserId: user.id,
      cameraLocation
    });

    return res.status(201).json({
      status: 'SUCCESS',
      action,
      result: action === 'IN' ? 'CHECK_IN_RECORDED' : 'CHECK_OUT_RECORDED',
      recorded: true,
      idempotent: false,
      worker: user.name,
      role: user.role,
      currentStatus: action,
      timestamp: record.timestamp
    });
  } catch (error) {
    console.error('Attendance action fault:', error);
    return res.status(500).json({ error: 'Internal server error while recording attendance action.' });
  }
});

module.exports = router;
