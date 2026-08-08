const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

const GENERATED_SNAPSHOT_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/i;

const getBucketName = () => {
  const bucket = process.env.DETECTION_SNAPSHOT_BUCKET;
  return (bucket && typeof bucket === 'string') ? bucket.trim() : '';
};

const isGcsConfigured = () => Boolean(getBucketName());

const getPrefix = () => {
  const prefix = process.env.DETECTION_SNAPSHOT_PREFIX;
  return (prefix && typeof prefix === 'string' && prefix.trim())
    ? prefix.trim()
    : 'detection-snapshots';
};

let cachedStorageInstance = null;
const getStorageInstance = () => {
  if (!cachedStorageInstance) {
    const { Storage } = require('@google-cloud/storage');
    cachedStorageInstance = new Storage();
  }
  return cachedStorageInstance;
};

const resetStorageClient = () => {
  cachedStorageInstance = null;
};

const getSnapshotRoot = () => {
  const dir = process.env.DETECTION_SNAPSHOT_DIR;
  return path.resolve(
    dir && dir.trim()
      ? dir
      : path.join(os.tmpdir(), 'flowguard', 'detection-snapshots')
  );
};

const ensureSnapshotDirectory = async () => {
  if (isGcsConfigured()) return;
  const root = getSnapshotRoot();
  await fs.promises.mkdir(root, {
    recursive: true,
    mode: 0o700,
  });
};

const resolveSnapshotPath = (filename) => {
  if (!GENERATED_SNAPSHOT_RE.test(filename)) return null;
  const root = getSnapshotRoot();
  const resolved = path.resolve(root, filename);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    return null;
  }
  return resolved;
};

const resolveGcsObjectName = (filename) => {
  if (!GENERATED_SNAPSHOT_RE.test(filename)) return null;
  const prefix = getPrefix();
  return prefix ? `${prefix}/${filename}` : filename;
};

const generateSnapshotFilename = () => `${randomUUID()}.jpg`;

const generateSnapshotDestination = () => {
  const filename = generateSnapshotFilename();
  const destination = resolveSnapshotPath(filename);
  if (!destination) {
    throw new Error('Could not generate a safe snapshot destination.');
  }
  return { filename, destination };
};

const saveSnapshotBuffer = async (filename, buffer) => {
  if (!GENERATED_SNAPSHOT_RE.test(filename)) {
    throw new Error('Invalid snapshot filename format.');
  }
  if (!Buffer.isBuffer(buffer)) {
    throw new Error('Snapshot content must be a Buffer.');
  }

  if (isGcsConfigured()) {
    const bucketName = getBucketName();
    const objectName = resolveGcsObjectName(filename);
    if (!bucketName || !objectName) {
      throw new Error('GCS bucket or object configuration is invalid.');
    }
    const storage = getStorageInstance();
    const file = storage.bucket(bucketName).file(objectName);
    await file.save(buffer, {
      contentType: 'image/jpeg',
      resumable: false,
      metadata: {
        contentType: 'image/jpeg',
      },
    });
  } else {
    await ensureSnapshotDirectory();
    const destination = resolveSnapshotPath(filename);
    if (!destination) {
      throw new Error('Could not resolve safe snapshot path.');
    }
    const fileHandle = await fs.promises.open(destination, 'wx', 0o600);
    try {
      await fileHandle.writeFile(buffer);
    } finally {
      await fileHandle.close().catch(() => {});
    }
  }
};

const readSnapshotBuffer = async (filename) => {
  if (!GENERATED_SNAPSHOT_RE.test(filename)) return null;

  if (isGcsConfigured()) {
    const bucketName = getBucketName();
    const objectName = resolveGcsObjectName(filename);
    if (!bucketName || !objectName) return null;
    const storage = getStorageInstance();
    try {
      const [bytes] = await storage.bucket(bucketName).file(objectName).download();
      return bytes;
    } catch {
      return null;
    }
  } else {
    const filePath = resolveSnapshotPath(filename);
    if (!filePath) return null;
    try {
      return await fs.promises.readFile(filePath);
    } catch {
      return null;
    }
  }
};

const deleteSnapshotFile = async (filename) => {
  if (!GENERATED_SNAPSHOT_RE.test(filename)) return false;

  if (isGcsConfigured()) {
    const bucketName = getBucketName();
    const objectName = resolveGcsObjectName(filename);
    if (!bucketName || !objectName) return false;
    const storage = getStorageInstance();
    try {
      await storage.bucket(bucketName).file(objectName).delete();
      return true;
    } catch (err) {
      if (err && err.code !== 404) {
        console.error('[Snapshot Storage] GCS object delete failed:', err.message || 'Unknown error');
      }
      return false;
    }
  } else {
    const filePath = resolveSnapshotPath(filename);
    if (!filePath) return false;
    try {
      await fs.promises.unlink(filePath);
      return true;
    } catch (err) {
      if (err && err.code !== 'ENOENT') {
        console.error('[Snapshot Storage] Local file delete failed:', err.message || 'Unknown error');
      }
      return false;
    }
  }
};

const extractSnapshotFilename = (snapshotUrl, alertId) => {
  if (typeof snapshotUrl !== 'string' || !snapshotUrl) return null;
  const expectedPrefix = `/api/detection-alerts/${alertId}/snapshot/`;
  if (!snapshotUrl.startsWith(expectedPrefix)) return null;
  const filename = snapshotUrl.slice(expectedPrefix.length);
  if (!GENERATED_SNAPSHOT_RE.test(filename)) return null;
  return filename;
};

const deleteSnapshotByUrl = async (snapshotUrl, alertId) => {
  const filename = extractSnapshotFilename(snapshotUrl, alertId);
  if (!filename) return false;
  return await deleteSnapshotFile(filename);
};

module.exports = {
  GENERATED_SNAPSHOT_RE,
  getBucketName,
  isGcsConfigured,
  getPrefix,
  ensureSnapshotDirectory,
  generateSnapshotFilename,
  generateSnapshotDestination,
  saveSnapshotBuffer,
  readSnapshotBuffer,
  deleteSnapshotFile,
  deleteSnapshotByUrl,
  extractSnapshotFilename,
  resolveGcsObjectName,
  resolveStoredSnapshotPath: resolveSnapshotPath,
  resetStorageClient,
};

Object.defineProperty(module.exports, 'SNAPSHOT_ROOT', {
  get: getSnapshotRoot,
  enumerable: true,
});
