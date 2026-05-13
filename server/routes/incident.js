const express = require('express');
const router = express.Router();
const { IncidentLog } = require('../models');
const { Op } = require("sequelize");
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');
require('dotenv').config();

// Memory storage for incoming CCTV frames
const upload = multer({ storage: multer.memoryStorage() });

// -------------------------------------------------------------
// AI INTEGRATION ROUTE: Scan frame and save to DB automatically
// -------------------------------------------------------------
router.post("/scan-frame", upload.single('file'), async (req, res) => {
    const cameraLocation = req.body.camera_location || "Unknown Sector";

    if (!req.file) {
        return res.status(400).json({ error: "No image frame provided" });
    }

    try {
        // 1. Package the frame for Python
        const formData = new FormData();
        formData.append('file', req.file.buffer, req.file.originalname);

        // 2. Request AI analysis
        const aiResponse = await axios.post(process.env.PYTHON_AI_URL, formData, {
            headers: formData.getHeaders()
        });

        const faces = aiResponse.data.faces;
        const savedLogs = [];

        // 3. Save AI results into PostgreSQL via Sequelize
        for (let face of faces) {
            let newLog = await IncidentLog.create({
                camera_location: cameraLocation,
                status: face.status,
                person_name: face.name,
                confidence_score: face.confidence
            });
            savedLogs.push(newLog);

            if (face.status === "UNAUTHORIZED_ACCESS") {
                console.log(`🚨 ALERT: Unauthorized access (${face.name}) at ${cameraLocation}!`);
            } else {
                console.log(`✅ LOGGED: ${face.name} authorized at ${cameraLocation}.`);
            }
        }

        res.json({ success: true, ai_detections: faces, db_logs: savedLogs });

    } catch (err) {
        console.error("AI Communication Error:", err.message);
        res.status(500).json({ error: "Failed to process frame with AI Service" });
    }
});

// -------------------------------------------------------------
// STANDARD CRUD: Get all logs for React Dashboard
// -------------------------------------------------------------
router.get("/", async (req, res) => {
    let condition = {};
    let search = req.query.search;
    
    // Allow React frontend to search by name or location
    if (search) {
        condition[Op.or] = [
            { person_name: { [Op.like]: `%${search}%` } },
            { camera_location: { [Op.like]: `%${search}%` } },
            { status: { [Op.like]: `%${search}%` } }
        ];
    }
    
    let list = await IncidentLog.findAll({
        where: condition,
        order: [['createdAt', 'DESC']]
    });
    res.json(list);
});

// Get specific log
router.get("/:id", async (req, res) => {
    let id = req.params.id;
    let log = await IncidentLog.findByPk(id);
    if (!log) {
        res.sendStatus(404);
        return;
    }
    res.json(log);
});

// Delete a log (e.g., clearing false alarms)
router.delete("/:id", async (req, res) => {
    let id = req.params.id;
    let log = await IncidentLog.findByPk(id);
    if (!log) {
        res.sendStatus(404);
        return;
    }
    await log.destroy();
    res.sendStatus(200);
});

module.exports = router;