// Shared licence-plate normalisation for Smart Logistics gate verification.
//
// Singapore-style plates are written many ways ("GBG 1234 M", "GBG-1234M",
// "gbg1234m"). Normalisation strips everything except A–Z / 0–9 and upper-cases,
// so all of the above compare equal as "GBG1234M". This is the single source of
// truth the backend uses when matching an observed/OCR plate to the booked plate.
// (The browser has its own identical copy in client/src/utils/plate.js — the two
// bundles cannot import across the client/server boundary.)

function normalizePlate(raw) {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// True only when BOTH plates normalise to the same NON-EMPTY string. An empty
// observed plate never "matches" — the caller must treat that as plate-missing.
function platesMatch(a, b) {
  const na = normalizePlate(a);
  const nb = normalizePlate(b);
  return na.length > 0 && na === nb;
}

module.exports = { normalizePlate, platesMatch };
