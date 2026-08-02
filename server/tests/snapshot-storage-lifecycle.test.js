const fs = require('fs');
const os = require('os');
const path = require('path');

describe('detection snapshot storage lifecycle', () => {
  const originalSnapshotDirectory = process.env.DETECTION_SNAPSHOT_DIR;
  const temporaryRoot = path.join(os.tmpdir(), `flowguard-snapshot-lifecycle-${process.pid}`);

  beforeEach(() => {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    jest.resetModules();
  });

  afterEach(() => {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    if (originalSnapshotDirectory === undefined) delete process.env.DETECTION_SNAPSHOT_DIR;
    else process.env.DETECTION_SNAPSHOT_DIR = originalSnapshotDirectory;
    jest.restoreAllMocks();
    jest.resetModules();
  });

  test('module import performs no mkdir and defaults outside the non-writable application directory', () => {
    delete process.env.DETECTION_SNAPSHOT_DIR;
    const mkdirSync = jest.spyOn(fs, 'mkdirSync').mockImplementation(() => {
      const error = new Error('simulated non-writable /app');
      error.code = 'EACCES';
      throw error;
    });
    const mkdir = jest.spyOn(fs.promises, 'mkdir').mockRejectedValue(
      Object.assign(new Error('simulated non-writable /app'), { code: 'EACCES' })
    );

    let storage;
    expect(() => {
      jest.isolateModules(() => {
        storage = require('../utils/detectionSnapshotStorage');
      });
    }).not.toThrow();

    expect(mkdirSync).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
    expect(storage.SNAPSHOT_ROOT).toBe(
      path.resolve(os.tmpdir(), 'flowguard', 'detection-snapshots')
    );
    expect(storage.SNAPSHOT_ROOT).not.toContain(`${path.sep}app${path.sep}`);
  });

  test('creates a configured temporary directory lazily immediately before persistence', async () => {
    process.env.DETECTION_SNAPSHOT_DIR = temporaryRoot;
    const storage = require('../utils/detectionSnapshotStorage');

    expect(fs.existsSync(temporaryRoot)).toBe(false);
    await storage.ensureSnapshotDirectory();
    expect(fs.statSync(temporaryRoot).isDirectory()).toBe(true);

    const { filename, destination } = storage.generateSnapshotDestination();
    expect(filename).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/i);
    expect(destination).toBe(path.resolve(temporaryRoot, filename));
    expect(destination.startsWith(`${path.resolve(temporaryRoot)}${path.sep}`)).toBe(true);
    expect(fs.existsSync(destination)).toBe(false);
  });
});
