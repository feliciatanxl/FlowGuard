const express = require('express');
const router = express.Router();
const { MonitoringZone } = require('../models');

router.get('/', async (req, res) => {
    try {
        const zones = await MonitoringZone.findAll({ order: [['createdAt', 'DESC']] });
        res.json(zones);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const { zone_name, location, time_threshold } = req.body;
        if (!zone_name || !location || time_threshold === undefined) {
            return res.status(400).json({ error: 'zone_name, location, and time_threshold are required.' });
        }
        const zone = await MonitoringZone.create({
            zone_name,
            location,
            time_threshold: parseInt(time_threshold)
        });
        res.status(201).json(zone);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/:id', async (req, res) => {
    try {
        const zone = await MonitoringZone.findByPk(req.params.id);
        if (!zone) return res.sendStatus(404);
        const { zone_name, location, time_threshold } = req.body;
        await zone.update({
            ...(zone_name !== undefined && { zone_name }),
            ...(location !== undefined && { location }),
            ...(time_threshold !== undefined && { time_threshold: parseInt(time_threshold) })
        });
        res.json(zone);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const zone = await MonitoringZone.findByPk(req.params.id);
        if (!zone) return res.sendStatus(404);
        await zone.destroy();
        res.sendStatus(200);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
