const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');

// 🎯 FIX: Destructure BOTH sequelize (for raw queries) and SecurityLog from the auto-loader
const { sequelize, SecurityLog } = require('../models');

// 1. POST Route: Catch the log from React and save it to PostgreSQL
router.post('/logs', async (req, res) => {
  try {
    const { time, type, desc, severity, icon, personnelName } = req.body;

    const newLog = await SecurityLog.create({
      id: randomUUID(),   // server-generated UUID — no more duplicate key collisions
      time,
      type,
      desc,
      severity,
      icon,
      personnelName
    });

    res.status(201).json({ message: "Log secured in database", log: newLog });
  } catch (error) {
    console.error("Failed to save security log:", error);
    res.status(500).json({ error: "Internal server error while saving log." });
  }
});

// 2. GET Route: Fetch logs for a specific person by Name
// Called via: GET /api/security/logs/personnel/Worker%20Bee
router.get('/logs/personnel/:name', async (req, res) => {
  try {
    const logs = await SecurityLog.findAll({
      where: { personnelName: req.params.name }, 
      order: [['createdAt', 'DESC']]
    });
    
    res.status(200).json(logs);
  } catch (error) {
    console.error("Failed to fetch personnel logs:", error);
    res.status(500).json({ error: "Could not retrieve personnel timeline." });
  }
});

// 3. GET Route: Fetch logs by User ID instead of name (For UserLogs.jsx)
// URL: GET /api/security/logs/user/8
router.get('/logs/user/:id', async (req, res) => {
  try {
    // 🎯 RAW SQL BRIDGE: Hits the 'users' table directly to find the name without model mismatch bugs
    const users = await sequelize.query(
      'SELECT name FROM users WHERE id = ?',
      {
        replacements: [req.params.id],
        type: sequelize.QueryTypes.SELECT
      }
    );

    if (!users || users.length === 0) {
      return res.status(404).json({ error: "Personnel member not found." });
    }

    const userName = users[0].name;

    // 2. Look up all security logs matching this person's extracted name strings
    const logs = await SecurityLog.findAll({
      where: { personnelName: userName },
      order: [['createdAt', 'DESC']] 
    });

    res.status(200).json({
      personnelName: userName,
      logs: logs
    });
  } catch (error) {
    console.error("Failed to fetch personnel logs by ID:", error);
    res.status(500).json({ error: "Could not retrieve activity logs." });
  }
});

// 4. GET Route: Fetch the last 15 logs when the main dashboard loads
router.get('/logs', async (req, res) => {
  try {
    const logs = await SecurityLog.findAll({
      order: [['createdAt', 'DESC']], 
      limit: 15 
    });
    
    res.status(200).json(logs);
  } catch (error) {
    console.error("Failed to fetch logs:", error);
    res.status(500).json({ error: "Could not retrieve security timeline." });
  }
});

module.exports = router;