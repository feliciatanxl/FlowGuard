const DETECTION_ALERT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DETECTION_ALERT_PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DETECTION_ALERT_INITIAL_DELAY_MS = 20000;

function createDetectionAlertRetentionTask({
  DetectionAlert,
  Op,
  logger = console,
  now = () => Date.now(),
  initialDelayMs = DETECTION_ALERT_INITIAL_DELAY_MS,
  intervalMs = DETECTION_ALERT_PURGE_INTERVAL_MS,
} = {}) {
  let started = false;
  let initialTimer = null;
  let intervalTimer = null;

  const purgeStaleLogs = async () => {
    if (typeof DetectionAlert?.destroy !== 'function') return;
    const cutoff = new Date(now() - DETECTION_ALERT_RETENTION_MS);
    try {
      const removed = await DetectionAlert.destroy({
        where: { createdAt: { [Op.lt]: cutoff } },
        force: true,
      });
      if (removed > 0) logger.log(`[Purge] Removed ${removed} stale detection alerts.`);
    } catch (error) {
      // Retention is maintenance work. A failure is logged but never terminates
      // request handling or database readiness.
      logger.error('[Purge] Error:', error);
    }
  };

  const start = () => {
    if (started) return false;
    started = true;
    initialTimer = setTimeout(() => {
      initialTimer = null;
      void purgeStaleLogs();
    }, initialDelayMs);
    intervalTimer = setInterval(() => { void purgeStaleLogs(); }, intervalMs);
    initialTimer.unref?.();
    intervalTimer.unref?.();
    return true;
  };

  const stop = () => {
    if (initialTimer) clearTimeout(initialTimer);
    if (intervalTimer) clearInterval(intervalTimer);
    initialTimer = null;
    intervalTimer = null;
    started = false;
  };

  return {
    start,
    stop,
    purgeStaleLogs,
    isStarted: () => started,
  };
}

module.exports = {
  DETECTION_ALERT_RETENTION_MS,
  DETECTION_ALERT_PURGE_INTERVAL_MS,
  DETECTION_ALERT_INITIAL_DELAY_MS,
  createDetectionAlertRetentionTask,
};
