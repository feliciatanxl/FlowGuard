// Safe temporary media previews.
//
// Every preview URL is produced ONLY by URL.createObjectURL on a VALIDATED
// File/Blob, yielding a `blob:` URL that the browser never parses as HTML. No
// file name, remote URL, `javascript:`/`data:text/html` scheme, or other
// user-controlled string is ever assigned to an HTML sink or to an element
// src — so there is no "DOM text reinterpreted as HTML" path here. Callers keep
// the returned URL in React state and revoke it on replacement/unmount via
// revokeTemporaryObjectUrl. Uploaded bytes stay in memory only; nothing is
// persisted to satisfy a scanner. See the security report, Part 4.

export const DEFAULT_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp'];
export const DEFAULT_VIDEO_MIME_TYPES = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'];

export const DEFAULT_MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15 MB
export const DEFAULT_MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 200 MB

// A File is a Blob; guard against strings, plain objects, null, etc.
const isBlobLike = (file) =>
  typeof Blob !== 'undefined' && file instanceof Blob;

const mb = (bytes) => Math.round(bytes / (1024 * 1024));

const validateMediaFile = (file, { allowedTypes, maxBytes, kind }) => {
  if (!isBlobLike(file)) {
    return { ok: false, error: `No ${kind} file selected.` };
  }
  // Only trust the browser-reported MIME type against a strict allowlist.
  if (!allowedTypes.includes(file.type)) {
    return { ok: false, error: `Unsupported ${kind} type "${file.type || 'unknown'}". Allowed: ${allowedTypes.join(', ')}.` };
  }
  if (!(file.size > 0)) {
    return { ok: false, error: `The selected ${kind} file is empty.` };
  }
  if (file.size > maxBytes) {
    return { ok: false, error: `${kind === 'image' ? 'Image' : 'Video'} exceeds the ${mb(maxBytes)} MB limit.` };
  }
  return { ok: true, file };
};

export const validateImageFile = (file, opts = {}) =>
  validateMediaFile(file, {
    allowedTypes: opts.allowedTypes || DEFAULT_IMAGE_MIME_TYPES,
    maxBytes: opts.maxBytes || DEFAULT_MAX_IMAGE_BYTES,
    kind: 'image',
  });

export const validateVideoFile = (file, opts = {}) =>
  validateMediaFile(file, {
    allowedTypes: opts.allowedTypes || DEFAULT_VIDEO_MIME_TYPES,
    maxBytes: opts.maxBytes || DEFAULT_MAX_VIDEO_BYTES,
    kind: 'video',
  });

// Create a temporary blob: object URL from a validated File/Blob ONLY. Returns
// null for anything that is not a Blob — callers MUST handle null and must never
// fall back to assigning a raw/remote URL.
export const createTemporaryObjectUrl = (file) => {
  if (!isBlobLike(file)) return null;
  return URL.createObjectURL(file);
};

// Revoke a previously created object URL. Safely ignores empty values and only
// ever revokes blob: URLs (never touches an http(s)/data URL by accident).
export const revokeTemporaryObjectUrl = (url) => {
  if (typeof url === 'string' && url.startsWith('blob:')) {
    URL.revokeObjectURL(url);
  }
};

// Convenience: validate + create in one step. Returns { ok, url?, error? }.
export const prepareImagePreview = (file, opts = {}) => {
  const result = validateImageFile(file, opts);
  if (!result.ok) return result;
  return { ok: true, url: createTemporaryObjectUrl(result.file) };
};

export const prepareVideoPreview = (file, opts = {}) => {
  const result = validateVideoFile(file, opts);
  if (!result.ok) return result;
  return { ok: true, url: createTemporaryObjectUrl(result.file) };
};
