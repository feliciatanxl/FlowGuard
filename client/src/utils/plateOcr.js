// Proof-of-Concept plate OCR wrapper with runtime diagnostic mode.
//
// tesseract.js is loaded via DYNAMIC import so the (large) OCR/WASM code is only
// downloaded when the FM actually runs recognition — it never bloats the initial
// app bundle. The image is processed in memory and discarded by the caller; this
// module never persists frames or uploads them anywhere.

import { extractPlateCandidate } from './plate';

// Lower-centre region where a vehicle plate usually sits in a straight-on capture.
const PLATE_FALLBACK_CROP = { x: 0.15, y: 0.5, w: 0.7, h: 0.45 };

// Unconstrained parameters for full camera scene captures (PSM.AUTO).
const DEFAULT_OCR_PARAMS = Object.freeze({
  tessedit_char_whitelist: '',
  tessedit_pageseg_mode: '3',
});

// Tesseract tuning applied to plate-focused passes (PSM.SINGLE_LINE + whitelist).
const PLATE_OCR_PARAMS = Object.freeze({
  tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  tessedit_pageseg_mode: '7',
});

const DECODE_ERROR_MSG = 'The uploaded image could not be processed. Please select a valid PNG or JPEG.';

/**
 * Inspect JavaScript image/video/file source object and extract diagnostic metadata.
 */
export function getSourceInfo(source, isUpload = false) {
  if (!source) {
    return {
      sourceType: isUpload ? 'Upload' : 'Camera',
      jsObjectType: 'null',
      srcW: 0,
      srcH: 0,
      isReady: false,
    };
  }

  const isFile = typeof File !== 'undefined' && source instanceof File;
  const isBlob = typeof Blob !== 'undefined' && source instanceof Blob;
  const isVideo = (typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement) ||
    (typeof source?.readyState === 'number' || typeof source?.videoWidth === 'number');

  const isCanvas = typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement;
  const isImage = typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement;

  const jsObjectType = isFile ? 'File'
    : isBlob ? 'Blob'
      : isVideo ? 'HTMLVideoElement'
        : isCanvas ? 'HTMLCanvasElement'
          : isImage ? 'HTMLImageElement'
            : typeof source;

  let sourceType = isUpload ? 'Upload' : 'Laptop Webcam';
  if (isCanvas && !isUpload) {
    sourceType = 'Pi 4';
  }

  const srcW = source.videoWidth || source.naturalWidth || source.width || 0;
  const srcH = source.videoHeight || source.naturalHeight || source.height || 0;

  const info = {
    sourceType,
    jsObjectType,
    srcW,
    srcH,
    isReady: true,
  };

  if (isVideo) {
    info.videoWidth = source.videoWidth || 0;
    info.videoHeight = source.videoHeight || 0;
    info.readyState = source.readyState;
    info.isReady = source.readyState >= 2 && source.videoWidth > 0 && source.videoHeight > 0;
  }

  if (isFile || isBlob) {
    info.mimeType = source.type || 'unknown';
    info.fileSize = source.size || 0;
  }

  return info;
}

/**
 * Analyze pixel brightness, contrast variance, and transparency of a canvas.
 */
