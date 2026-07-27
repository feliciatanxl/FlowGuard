// Server-owned audit writer for loading-bay gate-verification decisions.
//
// Records decision METADATA only (booking ref, action, decision, reason code,
// plates as text, mode/source/confidence, override, and the authenticated FM's
// identity). It NEVER receives or stores QR/plate images, JWTs, passwords or
// secrets — callers pass plain fields, not request headers.
//
// This function THROWS on failure (unlike the fire-and-forget facial-recognition
// audit) so the gate-verification service can fail CLOSED: a granted decision that
// cannot be audited must not open the barrier.
const { GateAccessLog } = require('../models');

async function writeGateAccessLog(fields, options = {}) {
  if (!GateAccessLog || typeof GateAccessLog.create !== 'function') {
    throw new Error('GateAccessLog model is unavailable — cannot audit gate decision.');
  }
  const {
    bookingRef, action, decision, reasonCode,
    verificationMode = null, plateSource = null, plateConfidence = null,
    expectedPlate = null, observedPlate = null, plateMatched = null,
    loadingBay = null, overrideUsed = false, overrideReason = null,
    fmId = null, fmEmail = null,
  } = fields;

  return GateAccessLog.create({
    bookingRef,
    action,
    decision,
    reasonCode,
    verificationMode,
    plateSource,
    plateConfidence: plateConfidence == null ? null : Number(plateConfidence),
    expectedPlate,
    observedPlate,
    plateMatched,
    loadingBay,
    overrideUsed: Boolean(overrideUsed),
    overrideReason: overrideReason || null,
    fmId,
    fmEmail,
  }, options);
}

module.exports = { writeGateAccessLog };
