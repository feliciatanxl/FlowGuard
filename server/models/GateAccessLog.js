// Additive audit table for loading-bay gate-verification decisions.
//
// Every FINAL gate decision (granted or denied, automatic or manual) is recorded
// here. It stores decision METADATA only — never QR/plate images, JWTs, passwords
// or secrets. It is separate from SecurityLog (facial-recognition audit) so the two
// concerns never interfere. All non-key columns are nullable/defaulted so creating
// the table is a purely additive migration (Sequelize sync creates it on startup;
// no existing table is altered or dropped).
module.exports = (sequelize, DataTypes) => {
  const GateAccessLog = sequelize.define('GateAccessLog', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    // Booking this decision was about (the human-readable FlowGuard ref).
    bookingRef: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    action: {
      type: DataTypes.STRING(10),
      allowNull: false, // 'entry' | 'exit'
    },
    decision: {
      type: DataTypes.STRING(10),
      allowNull: false, // 'granted' | 'denied'
    },
    reasonCode: {
      type: DataTypes.STRING(40),
      allowNull: false, // stable machine code (VERIFIED, PLATE_MISMATCH, ...)
    },
    verificationMode: {
      type: DataTypes.STRING(20),
      allowNull: true, // 'automatic' | 'manual'
    },
    plateSource: {
      type: DataTypes.STRING(20),
      allowNull: true, // 'ocr' | 'simulation' | 'manual'
    },
    plateConfidence: {
      type: DataTypes.FLOAT,
      allowNull: true, // OCR confidence when available (0–100)
    },
    expectedPlate: {
      type: DataTypes.STRING(20),
      allowNull: true, // booked plate (normalised)
    },
    observedPlate: {
      type: DataTypes.STRING(20),
      allowNull: true, // detected/entered plate (normalised)
    },
    plateMatched: {
      type: DataTypes.BOOLEAN,
      allowNull: true, // null when no plate was evaluated
    },
    loadingBay: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    overrideUsed: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    overrideReason: {
      type: DataTypes.TEXT,
      allowNull: true, // required (non-empty) only when overrideUsed = true
    },
    // Authenticated Facilities Manager who produced this decision. Taken from
    // req.user (the DB-verified account) — NEVER from the request body.
    fmId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    fmEmail: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
  }, {
    tableName: 'gate_access_logs',
    timestamps: true, // createdAt is the decision timestamp
    indexes: [
      { fields: ['bookingRef'] },
      { fields: ['action'] },
      { fields: ['createdAt'] },
    ],
  });

  return GateAccessLog;
};