export function analyzeCanvasPixels(canvas) {
  const w = canvas?.width || 0;
  const h = canvas?.height || 0;
  if (!w || !h) {
    return {
      width: w,
      height: h,
      usable: false,
      reason: 'Zero dimensions',
      minBrightness: 0,
      maxBrightness: 0,
      avgBrightness: 0,
      brightnessVariance: 0,
      brightnessStdDev: 0,
      pctTransparent: 100,
      pctNearWhite: 0,
      pctNearBlack: 100,
    };
  }

  try {
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;
    const totalPixels = w * h;

    let sum = 0;
    let minB = 255;
    let maxB = 0;
    let transparentCount = 0;
    let nearWhiteCount = 0;
    let nearBlackCount = 0;

    const brightnesses = new Float32Array(totalPixels);

    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      const a = d[i + 3];

      if (a < 10) transparentCount += 1;

      const bright = 0.299 * r + 0.587 * g + 0.114 * b;
      const idx = i / 4;
      brightnesses[idx] = bright;

      sum += bright;
      if (bright < minB) minB = bright;
      if (bright > maxB) maxB = bright;

      if (bright > 240) nearWhiteCount += 1;
      if (bright < 15) nearBlackCount += 1;
    }

    const avgB = sum / totalPixels;
    let varianceSum = 0;
    for (let i = 0; i < totalPixels; i += 1) {
      const diff = brightnesses[i] - avgB;
      varianceSum += diff * diff;
    }
    const variance = varianceSum / totalPixels;
    const stdDev = Math.sqrt(variance);

    const pctTransparent = Math.round((transparentCount / totalPixels) * 1000) / 10;
    const pctNearWhite = Math.round((nearWhiteCount / totalPixels) * 1000) / 10;
    const pctNearBlack = Math.round((nearBlackCount / totalPixels) * 1000) / 10;

    let usable = true;
    let reason = 'OK';

    if (pctTransparent > 90) {
      usable = false;
      reason = 'Mostly transparent';
    } else if (variance < 1) {
      usable = false;
      reason = 'Uniform color (zero variance)';
    } else if (pctNearWhite > 98) {
      usable = false;
      reason = 'Blank white canvas';
    } else if (pctNearBlack > 98) {
      usable = false;
      reason = 'Blank black canvas';
    }

    return {
      width: w,
      height: h,
      usable,
      reason,
      minBrightness: Math.round(minB * 10) / 10,
      maxBrightness: Math.round(maxB * 10) / 10,
      avgBrightness: Math.round(avgB * 10) / 10,
      brightnessVariance: Math.round(variance * 10) / 10,
      brightnessStdDev: Math.round(stdDev * 10) / 10,
      pctTransparent,
      pctNearWhite,
      pctNearBlack,
    };
  } catch {
    return {
      width: w,
      height: h,
      usable: true,
      reason: 'getImageData unsupported in test environment',
      minBrightness: 0,
      maxBrightness: 255,
      avgBrightness: 128,
      brightnessVariance: 50,
      brightnessStdDev: 7.07,
      pctTransparent: 0,
      pctNearWhite: 0,
      pctNearBlack: 0,
    };
  }
}

/**
 * Classify OCR operation failure into one exact category.
 */
export function classifyOcrFailure({
  sourceInfo,
  pixelStats,
  passes = [],
  error = null,
  rawText = '',
  extractedCandidate = '',
}) {
  if (error) {
    const msg = String(error.message || error).toLowerCase();
    const stack = String(error.stack || '').toLowerCase();
    if (msg.includes('ready') || msg.includes('not ready')) return 'SOURCE_NOT_READY';
    if (msg.includes('zero') || msg.includes('empty') || sourceInfo?.srcW === 0 || sourceInfo?.srcH === 0) return 'SOURCE_ZERO_DIMENSIONS';
    if (msg.includes('drawimage')) return 'DRAW_IMAGE_FAILED';
    if (msg.includes('worker') || msg.includes('createworker')) return 'TESSERACT_WORKER_INIT_FAILED';
    if (msg.includes('wasm') || msg.includes('fetch') || msg.includes('traineddata') || msg.includes('network') || stack.includes('import')) return 'TESSERACT_ASSET_LOAD_FAILED';
  }

  if (sourceInfo && sourceInfo.isReady === false) {
    return 'SOURCE_NOT_READY';
  }

  if (!sourceInfo || sourceInfo.srcW === 0 || sourceInfo.srcH === 0) {
    return 'SOURCE_ZERO_DIMENSIONS';
  }

  if (pixelStats && !pixelStats.usable) {
    return 'BLANK_OR_UNIFORM_CANVAS';
  }

  if (pixelStats && pixelStats.brightnessVariance < 10) {
    return 'LOW_CONTRAST_CANVAS';
  }

  if (passes.length >= 2 && passes[0]?.raw) {
    const p1Candidate = extractPlateCandidate(passes[0].raw);
    if (p1Candidate && !extractedCandidate) {
      return 'CROP_MISSED_PLATE';
    }
  }

  const trimmedRaw = String(rawText || '').trim();
  if (!trimmedRaw || trimmedRaw === '(none)') {
    return 'TESSERACT_EMPTY_RESULT';
  }

  if (!extractedCandidate) {
    return 'CANDIDATE_REJECTED';
  }

  return 'UNKNOWN_FAILURE';
}

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

