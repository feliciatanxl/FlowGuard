const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

const configuredSnapshotDirectory = process.env.DETECTION_SNAPSHOT_DIR;
const SNAPSHOT_ROOT = path.resolve(
  configuredSnapshotDirectory && configuredSnapshotDirectory.trim()
    ? configuredSnapshotDirectory
    : path.join(os.tmpdir(), 'flowguard', 'detection-snapshots')
);

const GENERATED_SNAPSHOT_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/i;

// Snapshot storage is deliberately created only when an upload is about to be
// persisted. Cloud Run's application filesystem is read-only to the non-root
// runtime user, while its OS temporary directory is writable but ephemeral.
const ensureSnapshotDirectory = async () => {
  await fs.promises.mkdir(SNAPSHOT_ROOT, {
    recursive: true,
    mode: 0o700,
  });
};

const resolveSnapshotPath = (filename) => {
  if (!GENERATED_SNAPSHOT_RE.test(filename)) return null;
  const resolved = path.resolve(SNAPSHOT_ROOT, filename);
  if (resolved === SNAPSHOT_ROOT || !resolved.startsWith(`${SNAPSHOT_ROOT}${path.sep}`)) {
    return null;
  }
  return resolved;
};

const generateSnapshotDestination = () => {
  const filename = `${randomUUID()}.jpg`;
  const destination = resolveSnapshotPath(filename);
  if (!destination) {
    throw new Error('Could not generate a safe snapshot destination.');
  }
  return { filename, destination };
};

module.exports = {
  SNAPSHOT_ROOT,
  GENERATED_SNAPSHOT_RE,
  ensureSnapshotDirectory,
  generateSnapshotDestination,
  resolveStoredSnapshotPath: resolveSnapshotPath,
};
