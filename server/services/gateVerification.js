// Dual-mode loading-bay gate verification (Proof of Concept).
//
// Stateless by design: every call re-reads the authoritative booking row from
// PostgreSQL (SELECT ... FOR UPDATE inside a transaction when the DB supports it),
// so the feature keeps working across Cloud Run restarts / multiple instances and
// two simultaneous scans cannot both flip the same booking.
//
// The same rules serve AUTOMATIC (QR + camera/OCR plate) and MANUAL (FM types the
// booking ref + observed plate) modes. Callers get a single, stable decision shape
// keyed by `reasonCode` — the frontend never parses English error text.
//
// This module performs NO Express work; the route is a thin adapter. WhatsApp /
// next-in-line notifications reuse the existing whatsappService and run AFTER the
// DB transaction commits (never on rollback, never holding a row lock over the
// network), preserving the existing driver-notification behaviour.

const models = require('../models');
const whatsapp = require('./whatsappService');
const { writeGateAccessLog } = require('./gateAudit');
const { normalizePlate } = require('../utils/plate');

const { Op } = require('sequelize');

// --- Stable machine reason codes (frontend maps these to copy) ---
const REASON = Object.freeze({
  VERIFIED: 'VERIFIED',
  BOOKING_NOT_FOUND: 'BOOKING_NOT_FOUND',
  BOOKING_NOT_CONFIRMED: 'BOOKING_NOT_CONFIRMED',
  BOOKING_CANCELLED: 'BOOKING_CANCELLED',
  BOOKING_COMPLETED: 'BOOKING_COMPLETED',
  ALREADY_ARRIVED: 'ALREADY_ARRIVED',
  ALREADY_COMPLETED: 'ALREADY_COMPLETED',
  NOT_ARRIVED: 'NOT_ARRIVED',
  TOO_EARLY: 'TOO_EARLY',
  TOO_LATE: 'TOO_LATE',
  PLATE_REQUIRED: 'PLATE_REQUIRED',
  PLATE_MISMATCH: 'PLATE_MISMATCH',
  OCR_UNREADABLE: 'OCR_UNREADABLE',
  CAMERA_UNAVAILABLE: 'CAMERA_UNAVAILABLE',
  OVERRIDE_REASON_REQUIRED: 'OVERRIDE_REASON_REQUIRED',
  INVALID_ACTION: 'INVALID_ACTION',
  AUDIT_FAILED: 'AUDIT_FAILED',
});

// Failures an authorised FM may deliberately override in MANUAL mode.
const REVIEWABLE = new Set([REASON.PLATE_MISMATCH, REASON.OCR_UNREADABLE, REASON.CAMERA_UNAVAILABLE]);

const VALID_ACTIONS = new Set(['entry', 'exit']);
const VALID_MODES = new Set(['automatic', 'manual']);
const VALID_SOURCES = new Set(['ocr', 'simulation', 'manual']);

const MESSAGES = {
  [REASON.VERIFIED]: 'QR and vehicle plate verified.',
  [REASON.BOOKING_NOT_FOUND]: 'No booking matches that reference.',
  [REASON.BOOKING_NOT_CONFIRMED]: 'Booking is not Confirmed — it cannot be admitted automatically.',
  [REASON.BOOKING_CANCELLED]: 'This booking has been cancelled. Entry is not authorised.',
  [REASON.BOOKING_COMPLETED]: 'This booking is already completed.',
  [REASON.ALREADY_ARRIVED]: 'Booking has already been marked Arrived.',
  [REASON.ALREADY_COMPLETED]: 'Booking has already been completed.',
  [REASON.NOT_ARRIVED]: 'Vehicle has no recorded arrival — cannot record exit.',
  [REASON.TOO_EARLY]: 'Arrival is earlier than the approved window.',
  [REASON.TOO_LATE]: 'Arrival is later than the approved window.',
  [REASON.PLATE_REQUIRED]: 'A vehicle plate is required to verify this booking.',
  [REASON.PLATE_MISMATCH]: 'Detected plate does not match the approved booking.',
  [REASON.OCR_UNREADABLE]: 'The plate could not be read automatically.',
  [REASON.CAMERA_UNAVAILABLE]: 'The gate camera was unavailable.',
  [REASON.OVERRIDE_REASON_REQUIRED]: 'A manual override requires a reason.',
  [REASON.INVALID_ACTION]: "action must be 'entry' or 'exit'.",
  [REASON.AUDIT_FAILED]: 'The decision could not be safely recorded — access was not granted.',
};

