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
// Used for the bounded fallback OCR pass on vehicle scenes (normalised {x,y,w,h} in 0–1 units).
const PLATE_FALLBACK_CROP = { x: 0.15, y: 0.5, w: 0.7, h: 0.45 };

// Unconstrained parameters for full camera scene captures (allows Tesseract to detect text anywhere).
const DEFAULT_OCR_PARAMS = Object.freeze({
  tessedit_char_whitelist: '',
  tessedit_pageseg_mode: '3', // PSM.AUTO — default page segmentation for camera scenes
});

// Tesseract tuning applied to plate-focused passes: letters and digits only, single text line.
const PLATE_OCR_PARAMS = Object.freeze({
  tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  tessedit_pageseg_mode: '7', // PSM.SINGLE_LINE — treat as one text line
});

const DECODE_ERROR_MSG = 'The uploaded image could not be processed. Please select a valid PNG or JPEG.';

/**
 * Decode an uploaded image File/Blob into a stable, non-zero canvas before OCR.
 * Supports PNG and JPEG (and safe web image formats). Uses createImageBitmap with
 * an HTMLImageElement fallback. Automatically closes ImageBitmap and revokes object URLs in finally.
 * Throws a specific user-friendly error message if decoding fails or dimensions are zero.
 */
export async function decodeFileToCanvas(file) {
  if (!file || typeof file !== 'object') {
    throw new Error(DECODE_ERROR_MSG);
  }

  if (file.type) {
    const type = String(file.type).toLowerCase();
    const isSupported = type.startsWith('image/png') || type.startsWith('image/jpeg') || type.startsWith('image/jpg') || type.startsWith('image/webp');
    if (!isSupported) {
      throw new Error(DECODE_ERROR_MSG);
    }
  }

  let bitmap = null;
  let objectUrl = null;
  let drawSource = null;
  let srcW = 0;
  let srcH = 0;

  try {
    // 1. Preferred strategy: createImageBitmap
    if (typeof createImageBitmap === 'function') {
      try {
        bitmap = await createImageBitmap(file);
        if (bitmap) {
          if (bitmap.width <= 0 || bitmap.height <= 0) {
            throw new Error(DECODE_ERROR_MSG);
          }
          drawSource = bitmap;
          srcW = bitmap.width;
          srcH = bitmap.height;
        }
      } catch (err) {
        if (err?.message === DECODE_ERROR_MSG) {
          throw err;
        }
        bitmap = null;
      }
    }

    // 2. Fallback strategy: HTMLImageElement + URL.createObjectURL
    if (!drawSource && typeof URL !== 'undefined' && URL.createObjectURL && typeof Image !== 'undefined') {
      objectUrl = URL.createObjectURL(file);
      const img = new Image();
      const loaded = new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Image load failed'));
      });
      img.src = objectUrl;
      await loaded;
      if (img.decode) {
        try { await img.decode(); } catch { /* best effort */ }
      }
      srcW = img.naturalWidth || img.width || 0;
      srcH = img.naturalHeight || img.height || 0;
      if (srcW > 0 && srcH > 0) {
        drawSource = img;
      }
    }

    if (!drawSource || srcW <= 0 || srcH <= 0) {
      throw new Error(DECODE_ERROR_MSG);
    }

    // Cap extremely large dimensions while preserving aspect ratio
    const MAX_DIM = 2400;
    let targetW = srcW;
    let targetH = srcH;
    if (targetW > MAX_DIM || targetH > MAX_DIM) {
      const scale = Math.min(MAX_DIM / targetW, MAX_DIM / targetH);
      targetW = Math.round(targetW * scale);
      targetH = Math.round(targetH * scale);
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(drawSource, 0, 0, srcW, srcH, 0, 0, targetW, targetH);
    return canvas;
  } catch (err) {
    if (err?.message === DECODE_ERROR_MSG) {
      throw err;
    }
    throw new Error(DECODE_ERROR_MSG, { cause: err });
  } finally {
    if (bitmap && typeof bitmap.close === 'function') {
      try { bitmap.close(); } catch { /* ignore */ }
    }
    if (objectUrl && typeof URL !== 'undefined' && URL.revokeObjectURL) {
      try { URL.revokeObjectURL(objectUrl); } catch { /* ignore */ }
    }
  }
}

