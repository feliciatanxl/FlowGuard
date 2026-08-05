// Shared Singapore licence-plate normalisation (browser copy).
//
// Mirrors server/utils/plate.js exactly — the client and server bundles cannot
// import across the boundary, so the logic is duplicated and each side is tested.
// "GBG 1234 M", "GBG-1234M" and "gbg1234m" all normalise to "GBG1234M".

export function normalizePlate(raw) {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// True only when BOTH plates normalise to the same NON-EMPTY string.
export function platesMatch(a, b) {
  const na = normalizePlate(a);
  const nb = normalizePlate(b);
  return na.length > 0 && na === nb;
}

// Shape of a valid Singapore-style plate AFTER normalisation: 1–3 prefix letters,
// 1–4 digits, one final checksum letter. e.g. "SBA5678Z", "GBG1234M", "S1A".
// This is a deliberately STRICT gate — it rejects OCR noise ("YWERETANCLPPEMYY"),
// words ("TOYOTA"), and digit-only junk ("123456789") so garbage can never be
// treated as an observed plate. It is NOT fuzzy matching: the value must match
// exactly, so a plausible plate always maps to exactly one vehicle.
const PLATE_PATTERN = /^[A-Z]{1,3}[0-9]{1,4}[A-Z]$/;

export function isPlausiblePlate(value) {
  return PLATE_PATTERN.test(normalizePlate(value));
}

// Pull the single most plausible plate out of raw OCR text instead of collapsing
// the whole paragraph into one string. Spaces and hyphens inside a plate are
// tolerated ("SKL 9081 A" → "SKL9081A"); unrelated words/lines are ignored.
// Returns the normalised candidate, or "" when nothing plausible is present.
export function extractPlateCandidate(rawText) {
  const text = String(rawText ?? '');
  if (!text.trim()) return '';
  const lines = text.split(/[\r\n]+/);

  // Prefer a line that IS a plate once spacing/hyphens are stripped
  // ("SKL 9081 A", "gbg-1234-m") over a windowed reconstruction of a noisy line.
  for (const line of lines) {
    const whole = normalizePlate(line);
    if (isPlausiblePlate(whole)) return whole;
  }

  // Otherwise scan each line for a run of adjacent tokens that forms a plate,
  // so a plate embedded among other words is still found ("Vehicle SKL 9081 A").
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
