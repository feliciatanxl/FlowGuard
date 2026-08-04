const {
  DETECTION_ALERT_RETENTION_MS,
  DETECTION_ALERT_PURGE_INTERVAL_MS,
  DETECTION_ALERT_INITIAL_DELAY_MS,
  createDetectionAlertRetentionTask,
} = require('../services/detectionAlertRetention');

describe('detection-alert retention lifecycle', () => {
  const Op = { lt: Symbol('lt') };

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('starts once, preserves the initial delay and daily retention query, and can stop', async () => {
    const nowValue = Date.UTC(2026, 7, 4, 12, 0, 0);
    const DetectionAlert = { destroy: jest.fn().mockResolvedValue(2) };
    const logger = { log: jest.fn(), error: jest.fn() };
    const task = createDetectionAlertRetentionTask({ DetectionAlert, Op, logger, now: () => nowValue });

    expect(task.isStarted()).toBe(false);
    expect(task.start()).toBe(true);
    expect(task.start()).toBe(false);
    expect(task.isStarted()).toBe(true);

    await jest.advanceTimersByTimeAsync(DETECTION_ALERT_INITIAL_DELAY_MS - 1);
    expect(DetectionAlert.destroy).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(DetectionAlert.destroy).toHaveBeenCalledTimes(1);
    expect(DetectionAlert.destroy).toHaveBeenCalledWith({
      where: {
        createdAt: {
          [Op.lt]: new Date(nowValue - DETECTION_ALERT_RETENTION_MS),
        },
      },
      force: true,
    });

    await jest.advanceTimersByTimeAsync(DETECTION_ALERT_PURGE_INTERVAL_MS - DETECTION_ALERT_INITIAL_DELAY_MS);
    expect(DetectionAlert.destroy).toHaveBeenCalledTimes(2);
    expect(logger.log).toHaveBeenCalledWith('[Purge] Removed 2 stale detection alerts.');

    task.stop();
    expect(task.isStarted()).toBe(false);
    await jest.advanceTimersByTimeAsync(DETECTION_ALERT_PURGE_INTERVAL_MS);
    expect(DetectionAlert.destroy).toHaveBeenCalledTimes(2);
  });

  test('stopping before the initial delay clears every timer', async () => {
    const DetectionAlert = { destroy: jest.fn().mockResolvedValue(0) };
    const task = createDetectionAlertRetentionTask({ DetectionAlert, Op });
    task.start();
    task.stop();
    await jest.runOnlyPendingTimersAsync();
    expect(DetectionAlert.destroy).not.toHaveBeenCalled();
  });

  test('cleanup failures are logged and remain non-fatal', async () => {
    const error = new Error('temporary database failure');
    const logger = { log: jest.fn(), error: jest.fn() };
    const task = createDetectionAlertRetentionTask({
      DetectionAlert: { destroy: jest.fn().mockRejectedValue(error) },
      Op,
      logger,
    });

    await expect(task.purgeStaleLogs()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith('[Purge] Error:', error);
  });
});