// Env-configurable arrival grace (minutes). Read per call so tests/deploys pick up changes.
function graceWindow() {
  const early = Number(process.env.GATE_EARLY_MINUTES);
  const late = Number(process.env.GATE_LATE_MINUTES);
  return {
    earlyMin: Number.isFinite(early) ? early : 30,
    lateMin: Number.isFinite(late) ? late : 60,
  };
}

// Public, FM-safe summary of the booking for the decision payload.
function bookingSummary(b) {
  if (!b) return null;
  return {
    booking_ref: b.booking_ref,
    transport_company: b.transport_company,
    driver_name: b.driver_name,
    license_plate: b.license_plate,
    loading_bay: b.loading_bay,
    slot_start: b.slot_start,
    slot_end: b.slot_end,
    status: b.status,
    arrived_at: b.arrived_at,
    completed_at: b.completed_at,
  };
}

// Returns { code, warning? } for the entry arrival-window check.
function checkArrivalWindow(booking, now) {
  if (!booking.slot_start || !booking.slot_end) {
    return { code: null, warning: 'SCHEDULE_UNVERIFIED' }; // allowed, but flagged
  }
  const { earlyMin, lateMin } = graceWindow();
  const start = new Date(booking.slot_start).getTime();
  const end = new Date(booking.slot_end).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return { code: null, warning: 'SCHEDULE_UNVERIFIED' };
  }
  const nowMs = now.getTime();
  if (nowMs < start - earlyMin * 60000) return { code: REASON.TOO_EARLY };
  if (nowMs > end + lateMin * 60000) return { code: REASON.TOO_LATE };
  return { code: null };
}

// Pure decision core. Given the loaded booking + normalised inputs, decide the
// base outcome WITHOUT touching the DB. Returns a plain decision descriptor.
function decide(booking, input, now) {
  const { action, verificationMode, observedPlate, plateSource } = input;
  const expectedPlate = normalizePlate(booking.license_plate);
  const observed = normalizePlate(observedPlate);
  const hasPlate = observed.length > 0;
  const plateMatched = hasPlate ? observed === expectedPlate : null;

  const base = {
    expectedPlate,
    observedPlate: observed || null,
    plateMatched,
    warning: null,
  };

  if (action === 'entry') {
    if (booking.status === 'Cancelled') return { ...base, grant: false, code: REASON.BOOKING_CANCELLED };
    if (booking.status === 'Completed') return { ...base, grant: false, code: REASON.BOOKING_COMPLETED };
    if (booking.status === 'Arrived') return { ...base, grant: true, code: REASON.ALREADY_ARRIVED, idempotent: true };
    if (booking.status !== 'Confirmed') return { ...base, grant: false, code: REASON.BOOKING_NOT_CONFIRMED };

    // Confirmed → time window, then plate.
    const window = checkArrivalWindow(booking, now);
    if (window.code) return { ...base, grant: false, code: window.code };
    base.warning = window.warning || null;

    const plate = evaluatePlate({ hasPlate, plateMatched, verificationMode, plateSource });
    if (plate) return { ...base, grant: false, code: plate };
    return { ...base, grant: true, code: REASON.VERIFIED, transitionTo: 'Arrived' };
  }

  // action === 'exit'
  if (booking.status === 'Cancelled') return { ...base, grant: false, code: REASON.BOOKING_CANCELLED };
  if (booking.status === 'Completed') return { ...base, grant: true, code: REASON.ALREADY_COMPLETED, idempotent: true };
  if (booking.status !== 'Arrived') return { ...base, grant: false, code: REASON.NOT_ARRIVED };

  const plate = evaluatePlate({ hasPlate, plateMatched, verificationMode, plateSource });
  if (plate) return { ...base, grant: false, code: plate };
  return { ...base, grant: true, code: REASON.VERIFIED, transitionTo: 'Completed' };
}

// Plate gate shared by entry & exit. Returns a deny reason code, or null to pass.
function evaluatePlate({ hasPlate, plateMatched, verificationMode, plateSource }) {
  if (!hasPlate) {
    // Automatic OCR that came back empty is a reviewable "unreadable"; anything
    // else missing a plate is a hard PLATE_REQUIRED.
    if (verificationMode === 'automatic' && plateSource === 'ocr') return REASON.OCR_UNREADABLE;
    if (verificationMode === 'automatic' && plateSource === 'simulation') return REASON.OCR_UNREADABLE;
    return REASON.PLATE_REQUIRED;
  }
  return plateMatched ? null : REASON.PLATE_MISMATCH;
}

