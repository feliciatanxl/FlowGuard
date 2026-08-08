const express = require('express');
const router = express.Router();
const fs = require('fs');
const { sendUnexpectedError } = require('../utils/safeHttpError');
const { readLimiter } = require('../middlewares/rateLimit');
router.use(readLimiter); // route-wide rate limiting (trusted AI service POSTs are skipped)
const { DetectionAlert, IncidentLog, MonitoringZone, Camera, sequelize } = require('../models');
const { resolveIncidentType } = require('../utils/detectionAlertBridge');
const whatsapp = require('../services/whatsappService');
function severityFromDuration(seconds) {
  if (!seconds || seconds < 120) return 'Low';
  if (seconds < 300) return 'Medium';
  if (seconds < 600) return 'High';
  return 'Critical';
}
function defaultSeverityForType(alertType, durationSeconds, identityStatus, personName) {
  const key = String(alertType || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  const upperStatus = String(identityStatus || '').trim().toUpperCase();
  const upperPerson = String(personName || '').trim().toUpperCase();
  switch (key) {
    case 'PEST_DETECTION':
      return 'High';
    case 'RESTRICTED_MOTION':
    case 'RESTRICTED_ZONE_MOTION':
      if (upperStatus === 'SUSPICIOUS' || upperStatus === 'SUSPENDED' || upperPerson === 'UNKNOWN PERSON' || upperPerson === 'UNKNOWN') {
        return 'Critical';
      }
      return 'High';
    case 'FORGOTTEN_BELONGING':
      return (durationSeconds && durationSeconds >= 300) ? 'High' : 'Medium';
    case 'ITEM_PICKED_UP':
    case 'ITEM_SET_DOWN':
    case 'ITEM_MOVEMENT':
      return 'Medium';
    case 'UNATTENDED_OBJECT':
    default:
      return severityFromDuration(durationSeconds);
  }
}
const { Op } = require('sequelize');
const { createDetectionAlertRetentionTask } = require('../services/detectionAlertRetention');
const { verifyToken, requireRole, verifyServiceOrRole } = require('../middlewares/auth');
const {
    GENERATED_SNAPSHOT_RE,
    resolveStoredSnapshotPath,
    readSnapshotBuffer,
} = require('../utils/detectionSnapshotStorage');
const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'];
const VALID_STATUSES = ['Active', 'Acknowledged', 'Investigating', 'Dispatched', 'Escalated', 'Cleared'];

// This route is reachable by the AI engine's service key AND by an FM/Staff JWT — never
// by the SecurePi edge device (that's the dedicated EDGE_INGEST_TOKEN route in
// edgeDetectionAlerts.js). Whitelisting here stops either caller from setting
// source: 'SecurePi Edge Node' and having an alert masquerade as edge-ingested.
const ALLOWED_ALERT_SOURCES = ['Browser Webcam', 'Uploaded Video', 'Object Detection'];
const DEFAULT_ALERT_SOURCE = 'Object Detection';

function resolveAlertSource(rawSource, maxLength) {
    const cleaned = cleanText(rawSource, maxLength);
    return (cleaned && ALLOWED_ALERT_SOURCES.includes(cleaned)) ? cleaned : DEFAULT_ALERT_SOURCE;
}

// Maps a DetectionAlert workflow status onto the IncidentLog resolutionStatus values the
// Incident Dashboard already understands (Active / Investigating / Escalated to Security / Cleared).
const STATUS_TO_RESOLUTION = {
    Active: 'Active',
    Acknowledged: 'Active',
    Investigating: 'Investigating',
    Dispatched: 'Investigating',
    Escalated: 'Escalated to Security',
    Cleared: 'Cleared'
};

// Runs fn inside a managed transaction when the connection is available; unit tests that
// mock ../models without a sequelize instance fall back to running fn untransacted.
const withTransaction = (fn) => {
    if (sequelize && typeof sequelize.transaction === 'function') {
        return sequelize.transaction(fn);
    }
    return fn(null);
};

const cleanText = (value, maxLength) => {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    if (!text) return null;
    return text.slice(0, maxLength);
};

const parsePositiveInt = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const parseConfidence = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(0, Math.min(1, parsed));
};

