// Opaque password-reset-token digest — this is NOT password hashing.
//
// A reset token is a 256-bit cryptographically-random opaque secret
// (crypto.randomBytes(32)). We email the RAW token in the reset link but store
// ONLY its SHA-256 digest, so a database read can never reveal a usable token,
// and the server can still look the account up in O(1) by digest.
//
// A deterministic digest is REQUIRED for that lookup, and a slow salted password
// hash (bcrypt) is deliberately NOT used here because:
//   1. the input is already high-entropy — there is no dictionary/brute-force
//      risk that key-stretching (bcrypt/scrypt/argon2) exists to defend against;
//   2. bcrypt salts are non-deterministic, which would make digest lookup
//      impossible (we would have to load and compare every user's hash).
//
// Account PASSWORDS are unrelated and continue to use bcrypt (see routes/user.js:
// register, login, change-password, reset-password all bcrypt.hash / .compare).
//
// This module isolates the ONE digest call site so the intent is unambiguous to
// reviewers and to CodeQL. See the security report, Part 5, for the full
// analysis of why js/insufficient-password-hash is a false positive here.
const crypto = require('crypto');

// Generate a new high-entropy opaque reset token (returns the RAW token; only
// its digest is ever persisted).
const generateResetToken = () => crypto.randomBytes(32).toString('hex');

// Deterministic digest of an opaque high-entropy reset token — used both when
// storing (of a fresh random token) and when looking up (of a submitted token).
// codeql[js/insufficient-password-hash] High-entropy random reset-token digest, not password hashing; account passwords use bcrypt.
const digestResetToken = (rawToken) =>
  crypto.createHash('sha256').update(String(rawToken)).digest('hex');

module.exports = { generateResetToken, digestResetToken };
