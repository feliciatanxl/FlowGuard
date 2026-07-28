// Client tests — safe temporary media previews (Felicia).
// Covers the reusable helper behind the FacialEvaluation / ObjectDetection
// upload previews: MIME + size validation, blob:-URL-only creation, revoke
// lifecycle, rejection of attacker-controlled (non-Blob) input, and a source
// guard proving no unsafe HTML sink exists in the two upload components.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  validateImageFile,
  validateVideoFile,
  createTemporaryObjectUrl,
  revokeTemporaryObjectUrl,
  prepareImagePreview,
  DEFAULT_MAX_IMAGE_BYTES,
  DEFAULT_MAX_VIDEO_BYTES,
} from '../../src/utils/mediaPreview';

// jsdom does not implement object URLs — stub them and record calls.
let created;
let revoked;
beforeEach(() => {
  created = [];
  revoked = [];
  globalThis.URL.createObjectURL = vi.fn(() => {
    const url = `blob:mock/${created.length}`;
    created.push(url);
    return url;
  });
  globalThis.URL.revokeObjectURL = vi.fn((url) => revoked.push(url));
});
afterEach(() => vi.restoreAllMocks());

// A Blob of an arbitrary reported size WITHOUT allocating the bytes.
const fakeBlob = (type, size) => {
  const b = new Blob(['x'], { type });
  Object.defineProperty(b, 'size', { value: size, configurable: true });
  return b;
};

describe('validateImageFile', () => {
  test('accepts a valid image', () => {
    expect(validateImageFile(fakeBlob('image/png', 1024)).ok).toBe(true);
    expect(validateImageFile(fakeBlob('image/jpeg', 2048)).ok).toBe(true);
    expect(validateImageFile(fakeBlob('image/webp', 2048)).ok).toBe(true);
  });
  test('rejects an unsupported MIME type', () => {
    const r = validateImageFile(fakeBlob('text/html', 1024));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unsupported/i);
  });
  test('rejects an oversized file', () => {
    const r = validateImageFile(fakeBlob('image/png', DEFAULT_MAX_IMAGE_BYTES + 1));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/limit/i);
  });
  test('rejects an empty file', () => {
    expect(validateImageFile(fakeBlob('image/png', 0)).ok).toBe(false);
  });
  test('rejects non-Blob / attacker-controlled input', () => {
    expect(validateImageFile('javascript:alert(1)').ok).toBe(false);
    expect(validateImageFile('http://evil.example/x.png').ok).toBe(false);
    expect(validateImageFile({ name: 'x', type: 'image/png', size: 10 }).ok).toBe(false);
    expect(validateImageFile(null).ok).toBe(false);
    expect(validateImageFile(undefined).ok).toBe(false);
  });
});

describe('validateVideoFile', () => {
  test('accepts a valid video', () => {
    expect(validateVideoFile(fakeBlob('video/mp4', 5000)).ok).toBe(true);
    expect(validateVideoFile(fakeBlob('video/webm', 5000)).ok).toBe(true);
  });
  test('rejects an image posing as a video', () => {
    expect(validateVideoFile(fakeBlob('image/png', 5000)).ok).toBe(false);
  });
  test('rejects an oversized video', () => {
    expect(validateVideoFile(fakeBlob('video/mp4', DEFAULT_MAX_VIDEO_BYTES + 1)).ok).toBe(false);
  });
});

describe('createTemporaryObjectUrl / revokeTemporaryObjectUrl', () => {
  test('creates a blob: URL only from a Blob', () => {
    const url = createTemporaryObjectUrl(fakeBlob('image/png', 10));
    expect(url).toBe('blob:mock/0');
    expect(globalThis.URL.createObjectURL).toHaveBeenCalledTimes(1);
  });
  test('returns null (and creates NO url) for attacker-controlled non-Blob input', () => {
    expect(createTemporaryObjectUrl('http://evil.example/x')).toBeNull();
    expect(createTemporaryObjectUrl('javascript:alert(1)')).toBeNull();
    expect(createTemporaryObjectUrl(null)).toBeNull();
    expect(globalThis.URL.createObjectURL).not.toHaveBeenCalled();
  });
  test('revoke only ever touches blob: URLs', () => {
    revokeTemporaryObjectUrl('blob:mock/0');
    revokeTemporaryObjectUrl('http://evil.example/x'); // ignored
    revokeTemporaryObjectUrl('javascript:alert(1)'); // ignored
    revokeTemporaryObjectUrl(null); // ignored
    expect(revoked).toEqual(['blob:mock/0']);
  });
  test('replacement revokes the previous URL before creating a new one', () => {
    const first = createTemporaryObjectUrl(fakeBlob('image/png', 10));
    revokeTemporaryObjectUrl(first); // caller revokes before replacing
    const second = createTemporaryObjectUrl(fakeBlob('image/png', 10));
    expect(revoked).toContain(first);
    expect(second).not.toBe(first);
  });
});

describe('prepareImagePreview convenience', () => {
  test('validates then creates on success; no url on failure', () => {
    const ok = prepareImagePreview(fakeBlob('image/png', 100));
    expect(ok).toEqual({ ok: true, url: 'blob:mock/0' });
    const bad = prepareImagePreview(fakeBlob('application/pdf', 100));
    expect(bad.ok).toBe(false);
    expect(bad.url).toBeUndefined();
    expect(globalThis.URL.createObjectURL).toHaveBeenCalledTimes(1); // never called for the rejected file
  });
});

describe('no unsafe HTML sink in the upload components', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const read = (rel) => readFileSync(path.resolve(here, rel), 'utf8');
  const FILES = ['../../src/pages/FacialEvaluation.jsx', '../../src/pages/ObjectDetection.jsx'];

  test('neither component uses dangerouslySetInnerHTML / innerHTML / insertAdjacentHTML / document.write', () => {
    for (const rel of FILES) {
      const src = read(rel);
      expect(src).not.toMatch(/dangerouslySetInnerHTML/);
      expect(src).not.toMatch(/\.innerHTML\s*=/);
      expect(src).not.toMatch(/insertAdjacentHTML/);
      expect(src).not.toMatch(/document\.write\s*\(/);
    }
  });

  test('both components build previews through the validated helper', () => {
    for (const rel of FILES) {
      expect(read(rel)).toMatch(/createTemporaryObjectUrl/);
    }
  });
});