// Build the outward decision payload from a resolved outcome.
function toDecisionBody(outcome, booking) {
  const denied = !outcome.grant;
  return {
    access: outcome.grant ? 'GRANTED' : 'DENIED',
    reasonCode: outcome.code,
    message: outcome.message || MESSAGES[outcome.code] || 'Gate decision recorded.',
    action: outcome.action,
    verificationMode: outcome.verificationMode,
    booking: bookingSummary(booking),
    expectedPlate: outcome.expectedPlate ?? null,
    observedPlate: outcome.observedPlate ?? null,
    plateMatched: outcome.plateMatched ?? null,
    manualReviewRequired: denied && REVIEWABLE.has(outcome.code),
    overrideUsed: Boolean(outcome.overrideUsed),
    warning: outcome.warning || null,
    nextInLine: outcome.nextInLine ?? null,
  };
}

// Send driver notifications for a successful transition AFTER commit. Non-fatal —
// a WhatsApp failure never changes the (already committed) gate decision.
async function notifyAfterCommit(booking, transitionTo) {
  let nextInLine = null;
  try {
    if (transitionTo === 'Arrived') {
      await whatsapp.sendBookingArrived(booking);
    } else if (transitionTo === 'Completed') {
      await whatsapp.sendBookingCompleted(booking);
      const next = await models.Booking.findOne({
        where: { loading_bay: booking.loading_bay, status: { [Op.in]: ['Pending', 'Confirmed'] } },
        order: [['slot_start', 'ASC'], ['createdAt', 'ASC']],
      });
      if (next) {
        await whatsapp.sendNextInLine(next);
        nextInLine = next.booking_ref;
      }
    }
  } catch (waErr) {
    console.error('Gate verification WhatsApp notify failed (non-fatal):', waErr.message);
  }
  return nextInLine;
}