async function runOcrPass(worker, inputCanvas, { passName, crop, params } = {}) {
  const startTime = Date.now();
  if (params && typeof worker.setParameters === 'function') {
    await worker.setParameters(params);
  }
  const result = await worker.recognize(inputCanvas);
  const endTime = Date.now();
  const data = result?.data || {};
  const raw = String(data.text || '').trim();
  const confidence = typeof data.confidence === 'number' ? Math.round(data.confidence * 10) / 10 : null;

  let previewUrl = '';
  try {
    if (typeof inputCanvas?.toDataURL === 'function') {
      previewUrl = inputCanvas.toDataURL('image/png');
    }
  } catch { /* best effort */ }

  const wordsCount = Array.isArray(data.words) ? data.words.length : (raw ? raw.split(/\s+/).filter(Boolean).length : 0);
  const symbolsCount = Array.isArray(data.symbols) ? data.symbols.length : 0;

  return {
    passName: passName || 'Pass',
    crop: crop || null,
    params: params ? { ...params } : {},
    dimensions: { w: inputCanvas.width || 0, h: inputCanvas.height || 0 },
    previewUrl,
    startTime,
    endTime,
    durationMs: endTime - startTime,
    raw,
    confidence,
    wordsCount,
    symbolsCount,
  };
}

