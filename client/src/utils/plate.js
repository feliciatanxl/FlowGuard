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

// Position-aware OCR character-confusion tables. These encode ONLY the visual
// digit⇆letter confusions Tesseract makes on Singapore plates. A substitution is
// applied SOLELY where a character's current type is impossible for its grammar
// position — this is strict syntax repair, never fuzzy matching and never edit
// distance. (Mirrors server/utils/plate.js exactly.)
const DIGIT_TO_LETTER = { 0: 'O', 1: 'I', 2: 'Z', 5: 'S', 6: 'G', 8: 'B' };
// The final checksum letter additionally recovers a Z mis-read as 7 — the exact
// physically-observed failure ("SBA5678Z" → "SBA56787").
const DIGIT_TO_LETTER_FINAL = { ...DIGIT_TO_LETTER, 7: 'Z' };
const LETTER_TO_DIGIT = { O: '0', I: '1', L: '1', Z: '2', S: '5', G: '6', B: '8' };

const isLetterChar = (c) => c >= 'A' && c <= 'Z';
const isDigitChar = (c) => c >= '0' && c <= '9';

// Resolve one character to the type its position REQUIRES: keep it when already
// correct, substitute only a known OCR confusion, and return null when it cannot
// legally occupy that position.
function resolveLetter(c, table) {
  if (isLetterChar(c)) return c;
  return isDigitChar(c) ? (table[c] || null) : null;
}
function resolveDigit(c) {
  if (isDigitChar(c)) return c;
  return isLetterChar(c) ? (LETTER_TO_DIGIT[c] || null) : null;
}

// Controlled, position-aware plate-syntax repair. Returns a single plausible plate
// ONLY when the plate GRAMMAR (1–3 prefix letters, 1–4 digits, 1 checksum letter)
// forces exactly one interpretation of the raw value. It NEVER consults the
// booked/expected plate, never uses fuzzy matching or edit distance, and returns
// "" when the value is already unrepairable OR ambiguous (zero, or multiple
// distinct, plausible reconstructions). A value that is already a valid plate is
// returned unchanged — substitutions are never applied to a well-formed plate.
export function repairPlateCandidate(value) {
  const s = normalizePlate(value);
  if (!s) return '';
  if (isPlausiblePlate(s)) return s; // already valid → never substitute

  const results = new Set();
  for (let prefixLen = 1; prefixLen <= 3; prefixLen += 1) {
    for (let numLen = 1; numLen <= 4; numLen += 1) {
      if (prefixLen + numLen + 1 !== s.length) continue; // must fit the grammar length exactly
      const out = [];
      let ok = true;
      for (let i = 0; i < s.length && ok; i += 1) {
        let ch;
        if (i < prefixLen) ch = resolveLetter(s[i], DIGIT_TO_LETTER); // prefix letters
        else if (i < prefixLen + numLen) ch = resolveDigit(s[i]); // numeric block
        else ch = resolveLetter(s[i], DIGIT_TO_LETTER_FINAL); // final checksum letter
        if (ch == null) ok = false; else out.push(ch);
      }
      // Every completed reconstruction is plausible by construction.
      if (ok) results.add(out.join(''));
    }
  }

  // Accept ONLY a unique reconstruction; zero or multiple candidates → unreadable.
  return results.size === 1 ? [...results][0] : '';
}

// Pull the single most plausible plate out of raw OCR text instead of collapsing
// the whole paragraph into one string. Spaces and hyphens inside a plate are
// tolerated ("SKL 9081 A", "gbg-1234-m"); unrelated words/lines are ignored.
// Returns the normalised candidate, or "" when nothing plausible is present.
export function extractPlateCandidate(rawText) {
  const text = String(rawText ?? '');
  if (!text.trim()) return '';
  const lines = text.split(/[\r\n]+/);

  // 1. First priority: Any line that IS an exact plausible plate once spacing/hyphens are stripped.
  for (const line of lines) {
    const whole = normalizePlate(line);
    if (isPlausiblePlate(whole)) return whole;
  }

  // 2. Second priority: Any line that uniquely repairs as a whole line ("6BG1234M" -> "GBG1234M").
  for (const line of lines) {
    const whole = normalizePlate(line);
    const repairedWhole = repairPlateCandidate(whole);
    if (repairedWhole) return repairedWhole;
  }

  // 3. Third priority: Scan each line for a run of adjacent tokens forming an exact plausible plate.
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

  // 4. Fallback priority: Token-windowed controlled syntax repair.
  const repaired = new Set();
  for (const line of lines) {
    const tokens = line.split(/[^A-Za-z0-9]+/).filter(Boolean);
    for (let i = 0; i < tokens.length; i += 1) {
      let joined = '';
      for (let j = i; j < tokens.length && j < i + 4; j += 1) {
        joined += tokens[j];
        const r = repairPlateCandidate(joined);
        if (r) repaired.add(r);
      }
    }
  }
  return repaired.size === 1 ? [...repaired][0] : '';
}