// ---------------------------------------------------------------------------
// Main entry point.
//   input: { action, bookingRef, observedPlate, verificationMode, plateSource,
//            plateConfidence, manualOverride, overrideReason }
//   actor: the authenticated FM (req.user) — { id, email, role }
//   opts:  { now } for deterministic tests
// Returns { http, body } — the route just forwards it.
// ---------------------------------------------------------------------------
async function verifyGate(input, actor, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();

  const action = String(input.action || '').trim();
  const bookingRef = String(input.bookingRef || '').trim();
  const verificationMode = VALID_MODES.has(input.verificationMode) ? input.verificationMode : 'manual';
  const plateSource = VALID_SOURCES.has(input.plateSource)
    ? input.plateSource
    : (verificationMode === 'automatic' ? 'ocr' : 'manual');
  const observedPlate = input.observedPlate;
  const plateConfidence = input.plateConfidence == null ? null : Number(input.plateConfidence);
  const manualOverride = input.manualOverride === true || input.manualOverride === 'true';
  const overrideReason = typeof input.overrideReason === 'string' ? input.overrideReason.trim() : '';

  // --- Request-shape validation (400s; not a gate "decision") ---
  if (!VALID_ACTIONS.has(action)) {
    return { http: 400, body: { access: 'DENIED', reasonCode: REASON.INVALID_ACTION, message: MESSAGES[REASON.INVALID_ACTION] } };
  }
  if (!bookingRef) {
    return { http: 400, body: { access: 'DENIED', reasonCode: REASON.BOOKING_NOT_FOUND, message: 'A booking reference is required.' } };
  }

  const auditActor = {
    fmId: actor?.id ?? null,
    fmEmail: actor?.email ?? null,
  };
  const normalizedInput = { action, verificationMode, observedPlate, plateSource };

  // Everything that touches the booking row runs inside a transaction with a row
  // lock when the DB supports it; unit tests mock the models (no sequelize) and
  // fall back to a plain, lock-free path.
  const sequelize = models.sequelize;
  const useTx = sequelize && typeof sequelize.transaction === 'function';

  const runInTx = async (t) => {
    const findOpts = { where: { booking_ref: bookingRef } };
    if (t) { findOpts.transaction = t; findOpts.lock = t.LOCK.UPDATE; }
    const booking = await models.Booking.findOne(findOpts);

    if (!booking) {
      // Audit the denial (best-effort — a failed audit must not mask a not-found).
      await safeAuditDenied({
        bookingRef, action, code: REASON.BOOKING_NOT_FOUND, verificationMode, plateSource,
        plateConfidence, expectedPlate: null, observedPlate: normalizePlate(observedPlate) || null,
        plateMatched: null, loadingBay: null, overrideUsed: false, overrideReason: null, ...auditActor,
      }, t);
      return {
        http: 200,
        body: toDecisionBody(
          { grant: false, code: REASON.BOOKING_NOT_FOUND, action, verificationMode, expectedPlate: null, observedPlate: null, plateMatched: null },
          null,
        ),
      };
    }

    let outcome = decide(booking, normalizedInput, now);
    outcome.action = action;
    outcome.verificationMode = verificationMode;

    // --- Manual override (FM only, manual mode, reviewable failures only) ---
    if (!outcome.grant && manualOverride && verificationMode === 'manual') {
      if (REVIEWABLE.has(outcome.code)) {
        if (!overrideReason) {
          outcome = { ...outcome, grant: false, code: REASON.OVERRIDE_REASON_REQUIRED };
        } else {
          // Approved override: grant, and drive the transition the base check blocked.
          outcome = {
            ...outcome,
            grant: true,
            overrideUsed: true,
            overrideReason,
            originalReasonCode: outcome.code,
            code: REASON.VERIFIED,
            transitionTo: action === 'entry' ? 'Arrived' : 'Completed',
            message: 'Access granted by Facilities Manager override.',
          };
        }
      }
      // Non-reviewable failures are NOT overridable — the deny stands unchanged.
    }

    const commonAudit = {
      bookingRef: booking.booking_ref,
      action,
      verificationMode,
      plateSource,
      plateConfidence,
      expectedPlate: outcome.expectedPlate ?? null,
      observedPlate: outcome.observedPlate ?? null,
      plateMatched: outcome.plateMatched ?? null,
      loadingBay: booking.loading_bay,
      overrideUsed: Boolean(outcome.overrideUsed),
      overrideReason: outcome.overrideUsed ? overrideReason : null,
      ...auditActor,
    };

    if (outcome.grant) {
      // Audit FIRST so a granted decision that cannot be recorded fails closed
      // (the booking is never transitioned without a durable audit row).
      try {
        await writeGateAccessLog({ ...commonAudit, decision: 'granted', reasonCode: outcome.originalReasonCode || outcome.code },
          t ? { transaction: t } : {});
      } catch (auditErr) {
        console.error('Gate audit write failed on GRANT — failing closed:', auditErr.message);
        const err = new Error('AUDIT_FAILED');
        err.__auditFailed = true;
        throw err; // rolls the transaction back (no status change persists)
      }

      // Idempotent already-Arrived/already-Completed: no DB change, no notify.
      if (outcome.transitionTo && !outcome.idempotent) {
        const patch = outcome.transitionTo === 'Arrived'
          ? { status: 'Arrived', arrived_at: now }
          : { status: 'Completed', completed_at: now };
        await booking.update(patch, t ? { transaction: t } : {});
      }
    } else {
      await safeAuditDenied({ ...commonAudit, code: outcome.code }, t);
    }

    return { http: 200, outcome, booking };
  };

  let result;
  try {
    result = useTx ? await sequelize.transaction(runInTx) : await runInTx(null);
  } catch (err) {
    if (err && err.__auditFailed) {
      return { http: 500, body: { access: 'DENIED', reasonCode: REASON.AUDIT_FAILED, message: MESSAGES[REASON.AUDIT_FAILED] } };
    }
    throw err; // real DB error → route maps to 500
  }

  // Early-returned bodies (not-found / would never reach here with outcome).
  if (result.body) return result;

  const { outcome, booking } = result;

  // Post-commit driver notifications for a real (non-idempotent) transition.
  if (outcome.grant && outcome.transitionTo && !outcome.idempotent) {
    outcome.nextInLine = await notifyAfterCommit(booking, outcome.transitionTo);
  }

  return { http: 200, body: toDecisionBody(outcome, booking) };
}

// Denials are audited best-effort: a failed audit is logged but never turns a
// denial into an error (the safe outcome is already "no access").
async function safeAuditDenied(fields, t) {
  try {
    await writeGateAccessLog({ ...fields, decision: 'denied' }, t ? { transaction: t } : {});
  } catch (auditErr) {
    console.error('Gate audit write failed on DENY (non-fatal):', auditErr.message);
  }
}

module.exports = { verifyGate, REASON, REVIEWABLE, graceWindow, _decide: decide };