export async function recognizePlate(source, { crop, isUpload, debug } = {}) {
  const startOpTime = Date.now();
  const sourceInfo = getSourceInfo(source, isUpload);
  let decodedSource = source;

  const isUploadMode = Boolean(
    isUpload ||
    (typeof Blob !== 'undefined' && source instanceof Blob) ||
    (typeof File !== 'undefined' && source instanceof File)
  );

  if (
    (typeof Blob !== 'undefined' && source instanceof Blob) ||
    (typeof File !== 'undefined' && source instanceof File)
  ) {
    decodedSource = await decodeFileToCanvas(source);
  }

  const srcW = decodedSource.videoWidth || decodedSource.naturalWidth || decodedSource.width;
  const srcH = decodedSource.videoHeight || decodedSource.naturalHeight || decodedSource.height;
  if (!srcW || !srcH) {
    const err = new Error('The captured image was empty. Please retake.');
    const classification = classifyOcrFailure({ sourceInfo, error: err });
    return {
      raw: '',
      normalized: '',
      confidence: null,
      readable: false,
      diagnostics: {
        sourceInfo,
        pixelStats: analyzeCanvasPixels(null),
        passes: [],
        classification,
        timing: { startTime: startOpTime, endTime: Date.now(), totalMs: Date.now() - startOpTime },
        workerStatus: { created: false, terminated: false },
        error: { message: err.message },
      },
    };
  }

  const pixelStats = (typeof HTMLCanvasElement !== 'undefined' && decodedSource instanceof HTMLCanvasElement)
    ? analyzeCanvasPixels(decodedSource)
    : (() => {
        try {
          return analyzeCanvasPixels(preprocessToCanvas(decodedSource));
        } catch {
          return analyzeCanvasPixels(null);
        }
      })();

  const aspectRatio = srcH > 0 ? srcW / srcH : 1;
  const isPlateOnly = aspectRatio >= 2.2;

  const passes = [];
  let worker = null;
  let workerCreated = false;
  let workerTerminated = false;



  try {
    const mod = await import('tesseract.js');
    const createWorker = mod.createWorker || mod.default?.createWorker;
    worker = await createWorker('eng');
    workerCreated = true;

    if (isUploadMode) {
      const pass1Canvas = crop ? preprocessToCanvas(decodedSource, { crop }) : preprocessToCanvas(decodedSource);
      const first = await runOcrPass(worker, pass1Canvas, {
        passName: 'Pass 1 (Whole image, plate-focused)',
        crop,
        params: PLATE_OCR_PARAMS,
      });
      passes.push(first);
      let best = first;
      let candidate = extractPlateCandidate(first.raw);

      if (!candidate && !crop) {
        try {
          const pass2Canvas = preprocessToCanvas(decodedSource, { contrastVariant: 1.8 });
          const second = await runOcrPass(worker, pass2Canvas, {
            passName: 'Pass 2 (Alternative contrast 1.8)',
            crop: null,
            params: PLATE_OCR_PARAMS,
          });
          passes.push(second);
          const secondCandidate = extractPlateCandidate(second.raw);
          if (secondCandidate) {
            best = second;
            candidate = secondCandidate;
          }
        } catch { /* pass 2 best-effort */ }
      }

      if (!candidate && !crop && !isPlateOnly) {
        try {
          const pass3Canvas = preprocessToCanvas(decodedSource, { crop: PLATE_FALLBACK_CROP, contrastVariant: 1.4 });
          const third = await runOcrPass(worker, pass3Canvas, {
            passName: 'Pass 3 (Lower-centre crop)',
            crop: PLATE_FALLBACK_CROP,
            params: PLATE_OCR_PARAMS,
          });
          passes.push(third);
          const thirdCandidate = extractPlateCandidate(third.raw);
          if (thirdCandidate) {
            best = third;
            candidate = thirdCandidate;
          }
        } catch { /* pass 3 best-effort */ }
      }

      const endOpTime = Date.now();
      const classification = candidate.length > 0
        ? 'OK'
        : classifyOcrFailure({
            sourceInfo,
            pixelStats,
            passes,
            rawText: best.raw,
            extractedCandidate: candidate,
          });

      const isDebugActive = debug || (
        typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).get('ocrDebug') === '1'
      );

      if (isDebugActive && typeof console !== 'undefined' && console.groupCollapsed) {
        console.groupCollapsed(`🔍 FlowGuard OCR Diagnostics [Upload] — ${candidate ? 'VALID (' + candidate + ')' : classification}`);
        console.log('Source Metadata:', sourceInfo);
        console.log('Canvas Pixel Stats:', pixelStats);
        passes.forEach((p, i) => console.log(`Pass ${i + 1} [${p.passName}]:`, p));
        console.log('Classification:', classification);
        console.groupEnd();
      }

      return {
        raw: best.raw,
        normalized: candidate,
        confidence: best.confidence,
        readable: candidate.length > 0,
        diagnostics: {
          sourceInfo,
          pixelStats,
          passes,
          classification,
          timing: { startTime: startOpTime, endTime: endOpTime, totalMs: endOpTime - startOpTime },
          workerStatus: { created: workerCreated, terminated: false },
          error: null,
        },
      };
    } else {
      const pass1Canvas = crop ? preprocessToCanvas(decodedSource, { crop }) : preprocessToCanvas(decodedSource);
      const first = await runOcrPass(worker, pass1Canvas, {
        passName: 'Pass 1 (Full frame, unconstrained PSM.AUTO)',
        crop,
        params: DEFAULT_OCR_PARAMS,
      });
      passes.push(first);
      let best = first;
      let candidate = extractPlateCandidate(first.raw);

      if (!candidate && !crop) {
        try {
          const pass2Canvas = preprocessToCanvas(decodedSource, { crop: PLATE_FALLBACK_CROP, contrastVariant: 1.4 });
          const second = await runOcrPass(worker, pass2Canvas, {
            passName: 'Pass 2 (Lower-centre crop, SINGLE_LINE)',
            crop: PLATE_FALLBACK_CROP,
            params: PLATE_OCR_PARAMS,
          });
          passes.push(second);
          const secondCandidate = extractPlateCandidate(second.raw);
          if (secondCandidate) {
            best = second;
            candidate = secondCandidate;
          }
        } catch { /* pass 2 crop retry best-effort */ }
      }

      const endOpTime = Date.now();
      const classification = candidate.length > 0
        ? 'OK'
        : classifyOcrFailure({
            sourceInfo,
            pixelStats,
            passes,
            rawText: best.raw,
            extractedCandidate: candidate,
          });

      const isDebugActive = debug || (
        typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).get('ocrDebug') === '1'
      );

      if (isDebugActive && typeof console !== 'undefined' && console.groupCollapsed) {
        console.groupCollapsed(`🔍 FlowGuard OCR Diagnostics [${sourceInfo.sourceType}] — ${candidate ? 'VALID (' + candidate + ')' : classification}`);
        console.log('Source Metadata:', sourceInfo);
        console.log('Canvas Pixel Stats:', pixelStats);
        passes.forEach((p, i) => console.log(`Pass ${i + 1} [${p.passName}]:`, p));
        console.log('Classification:', classification);
        console.groupEnd();
      }

      return {
        raw: best.raw,
        normalized: candidate,
        confidence: best.confidence,
        readable: candidate.length > 0,
        diagnostics: {
          sourceInfo,
          pixelStats,
          passes,
          classification,
          timing: { startTime: startOpTime, endTime: endOpTime, totalMs: endOpTime - startOpTime },
          workerStatus: { created: workerCreated, terminated: false },
          error: null,
        },
      };
    }
  } catch (caughtErr) {
    const endOpTime = Date.now();
    const classification = classifyOcrFailure({ sourceInfo, pixelStats, passes, error: caughtErr });

    return {
      raw: '',
      normalized: '',
      confidence: null,
      readable: false,
      diagnostics: {
        sourceInfo,
        pixelStats,
        passes,
        classification,
        timing: { startTime: startOpTime, endTime: endOpTime, totalMs: endOpTime - startOpTime },
        workerStatus: { created: workerCreated, terminated: workerTerminated },
        error: { message: caughtErr.message, stack: caughtErr.stack },
      },
    };

  } finally {
    if (worker) {
      try {
        await worker.terminate();
        workerTerminated = true;
      } catch { /* teardown best-effort */ }
    }
  }
}
