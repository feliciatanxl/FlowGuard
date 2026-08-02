const express = require('express');

const createHealthRouter = ({ sequelize, readiness, logger = console }) => {
  const router = express.Router();

  router.get('/live', (req, res) => res.json({ status: 'live' }));

  router.get('/ready', async (req, res) => {
    if (!readiness?.isReady?.()) {
      return res.status(503).json({ status: 'not_ready', database: false });
    }
    try {
      await sequelize.authenticate();
      return res.json({ status: 'ready', database: true });
    } catch (error) {
      logger.error('Readiness database check failed:', error);
      return res.status(503).json({ status: 'not_ready', database: false });
    }
  });

  return router;
};

module.exports = { createHealthRouter };
