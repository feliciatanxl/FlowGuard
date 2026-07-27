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
