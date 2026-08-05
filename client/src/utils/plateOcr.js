// Proof-of-Concept plate OCR wrapper.
//
// tesseract.js is loaded via DYNAMIC import so the (large) OCR/WASM code is only
// downloaded when the FM actually runs recognition — it never bloats the initial
// app bundle. The image is processed in memory and discarded by the caller; this
// module never persists frames or uploads them anywhere.
//
// This is a PoC, NOT production-grade licence-plate recognition. Accuracy varies
// with lighting, glare, angle and plate condition — manual verification remains
// available in the UI.

import { extractPlateCandidate } from './plate';

// Lower-centre region where a vehicle plate usually sits in a straight-on capture.
// Used only for the bounded second OCR pass (normalised {x,y,w,h} in 0–1 units).
const PLATE_FALLBACK_CROP = { x: 0.15, y: 0.5, w: 0.7, h: 0.45 };

// Draw a source image/video/canvas onto an offscreen canvas with light
// preprocessing (grayscale + contrast) to give OCR a cleaner signal. Optionally
// crop to a normalised guide rectangle {x,y,w,h} in 0–1 units.
export function preprocessToCanvas(source, { crop } = {}) {
  const srcW = source.videoWidth || source.naturalWidth || source.width;
  const srcH = source.videoHeight || source.naturalHeight || source.height;
  if (!srcW || !srcH) throw new Error('The captured image was empty. Please retake.');

  const sx = crop ? Math.round(crop.x * srcW) : 0;
  const sy = crop ? Math.round(crop.y * srcH) : 0;
  const sw = crop ? Math.round(crop.w * srcW) : srcW;
  const sh = crop ? Math.round(crop.h * srcH) : srcH;

  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);

  // Grayscale + simple contrast stretch. Wrapped in try/catch because some test
  // environments (jsdom) do not implement getImageData.
  try {
    const img = ctx.getImageData(0, 0, sw, sh);
    const d = img.data;
    const contrast = 1.4;
    const intercept = 128 * (1 - contrast);
    for (let i = 0; i < d.length; i += 4) {
      let g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      g = g * contrast + intercept;
      g = g < 0 ? 0 : g > 255 ? 255 : g;
      d[i] = d[i + 1] = d[i + 2] = g;
    }
    ctx.putImageData(img, 0, 0);
  } catch { /* preprocessing is best-effort */ }

  return canvas;
}

// One OCR pass over a source, with optional crop. Returns { raw, confidence }.
async function runOcrPass(recognize, source, { crop } = {}) {
  // A pre-built canvas is used as-is ONLY when no crop is requested; a crop always
  // goes through preprocessToCanvas so the region (and grayscale/contrast) apply.
  const input = (!crop && typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement)
    ? source
    : preprocessToCanvas(source, { crop });
  const result = await recognize(input, 'eng');
  const data = result?.data || {};
  const raw = String(data.text || '').trim();
  const confidence = typeof data.confidence === 'number' ? Math.round(data.confidence * 10) / 10 : null;
  return { raw, confidence };
}

// Run OCR on an image source (canvas/image/video/blob URL) and return only a
// PLAUSIBLE plate — never the whole OCR paragraph collapsed into one string.
//   { raw, normalized, confidence, readable }
//   - raw:        full OCR text, kept for FM troubleshooting only
//   - normalized: the extracted plausible plate, or "" when none was found
//   - readable:   true only when a plausible plate was extracted
// Bounded improvement: the full image is read first; only if that yields no
// plausible plate is ONE extra pass run on a lower-centre crop. At most two OCR
// passes per capture — no continuous scanning, no unbounded retries. Throws on
// OCR failure. The image is processed in memory and never persisted or uploaded.
export async function recognizePlate(source, { crop } = {}) {
  const mod = await import('tesseract.js');
  const recognize = mod.recognize || mod.default?.recognize || mod.default;

  const first = await runOcrPass(recognize, source, { crop });
  let best = first;
  let candidate = extractPlateCandidate(first.raw);

  // Second, bounded pass on a lower-centre crop when the full frame gave no
  // plausible plate and the caller didn't already constrain the region.
  if (!candidate && !crop) {
    try {
      const second = await runOcrPass(recognize, source, { crop: PLATE_FALLBACK_CROP });
      const secondCandidate = extractPlateCandidate(second.raw);
      if (secondCandidate) {
        best = second;
        candidate = secondCandidate;
      }
    } catch { /* the fallback crop is best-effort — keep the first pass result */ }
  }

  return {
    raw: best.raw,
    normalized: candidate,
    confidence: best.confidence,
    readable: candidate.length > 0,
  };
}
