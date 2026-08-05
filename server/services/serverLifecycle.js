const createReadinessState = () => {
  let ready = false;

  return {
    markReady: () => { ready = true; },
    markNotReady: () => { ready = false; },
    isReady: () => ready,
  };
};

const initializeDatabase = async (db, { alter = false, logger = console } = {}) => {
  await db.sequelize.authenticate();

  const modelNames = Object.keys(db).filter((name) => name !== 'sequelize' && name !== 'Sequelize');
  const failures = [];
  for (const name of modelNames) {
    try {
      const model = db[name];
      await model.sync({ alter });

      // sync({ alter:false }) creates missing tables but does not add or verify
      // columns on existing ones. Compare the model attributes with the live table
      // so an unapplied migration cannot produce a false-ready deployment.
      const actualColumns = await model.describe();
      const expectedColumns = Object.entries(model.rawAttributes || {})
        .filter(([, attribute]) => attribute?.type?.key !== 'VIRTUAL')
        .map(([attributeName, attribute]) => attribute.field || attributeName);
      const missingColumns = expectedColumns.filter((column) => !actualColumns[column]);
      if (missingColumns.length) {
        throw new Error(`Missing required columns for ${name}: ${missingColumns.join(', ')}`);
      }
    } catch (error) {
      failures.push({ name, error });
      logger.error(`Failed to synchronize critical model ${name}:`, error);
    }
  }

  if (failures.length) {
    const error = new Error(`Critical model synchronization failed: ${failures.map(({ name }) => name).join(', ')}`);
    error.failedModels = failures.map(({ name }) => name);
    throw error;
  }

  return modelNames;
};

const createGracefulShutdown = ({
  getServer,
  sequelize,
  cleanupTasks = [],
  timeoutMs = 8000,
  logger = console,
  exit = (code) => process.exit(code),
} = {}) => {
  let shutdownPromise = null;

  return (signal = 'shutdown') => {
    if (shutdownPromise) return shutdownPromise;

    shutdownPromise = (async () => {
      logger.log(`[shutdown] ${signal} received; stopping new requests.`);
      const server = getServer?.();

      const gracefulWork = (async () => {
        if (server?.close) {
          await new Promise((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          });
        }
        for (const task of cleanupTasks) {
          try { task?.stop?.(); } catch (error) { logger.error('[shutdown] Cleanup task failed:', error); }
        }
        await sequelize?.close?.();
      })();

      let timer;
      const timeout = new Promise((resolve) => {
        timer = setTimeout(() => resolve('timeout'), timeoutMs);
        timer.unref?.();
      });

      let outcome;
      try {
        outcome = await Promise.race([gracefulWork.then(() => 'closed'), timeout]);
      } catch (error) {
        logger.error('[shutdown] Graceful shutdown failed:', error);
        outcome = 'failed';
      } finally {
        clearTimeout(timer);
      }

      if (outcome !== 'closed') {
        logger.error(`[shutdown] ${outcome === 'timeout' ? 'Timed out' : 'Failed'} before all resources closed.`);
        try { server?.closeAllConnections?.(); } catch { /* best effort */ }
        exit(1);
        return 1;
      }

      logger.log('[shutdown] HTTP server and database connections closed.');
      exit(0);
      return 0;
    })();

    return shutdownPromise;
  };
};

module.exports = { createReadinessState, initializeDatabase, createGracefulShutdown };
