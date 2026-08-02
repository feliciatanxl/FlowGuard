const express = require('express');
const request = require('supertest');
const { createHealthRouter } = require('../routes/health');
const { healthPolicy } = require('../middlewares/rateLimit');
const {
  createReadinessState,
  initializeDatabase,
  createGracefulShutdown,
} = require('../services/serverLifecycle');

describe('backend liveness and readiness', () => {
  const buildApp = ({ sequelize, readiness, logger = console }) => {
    const app = express();
    app.set('trust proxy', 1);
    app.use('/health', createHealthRouter({ sequelize, readiness, logger }));
    return app;
  };

  test('liveness is safe and does not depend on the database', async () => {
    const readiness = createReadinessState();
    const res = await request(buildApp({ sequelize: {}, readiness })).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'live' });
  });

  test('readiness is 503 until critical initialization succeeds', async () => {
    const readiness = createReadinessState();
    const authenticate = jest.fn();
    const res = await request(buildApp({ sequelize: { authenticate }, readiness })).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'not_ready', database: false });
    expect(authenticate).not.toHaveBeenCalled();
  });

  test('readiness succeeds only after state and live DB checks pass', async () => {
    const readiness = createReadinessState();
    readiness.markReady();
    const authenticate = jest.fn().mockResolvedValue();
    const res = await request(buildApp({ sequelize: { authenticate }, readiness })).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready', database: true });
    expect(authenticate).toHaveBeenCalledTimes(1);
  });

  test('database readiness failures are logged without leaking details', async () => {
    const readiness = createReadinessState();
    readiness.markReady();
    const dbError = new Error('password for staging-secret-host was rejected');
    const logger = { error: jest.fn() };
    const res = await request(buildApp({
      sequelize: { authenticate: jest.fn().mockRejectedValue(dbError) },
      readiness,
      logger,
    })).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'not_ready', database: false });
    expect(JSON.stringify(res.body)).not.toMatch(/password|staging-secret-host/i);
    expect(logger.error).toHaveBeenCalledWith('Readiness database check failed:', dbError);
  });

  test('normal probes have generous headroom, then receive a stable 429 when abusive', async () => {
    const readiness = createReadinessState();
    readiness.markReady();
    const authenticate = jest.fn().mockResolvedValue();
    const app = buildApp({ sequelize: { authenticate }, readiness });
    const probeIp = '203.0.113.77';

    // Both public endpoints deliberately share the dedicated health bucket. The
    // default 120/min allows ordinary Cloud Run polling with substantial headroom.
    for (let index = 0; index < healthPolicy.max; index += 1) {
      const endpoint = index % 2 === 0 ? '/health/live' : '/health/ready';
      const res = await request(app).get(endpoint).set('X-Forwarded-For', probeIp);
      expect(res.status).toBe(200);
    }

    const blocked = await request(app).get('/health/ready').set('X-Forwarded-For', probeIp);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ message: 'Too many requests. Please try again later.' });
    expect(JSON.stringify(blocked.body)).not.toMatch(/database|schema|secret|password|203\.0\.113\.77/i);
    expect(blocked.headers['retry-after']).toBeDefined();
  });
});

describe('critical database initialization', () => {
  const model = (columns = { id: {} }) => ({
    sync: jest.fn().mockResolvedValue(),
    describe: jest.fn().mockResolvedValue(columns),
    rawAttributes: { id: { field: 'id', type: { key: 'INTEGER' } } },
  });

  test('authenticates, syncs without alter, and verifies live columns', async () => {
    const User = model();
    const db = { sequelize: { authenticate: jest.fn().mockResolvedValue() }, Sequelize: {}, User };
    await expect(initializeDatabase(db, { alter: false })).resolves.toEqual(['User']);
    expect(db.sequelize.authenticate).toHaveBeenCalledTimes(1);
    expect(User.sync).toHaveBeenCalledWith({ alter: false });
    expect(User.describe).toHaveBeenCalledTimes(1);
  });

  test('throws when a model sync or required-column check fails', async () => {
    const logger = { error: jest.fn() };
    const User = model({});
    const db = { sequelize: { authenticate: jest.fn().mockResolvedValue() }, Sequelize: {}, User };
    await expect(initializeDatabase(db, { alter: false, logger })).rejects.toMatchObject({
      failedModels: ['User'],
    });
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to synchronize critical model User:',
      expect.objectContaining({ message: expect.stringMatching(/Missing required columns/) })
    );
  });
});

describe('graceful shutdown', () => {
  test('is idempotent and closes HTTP, cleanup tasks, and Sequelize once', async () => {
    const server = { close: jest.fn((callback) => callback()) };
    const cleanupTask = { stop: jest.fn() };
    const sequelize = { close: jest.fn().mockResolvedValue() };
    const exit = jest.fn();
    const logger = { log: jest.fn(), error: jest.fn() };
    const shutdown = createGracefulShutdown({
      getServer: () => server,
      sequelize,
      cleanupTasks: [cleanupTask],
      exit,
      logger,
      timeoutMs: 100,
    });

    const first = shutdown('SIGTERM');
    const second = shutdown('SIGINT');
    expect(second).toBe(first);
    await expect(first).resolves.toBe(0);
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(cleanupTask.stop).toHaveBeenCalledTimes(1);
    expect(sequelize.close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  test('uses a bounded timeout and forces remaining connections closed', async () => {
    const server = {
      close: jest.fn(),
      closeAllConnections: jest.fn(),
    };
    const exit = jest.fn();
    const shutdown = createGracefulShutdown({
      getServer: () => server,
      sequelize: { close: jest.fn() },
      exit,
      logger: { log: jest.fn(), error: jest.fn() },
      timeoutMs: 5,
    });

    await expect(shutdown('SIGTERM')).resolves.toBe(1);
    expect(server.closeAllConnections).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });
});
