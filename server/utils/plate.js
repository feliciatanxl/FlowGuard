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

// Shape of a valid Singapore-style plate AFTER normalisation: 1–3 prefix letters,
// 1–4 digits, one final checksum letter. e.g. "SBA5678Z", "GBG1234M", "S1A".
// A deliberately STRICT gate: it rejects OCR noise ("YWERETANCLPPEMYY"), words
// ("TOYOTA") and digit-only junk ("123456789"). This is the server's independent
// check — it never trusts the browser's "readable" flag. (Mirrors the browser
// copy in client/src/utils/plate.js exactly.)
const PLATE_PATTERN = /^[A-Z]{1,3}[0-9]{1,4}[A-Z]$/;

function isPlausiblePlate(value) {
  return PLATE_PATTERN.test(normalizePlate(value));
}

// Pull the single most plausible plate out of raw OCR text instead of collapsing
// the whole paragraph into one string. Spaces and hyphens inside a plate are
// tolerated ("SKL 9081 A" → "SKL9081A"); unrelated words/lines are ignored.
// Returns the normalised candidate, or "" when nothing plausible is present.
function extractPlateCandidate(rawText) {
  const text = String(rawText ?? '');
  if (!text.trim()) return '';
  const lines = text.split(/[\r\n]+/);

  // Prefer a line that IS a plate once spacing/hyphens are stripped over a
  // windowed reconstruction of a noisy line.
  for (const line of lines) {
    const whole = normalizePlate(line);
    if (isPlausiblePlate(whole)) return whole;
  }

  // Otherwise scan each line for a run of adjacent tokens that forms a plate.
  // The strict pattern bounds the result to a real plate; this is exact, not fuzzy.
  for (const line of lines) {
    const tokens = line.split(/[^A-Za-z0-9]+/).filter(Boolean);
    for (let i = 0; i < tokens.length; i += 1) {
      let joined = '';
      for (let j = i; j < tokens.length && j < i + 4; j += 1) {
        joined += tokens[j];
        const norm = normalizePlate(joined);
        if (isPlausiblePlate(norm)) return norm;
      }
    }
  }

  return '';
}

module.exports = { normalizePlate, platesMatch, isPlausiblePlate, extractPlateCandidate };