const parseOccurredAt = (value) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

router.get('/', verifyToken, requireRole('FM', 'Staff'), async (req, res) => {
    try {
        const where = {};
        if (req.query.status) where.status = req.query.status;
        const orderClause = (sequelize && typeof sequelize.fn === 'function')
            ? [
                [sequelize.fn('COALESCE', sequelize.col('occurred_at'), sequelize.col('createdAt')), 'DESC'],
                ['createdAt', 'DESC']
              ]
            : [['createdAt', 'DESC']];

        const alerts = await DetectionAlert.findAll({
            where,
            order: orderClause,
            limit: 50
        });
        res.json(alerts);
    } catch (err) {
        return sendUnexpectedError(res, 'Detection alert list failed:', err);
    }
});

router.get('/:id', verifyToken, requireRole('FM', 'Staff'), async (req, res) => {
    try {
        // Non-numeric ids would make Postgres throw on an integer PK lookup — treat as not found.
        if (!/^\d+$/.test(req.params.id)) return res.sendStatus(404);
        const alert = await DetectionAlert.findByPk(req.params.id);
        if (!alert) return res.sendStatus(404);
        res.json(alert);
    } catch (err) {
        return sendUnexpectedError(res, 'Detection alert lookup failed:', err);
    }
});

router.get('/:id/snapshot/:filename', verifyToken, requireRole('FM', 'Staff'), async (req, res) => {
    try {
        if (!/^\d+$/.test(req.params.id)) return res.sendStatus(404);
        const requestedFilename = String(req.params.filename || '');
        if (!GENERATED_SNAPSHOT_RE.test(requestedFilename)) return res.sendStatus(404);

        const alert = await DetectionAlert.findByPk(req.params.id);
        const expectedPrefix = `/api/detection-alerts/${req.params.id}/snapshot/`;
        if (!alert || typeof alert.snapshot_url !== 'string' || !alert.snapshot_url.startsWith(expectedPrefix)) {
            return res.sendStatus(404);
        }

        // The snapshot filename is recovered from the server-generated URL stored
        // in the database, then independently UUID-validated.
        // req.params.filename is used only to authorize that exact stored resource.
        const storedFilename = alert.snapshot_url.slice(expectedPrefix.length);
        if (storedFilename !== requestedFilename) return res.sendStatus(404);

        const snapshotBytes = await readSnapshotBuffer(storedFilename);
        if (!snapshotBytes) return res.sendStatus(404);

        return res.type('jpg').send(snapshotBytes);
    } catch (err) {
        return sendUnexpectedError(res, 'Detection alert snapshot lookup failed:', err);
    }
});

// Resolves best-effort zone_id/camera_id from the free-text zone_name/camera_location the
// AI engine (or a manual caller) sends — additive enrichment, never blocks alert creation.
// Also surfaces the zone's Detection Setup detection_type (a separate `detectionType`
// key, NOT spread into DetectionAlert.create — that model has no such column) so the
// incident-type bridge below can use it without a second DB round trip.
async function resolveLinks(zone_name, camera_location) {
    const links = {};
    let detectionType = null;
    try {
        if (zone_name) {
            const zone = await MonitoringZone.findOne({ where: { zone_name } });
            if (zone) {
                links.zone_id = zone.id;
                detectionType = zone.detection_type || null;
            }
        }
        if (camera_location) {
            const camera = await Camera.findOne({
                where: {
                    [Op.or]: [{ camera_name: camera_location }, { location: camera_location }]
                }
            });
            if (camera) links.camera_id = camera.id;
        }
    } catch {
        // Enrichment is best-effort only — never fail alert creation because of it.
    }
    return { links, detectionType };
}