// Draw a source image/video/canvas onto an offscreen canvas with light
// preprocessing (grayscale + contrast) to give OCR a cleaner signal. Optionally
// crop to a normalised guide rectangle {x,y,w,h} in 0–1 units.
export function preprocessToCanvas(source, { crop, contrastVariant = 1.4 } = {}) {
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

  // Grayscale + simple contrast stretch. Wrapped in try/catch because jsdom
  // does not implement getImageData.
  try {
    const img = ctx.getImageData(0, 0, sw, sh);
    const d = img.data;
    const contrast = contrastVariant;
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

// One OCR pass over a source canvas with per-pass Tesseract parameters applied
// through worker.setParameters. Returns { raw, confidence }.
async function runOcrPass(worker, inputCanvas, { params } = {}) {
  if (params && typeof worker.setParameters === 'function') {
    await worker.setParameters(params);
  }
  const result = await worker.recognize(inputCanvas);
  const data = result?.data || {};
  const raw = String(data.text || '').trim();
  const confidence = typeof data.confidence === 'number' ? Math.round(data.confidence * 10) / 10 : null;
  return { raw, confidence };
}

// Run OCR on an image source (File/Blob, canvas, image, video) and return only a
// PLAUSIBLE plate — never the whole OCR paragraph collapsed into one string.
//   { raw, normalized, confidence, readable }
// Bounded passes per source type:
// Camera/Pi 4:
//   Pass 1: Full frame, unconstrained configuration (previous working behavior)
//   Pass 2: Bounded lower-centre crop retry with plate whitelist + SINGLE_LINE mode
// Uploaded image:
//   Pass 1: Whole decoded image, plate-focused (whitelist + SINGLE_LINE mode)
//   Pass 2: Whole decoded image, alternative contrast variant
//   Pass 3: Lower-centre crop (only when image is a wider vehicle photo, not a plate-only image)
export async function recognizePlate(source, { crop, isUpload } = {}) {
  let decodedSource = source;

  const isUploadMode = Boolean(
    isUpload ||
    (typeof Blob !== 'undefined' && source instanceof Blob) ||
    (typeof File !== 'undefined' && source instanceof File)
  );

  // If source is a raw File or Blob, decode it into a stable canvas first
  if (
    (typeof Blob !== 'undefined' && source instanceof Blob) ||
    (typeof File !== 'undefined' && source instanceof File)
  ) {
    decodedSource = await decodeFileToCanvas(source);
  }

  const srcW = decodedSource.videoWidth || decodedSource.naturalWidth || decodedSource.width;
  const srcH = decodedSource.videoHeight || decodedSource.naturalHeight || decodedSource.height;
  if (!srcW || !srcH) {
    throw new Error('The captured image was empty. Please retake.');
  }

  const aspectRatio = srcH > 0 ? srcW / srcH : 1;
  // A wide aspect ratio (>= 2.2) indicates a plate-only cropped image.
  const isPlateOnly = aspectRatio >= 2.2;

  const mod = await import('tesseract.js');
  const createWorker = mod.createWorker || mod.default?.createWorker;
  const worker = await createWorker('eng');

  try {
    if (isUploadMode) {
      // --- Upload Pipeline (at most 3 passes) ---
      // Pass 1: Whole decoded image, plate-focused
      const pass1Canvas = crop ? preprocessToCanvas(decodedSource, { crop }) : preprocessToCanvas(decodedSource);
      const first = await runOcrPass(worker, pass1Canvas, { params: PLATE_OCR_PARAMS });
      let best = first;
      let candidate = extractPlateCandidate(first.raw);

      // Pass 2: Whole decoded image with an alternative contrast variant
      if (!candidate && !crop) {
        try {
          const pass2Canvas = preprocessToCanvas(decodedSource, { contrastVariant: 1.8 });
          const second = await runOcrPass(worker, pass2Canvas, { params: PLATE_OCR_PARAMS });
          const secondCandidate = extractPlateCandidate(second.raw);
          if (secondCandidate) {
            best = second;
            candidate = secondCandidate;
          }
        } catch { /* pass 2 is best-effort */ }
      }

      // Pass 3: Lower-centre crop only when the image resembles a wider vehicle photograph (not plate-only)
      if (!candidate && !crop && !isPlateOnly) {
        try {
          const pass3Canvas = preprocessToCanvas(decodedSource, { crop: PLATE_FALLBACK_CROP, contrastVariant: 1.4 });
          const third = await runOcrPass(worker, pass3Canvas, { params: PLATE_OCR_PARAMS });
          const thirdCandidate = extractPlateCandidate(third.raw);
          if (thirdCandidate) {
            best = third;
            candidate = thirdCandidate;
          }
        } catch { /* pass 3 is best-effort */ }
      }

      return {
        raw: best.raw,
        normalized: candidate,
        confidence: best.confidence,
        readable: candidate.length > 0,
      };
    } else {
      // --- Camera / Pi 4 Pipeline (at most 2 passes) ---
      // Pass 1: Full frame, unconstrained configuration (previous working behavior)
      const pass1Canvas = crop ? preprocessToCanvas(decodedSource, { crop }) : preprocessToCanvas(decodedSource);
      const first = await runOcrPass(worker, pass1Canvas, { params: DEFAULT_OCR_PARAMS });
      let best = first;
      let candidate = extractPlateCandidate(first.raw);

      // Pass 2: Bounded lower-centre crop retry with whitelist + SINGLE_LINE mode
      if (!candidate && !crop) {
        try {
          const pass2Canvas = preprocessToCanvas(decodedSource, { crop: PLATE_FALLBACK_CROP, contrastVariant: 1.4 });
          const second = await runOcrPass(worker, pass2Canvas, { params: PLATE_OCR_PARAMS });
          const secondCandidate = extractPlateCandidate(second.raw);
          if (secondCandidate) {
            best = second;
            candidate = secondCandidate;
          }
        } catch { /* crop retry is best-effort */ }
      }

      return {
        raw: best.raw,
        normalized: candidate,
        confidence: best.confidence,
        readable: candidate.length > 0,
      };
    }
  } finally {
    try { await worker.terminate(); } catch { /* worker teardown is best-effort */ }
  }
}