// AI engine posts here server-to-server via a shared service key; FM/Staff may also
// create a manual test alert using their own JWT.
router.post('/', verifyServiceOrRole('FM', 'Staff'), async (req, res) => {
    try {
        const {
            event_id,
            cycle_id,
            zone_name,
            camera_location,
            status,
            object_class,
            duration_seconds,
            person_name,
            identity_status,
            person_role,
            alert_type,
            severity,
            source,
            confidence,
            snapshot_url,
            snapshot_path,
            device_id,
            track_id,
            sensor_metadata,
            timestamp,
            occurred_at
        } = req.body;
        if (!zone_name || !camera_location) {
            return res.status(400).json({ error: 'zone_name and camera_location are required.' });
        }
        if (status && !VALID_STATUSES.includes(status)) {
            return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}.` });
        }
        if (severity && !SEVERITIES.includes(severity)) {
            return res.status(400).json({ error: `severity must be one of: ${SEVERITIES.join(', ')}.` });
        }

        const eventId = cleanText(event_id || cycle_id || sensor_metadata?.cycle_id || sensor_metadata?.inspection_cycle_id, 255);
        if (eventId && typeof DetectionAlert.findOne === 'function') {
            try {
                const existing = await DetectionAlert.findOne({ where: { edge_event_id: eventId } });
                if (existing) {
                    return res.status(200).json(existing);
                }
            } catch {
                // Best effort idempotency lookup
            }
        }

        const cleanedIdentityStatus = cleanText(identity_status, 50);
        const cleanedPersonRole = cleanText(person_role, 100);
        const cleanedPerson = cleanText(person_name, 255);
        const parsedTrackId = parsePositiveInt(track_id);
        const baseSensorMeta = (sensor_metadata && typeof sensor_metadata === 'object') ? { ...sensor_metadata } : {};
        if (cleanedIdentityStatus && !baseSensorMeta.identity_status) baseSensorMeta.identity_status = cleanedIdentityStatus;
        if (cleanedPersonRole && !baseSensorMeta.person_role) baseSensorMeta.person_role = cleanedPersonRole;
        if (parsedTrackId !== null && baseSensorMeta.track_id === undefined) baseSensorMeta.track_id = parsedTrackId;
        if (cleanedPerson && !baseSensorMeta.person_name) baseSensorMeta.person_name = cleanedPerson;
        if (eventId && !baseSensorMeta.cycle_id) baseSensorMeta.cycle_id = eventId;
        const safeSensorMeta = Object.keys(baseSensorMeta).length > 0 ? baseSensorMeta : null;

        const { links, detectionType } = await resolveLinks(zone_name, camera_location);
        const cleanedAlertType = cleanText(alert_type, 100) || 'Unattended Object';
        const cleanedObjectClass = cleanText(object_class, 100) || 'package-like object';
        const resolvedSeverity = severity || defaultSeverityForType(cleanedAlertType, parsePositiveInt(duration_seconds), cleanedIdentityStatus, cleanedPerson);
        const resolvedSource = resolveAlertSource(source, 100);
        const incidentType = resolveIncidentType({
            alert_type: cleanedAlertType,
            object_class: cleanedObjectClass,
            detection_type: detectionType
        });

        // Alert + linked incident are created atomically: if either fails, neither persists.
        const alert = await withTransaction(async (t) => {
            const created = await DetectionAlert.create({
                zone_name: cleanText(zone_name, 255),
                camera_location: cleanText(camera_location, 255),
                status: status || 'Active',
                object_class: cleanedObjectClass,
                duration_seconds: parsePositiveInt(duration_seconds),
                person_name: cleanedPerson,
                alert_type: cleanedAlertType,
                severity: resolvedSeverity,
                source: resolvedSource,
                confidence: parseConfidence(confidence),
                snapshot_url: cleanText(snapshot_url || snapshot_path, 500),
                device_id: cleanText(device_id, 100),
                sensor_metadata: safeSensorMeta,
                edge_event_id: eventId,
                occurred_at: parseOccurredAt(timestamp || occurred_at),
                ...links
            }, { transaction: t });

            const incident = await IncidentLog.create({
                camera_location: cleanText(camera_location, 255),
                status: incidentType,
                source: resolvedSource,
                severity: resolvedSeverity,
                person_name: (cleanedPerson && cleanedPerson !== 'UNKNOWN') ? cleanedPerson : null,
                confidence_score: null,
                resolutionStatus: 'Active',
                notes: zone_name ? `[Object Detection] Zone: ${zone_name}` : ''
            }, { transaction: t });

            await created.update({ incident_log_id: incident.id }, { transaction: t });
            return created;
        });

        if (process.env.WHATSAPP_DETECTION_ALERTS_ENABLED === 'true') {
            try {
                const recipients = whatsapp.resolveDetectionRecipients();
                if (recipients.length === 0) {
                    console.log('[WhatsApp][Detection] no security recipients configured');
                    if (typeof alert.update === 'function') {
                        await alert.update({ whatsapp_status: 'Skipped', whatsapp_error: 'No security recipients configured' }).catch(() => {});
                    }
                } else if (!whatsapp.meetsMinSeverity(resolvedSeverity, process.env.WHATSAPP_DETECTION_MIN_SEVERITY || 'Low')) {
                    console.log('[WhatsApp][Detection] below minimum severity');
                    if (typeof alert.update === 'function') {
                        await alert.update({ whatsapp_status: 'Skipped', whatsapp_error: 'Below minimum severity threshold' }).catch(() => {});
                    }
                } else {
                    const messageAlert = {
                        alert_type: cleanedAlertType,
                        object_class: cleanedObjectClass,
                        severity: resolvedSeverity,
                        zone_name: cleanText(zone_name, 255),
                        camera_location: cleanText(camera_location, 255),
                        duration_seconds: parsePositiveInt(duration_seconds),
                        occurred_at: parseOccurredAt(timestamp || occurred_at),
                        timestamp: parseOccurredAt(timestamp || occurred_at),
                        confidence: parseConfidence(confidence),
                        device_id: cleanText(device_id, 100),
                        person_name: cleanedPerson,
                        identity_status: cleanedIdentityStatus,
                        person_role: cleanedPersonRole,
                        track_id: parsedTrackId,
                        sensor_metadata: safeSensorMeta,
                        snapshot_url: cleanText(snapshot_url || snapshot_path, 500),
                    };
                    const waResult = await whatsapp.sendDetectionAlert(messageAlert);
                    const safeStatus = waResult?.status || 'Failed';
                    const safeError = waResult?.error ? String(waResult.error).slice(0, 500) : null;
                    if (typeof alert.update === 'function') {
                        await alert.update({
                            whatsapp_status: safeStatus,
                            whatsapp_sent_at: (safeStatus === 'Sent' || safeStatus === 'Simulated') ? new Date() : null,
                            whatsapp_error: safeError
                        }).catch(() => {});
                    }
                    if (safeStatus === 'Simulated') {
                        console.log('[WhatsApp][Detection] simulated');
                    } else if (safeStatus === 'Sent') {
                        console.log('[WhatsApp][Detection] sent');
                    } else if (safeStatus === 'Skipped') {
                        console.log(`[WhatsApp][Detection] skipped${safeError ? `: ${safeError}` : ''}`);
                    } else {
                        console.log(`[WhatsApp][Detection] failed: ${safeError || 'Delivery failed'}`);
                    }
                }
            } catch (waErr) {
                console.error(`[WhatsApp][Detection] failed: ${waErr.message}`);
                if (typeof alert.update === 'function') {
                    await alert.update({ whatsapp_status: 'Failed', whatsapp_error: waErr.message }).catch(() => {});
                }
            }
        } else {
            console.log('[WhatsApp][Detection] disabled by detection-alert switch');
            if (typeof alert.update === 'function') {
                await alert.update({ whatsapp_status: 'Not Requested' }).catch(() => {});
            }
        }

        res.status(201).json(alert);
    } catch (err) {
        return sendUnexpectedError(res, 'Detection alert creation failed:', err);
    }
});

const UPDATABLE_FIELDS = ['status', 'severity', 'person_name'];

// Finds the incident linked to an alert; returns null (never throws) when the alert
// predates incident linking or the incident has since been removed.
async function findLinkedIncident(alert, t) {
    if (!alert.incident_log_id) return null;
    if (!IncidentLog || typeof IncidentLog.findByPk !== 'function') return null;
    try {
        return await IncidentLog.findByPk(alert.incident_log_id, t ? { transaction: t } : undefined);
    } catch {
        return null;
    }
}

router.put('/:id', verifyToken, requireRole('FM', 'Staff'), async (req, res) => {
    try {
        if (!/^\d+$/.test(req.params.id)) return res.sendStatus(404);
        const alert = await DetectionAlert.findByPk(req.params.id);
        if (!alert) return res.sendStatus(404);

        const unsupported = Object.keys(req.body).filter((key) => !UPDATABLE_FIELDS.includes(key));
        if (unsupported.length > 0) {
            return res.status(400).json({ error: `Unsupported field(s): ${unsupported.join(', ')}. Updatable fields are: ${UPDATABLE_FIELDS.join(', ')}.` });
        }
        const { status, severity, person_name } = req.body;
        if (status && !VALID_STATUSES.includes(status)) {
            return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}.` });
        }
        if (severity && !SEVERITIES.includes(severity)) {
            return res.status(400).json({ error: `severity must be one of: ${SEVERITIES.join(', ')}.` });
        }

        await withTransaction(async (t) => {
            const opts = t ? { transaction: t } : undefined;
            await alert.update({
                ...(status !== undefined && { status }),
                ...(severity !== undefined && { severity }),
                ...(person_name !== undefined && { person_name: cleanText(person_name, 255) })
            }, opts);

            // Mirror the shared fields onto the linked incident so both dashboards agree.
            const incident = await findLinkedIncident(alert, t);
            if (incident) {
                await incident.update({
                    ...(status !== undefined && { resolutionStatus: STATUS_TO_RESOLUTION[status] || incident.resolutionStatus }),
                    ...(severity !== undefined && { severity }),
                    ...(person_name !== undefined && { person_name: cleanText(person_name, 255) })
                }, opts);
            }
        });

        res.json(alert);
    } catch (err) {
        return sendUnexpectedError(res, 'Detection alert update failed:', err);
    }
});

router.delete('/:id', verifyToken, requireRole('FM'), async (req, res) => {
    try {
        if (!/^\d+$/.test(req.params.id)) return res.sendStatus(404);
        const alert = await DetectionAlert.findByPk(req.params.id);
        if (!alert) return res.sendStatus(404);

        // False-alarm removal: soft-delete the alert (paranoid model keeps the audit row)
        // and soft-delete the linked incident the same way the incident dashboard's own
        // delete endpoint does, so it stops showing as an active incident.
        await withTransaction(async (t) => {
            const opts = t ? { transaction: t } : undefined;
            const incident = await findLinkedIncident(alert, t);
            if (incident) await incident.destroy(opts);
            await alert.destroy(opts);
        });

        res.sendStatus(200);
    } catch (err) {
        return sendUnexpectedError(res, 'Detection alert deletion failed:', err);
    }
});

// Purge detection alerts older than 30 days — runs once daily
// Constructing the route must not start process handles. index.js starts this
// task only after database initialization succeeds and graceful shutdown stops it.
router.retentionTask = createDetectionAlertRetentionTask({ DetectionAlert, Op });

module.exports = router;
