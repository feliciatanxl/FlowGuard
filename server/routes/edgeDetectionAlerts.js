const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { aiProxyLimiter } = require('../middlewares/rateLimit');
router.use(aiProxyLimiter); // high-frequency edge ingest — generous per-client policy
const { DetectionAlert, IncidentLog, MonitoringZone, Camera, sequelize } = require('../models');
const { Op } = require('sequelize');
const { resolveIncidentType } = require('../utils/detectionAlertBridge');
const whatsapp = require('../services/whatsappService');
const { sendUnexpectedError } = require('../utils/safeHttpError');
const {
    ensureSnapshotDirectory,
    generateSnapshotDestination,
    generateSnapshotFilename,
    saveSnapshotBuffer,
    deleteSnapshotFile,
} = require('../utils/detectionSnapshotStorage');

const PUBLIC_NOTIFICATION_ERROR = 'Notification delivery failed.';

// Mirrors the fallback in detectionAlerts.js so edge and AI alerts get consistent severities
function severityFromDuration(seconds) {
    if (!seconds || seconds < 120) return 'Low';
    if (seconds < 300) return 'Medium';
    if (seconds < 600) return 'High';
    return 'Critical';
}

// Type-aware default severity, applied ONLY when the edge device did not send an
// explicit severity. Keeps unattended-object behaviour identical to before
// (duration-based) while giving the new alert families sensible floors:
//   Pest / Restricted-Zone Motion -> High (or Critical if suspicious/suspended/unknown)
//   Forgotten Belonging           -> Medium, escalating to High past 5 min
//   Item Picked Up / Set Down     -> Medium
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

// Runs fn inside a managed transaction when the connection is available; unit tests that
// mock ../models without a sequelize instance fall back to running fn untransacted.
const withTransaction = (fn) => {
    if (sequelize && typeof sequelize.transaction === 'function') {
        return sequelize.transaction(fn);
    }
    return fn(null);
};

const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'];
const VALID_STATUSES = ['Active', 'Acknowledged', 'Investigating', 'Dispatched', 'Escalated', 'Cleared'];
const configuredSnapshotMaxBytes = Number(process.env.DETECTION_SNAPSHOT_MAX_BYTES);
const SNAPSHOT_MAX_BYTES = Number.isFinite(configuredSnapshotMaxBytes) && configuredSnapshotMaxBytes > 0
    ? configuredSnapshotMaxBytes
    : 5 * 1024 * 1024;
const JPEG_MIME_TYPES = new Set(['image/jpeg', 'image/jpg']);

const validateSnapshotFilename = (originalName) => {
    const raw = String(originalName || '');
    const decodedNames = [raw];
    for (let depth = 0; depth < 3; depth += 1) {
        try {
            const decoded = decodeURIComponent(decodedNames[decodedNames.length - 1]);
            if (decoded === decodedNames[decodedNames.length - 1]) break;
            decodedNames.push(decoded);
        } catch {
            return 'snapshot filename is invalid.';
        }
    }

    // Multipart filenames are metadata only and never become storage paths. Reject
    // both literal and encoded path syntax anyway, before the bytes are accepted.
    if (!raw || decodedNames.some((name) => name.includes('\0') || /[/\\]/.test(name)
        || path.posix.isAbsolute(name) || path.win32.isAbsolute(name)
        || name === '.' || name === '..')) {
        return 'snapshot filename is invalid.';
    }
    if (!decodedNames.every((name) => /\.jpe?g$/i.test(name))) {
        return 'snapshot filename must use a .jpg or .jpeg extension.';
    }
    return null;
};

const isJpegBuffer = (buffer) => Buffer.isBuffer(buffer)
    && buffer.length >= 4
    && buffer[0] === 0xff
    && buffer[1] === 0xd8
    && buffer[buffer.length - 2] === 0xff
    && buffer[buffer.length - 1] === 0xd9;

const snapshotUpload = multer({
    storage: multer.memoryStorage(),
    preservePath: true,
    limits: { fileSize: SNAPSHOT_MAX_BYTES },
    fileFilter: (req, file, cb) => {
        if (!JPEG_MIME_TYPES.has(String(file.mimetype || '').toLowerCase())) {
            return cb(new Error('snapshot must be a JPEG image.'));
        }
        const filenameError = validateSnapshotFilename(file.originalname);
        if (filenameError) return cb(new Error(filenameError));
        return cb(null, true);
    }
});

const handleSnapshotUpload = (req, res, next) => {
    snapshotUpload.single('snapshot')(req, res, (err) => {
        if (err) {
            const safeMessages = new Set([
                'snapshot must be a JPEG image.',
                'snapshot filename is invalid.',
                'snapshot filename must use a .jpg or .jpeg extension.'
            ]);
            const error = err.code === 'LIMIT_FILE_SIZE'
                ? 'snapshot exceeds the configured maximum size.'
                : safeMessages.has(err.message)
                    ? err.message
                    : 'snapshot upload is invalid.';
            return res.status(400).json({ error });
        }
        if (req.file && !isJpegBuffer(req.file.buffer)) {
            return res.status(400).json({ error: 'snapshot content is not a valid JPEG image.' });
        }
        return next();
    });
};

// Stable edge event id: SecurePi sends the same value on Wi-Fi retries. Keep the
// charset tight (alnum plus the separators used by the deterministic id format
// "<device>:<type>:<track>:<timestamp>") so a malformed value is rejected early.
const EVENT_ID_RE = /^[A-Za-z0-9._:-]{1,255}$/;

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

const snapshotUrlFor = (alertId, filename) => `/api/detection-alerts/${alertId}/snapshot/${filename}`;

const persistUploadedSnapshot = async (alert, file) => {
    if (!file?.buffer || !alert?.id) return null;
    const filename = generateSnapshotFilename();
    const snapshotUrl = snapshotUrlFor(alert.id, filename);
    let saved = false;
    try {
        await saveSnapshotBuffer(filename, file.buffer);
        saved = true;
        if (typeof alert.update === 'function') {
            await alert.update({ snapshot_url: snapshotUrl });
        } else {
            alert.snapshot_url = snapshotUrl;
        }
    } catch (err) {
        if (saved) {
            await deleteSnapshotFile(filename).catch(() => {});
        }
        throw err;
    }
    return snapshotUrl;
};

const verifyEdgeIngestToken = (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!process.env.EDGE_INGEST_TOKEN) {
        return res.status(503).json({ error: 'Edge ingest is not configured.' });
    }
    if (!token || token !== process.env.EDGE_INGEST_TOKEN) {
        return res.status(401).json({ error: 'Invalid edge ingest token.' });
    }
    return next();
};

// Mirrors detectionAlerts.js's resolveLinks — also surfaces the zone's Detection Setup
// detection_type (separate `detectionType` key, not spread into DetectionAlert.create)
// so the incident-type bridge below matches the non-edge alert route.
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
        // Edge ingestion should still work even if enrichment cannot resolve links.
    }
    return { links, detectionType };
}

// A DetectionAlert instance is a Sequelize model in production but a plain object in
// unit tests. Serialize either into a plain response body and attach the WhatsApp
// result WITHOUT dropping any existing top-level field (id/zone_name/severity/...).
function serializeAlert(alert, whatsappResult) {
    const base = (alert && typeof alert.toJSON === 'function') ? alert.toJSON() : alert;
    return { ...base, whatsapp: whatsappResult };
}

// True for a Postgres unique-constraint violation, however Sequelize surfaces it.
function isUniqueViolation(err) {
    return err && (err.name === 'SequelizeUniqueConstraintError' || err.original?.code === '23505' || err.parent?.code === '23505');
}

// Look up an alert by its edge idempotency key. Guarded so a mocked model without
// findOne (older unit tests that never send event_id) is never called.
async function findByEdgeEventId(eventId) {
    if (!eventId || typeof DetectionAlert.findOne !== 'function') return null;
    try {
        return await DetectionAlert.findOne({ where: { edge_event_id: eventId } });
    } catch {
        return null;
    }
}

// Whether a security WhatsApp should be attempted for this alert right now.
function whatsappGate(resolvedSeverity) {
    const enabled = process.env.WHATSAPP_DETECTION_ALERTS_ENABLED === 'true';
    const minSeverity = process.env.WHATSAPP_DETECTION_MIN_SEVERITY || 'Low';
    const recipients = whatsapp.resolveDetectionRecipients();
    return {
        enabled,
        recipients,
        willSend: enabled && recipients.length > 0 && whatsapp.meetsMinSeverity(resolvedSeverity, minSeverity),
    };
}

// Persist a WhatsApp status change without ever letting a DB hiccup break the response.
async function safeUpdateWhatsapp(alert, fields) {
    try {
        if (alert && typeof alert.update === 'function') await alert.update(fields);
    } catch (e) {
        console.error('[Edge] Could not persist WhatsApp status:', e.message);
    }
}

// Send the security WhatsApp (post-commit) and persist the resulting status. Never
// throws — a WhatsApp failure must not fail an already-saved alert. Returns the
// public `whatsapp` result object for the HTTP response (no tokens, no phone numbers).
async function attemptSecurityWhatsapp(alert, messageAlert) {
    let result;
    try {
        result = await whatsapp.sendDetectionAlert(messageAlert);
    } catch (err) {
        console.error('[Edge] WhatsApp delivery failed:', err);
        await safeUpdateWhatsapp(alert, { whatsapp_status: 'Failed', whatsapp_error: String(err.message).slice(0, 500) });
        return { status: 'Failed', error: PUBLIC_NOTIFICATION_ERROR, recipientCount: 0 };
    }
    const sentAt = (result.status === 'Sent' || result.status === 'Simulated') ? new Date() : null;
    await safeUpdateWhatsapp(alert, {
        whatsapp_status: result.status,
        whatsapp_sent_at: sentAt,
        whatsapp_error: result.error ? String(result.error).slice(0, 500) : null,
    });
    return {
        status: result.status,
        recipientCount: result.recipientCount,
        error: result.error ? PUBLIC_NOTIFICATION_ERROR : null,
        sent_at: sentAt
    };
}

router.post('/detection-alerts', verifyEdgeIngestToken, handleSnapshotUpload, async (req, res) => {
    try {
        const {
            event_id,
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
            confidence,
            snapshot_path,
            device_id,
            track_id,
            sensor_metadata,
            timestamp,
            occurred_at
        } = req.body;
        // This route is only reachable with a valid EDGE_INGEST_TOKEN, so the source is
        // always the authenticated SecurePi edge device — any client-supplied `source`
        // field in req.body is ignored rather than trusted.
        const EDGE_SOURCE = 'SecurePi Edge Node';

        const cleanedZone = cleanText(zone_name, 255);
        const cleanedCamera = cleanText(camera_location, 255);
        if (!cleanedZone || !cleanedCamera) {
            return res.status(400).json({ error: 'zone_name and camera_location are required.' });
        }
        if (status && !VALID_STATUSES.includes(status)) {
            return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}.` });
        }
        if (severity && !SEVERITIES.includes(severity)) {
            return res.status(400).json({ error: `severity must be one of: ${SEVERITIES.join(', ')}.` });
        }
        // event_id is optional (browser/AI alerts never send one) but, when present,
        // must be well-formed — it becomes the unique idempotency key.
        let eventId = null;
        if (event_id !== undefined && event_id !== null && event_id !== '') {
            if (!EVENT_ID_RE.test(String(event_id))) {
                return res.status(400).json({ error: 'event_id is malformed.' });
            }
            eventId = String(event_id);
        }

        const parsedDuration = parsePositiveInt(duration_seconds);
        const parsedConfidence = parseConfidence(confidence);
        const parsedOccurredAt = parseOccurredAt(timestamp || occurred_at);
        const cleanedAlertType = cleanText(alert_type, 100) || 'Unattended Object';
        const cleanedObjectClass = cleanText(object_class, 100) || 'package-like object';
        const cleanedDevice = cleanText(device_id, 100);
        const cleanedPerson = cleanText(person_name, 255);
        const cleanedIdentityStatus = cleanText(identity_status, 50);
        const cleanedPersonRole = cleanText(person_role, 100);
        const parsedTrackId = parsePositiveInt(track_id);

        const resolvedSeverity = severity || defaultSeverityForType(cleanedAlertType, parsedDuration, cleanedIdentityStatus, cleanedPerson);

        // Build safeSensorMeta, ensuring identity fields and track_id ride inside sensor_metadata JSONB column if provided.
        const baseSensorMeta = (sensor_metadata && typeof sensor_metadata === 'object') ? { ...sensor_metadata } : {};
        if (cleanedIdentityStatus && !baseSensorMeta.identity_status) baseSensorMeta.identity_status = cleanedIdentityStatus;
        if (cleanedPersonRole && !baseSensorMeta.person_role) baseSensorMeta.person_role = cleanedPersonRole;
        if (parsedTrackId !== null && baseSensorMeta.track_id === undefined) baseSensorMeta.track_id = parsedTrackId;
        if (cleanedPerson && !baseSensorMeta.person_name) baseSensorMeta.person_name = cleanedPerson;
        const safeSensorMeta = Object.keys(baseSensorMeta).length > 0 ? baseSensorMeta : null;

        // The normalized object the pure message builder consumes. Snapshot url and local
        // path are passed SEPARATELY so a local edge path is never rendered as a link.
        const messageAlert = {
            alert_type: cleanedAlertType,
            object_class: cleanedObjectClass,
            severity: resolvedSeverity,
            zone_name: cleanedZone,
            camera_location: cleanedCamera,
            duration_seconds: parsedDuration,
            occurred_at: parsedOccurredAt,
            timestamp: parsedOccurredAt,
            confidence: parsedConfidence,
            device_id: cleanedDevice,
            person_name: cleanedPerson,
            identity_status: cleanedIdentityStatus,
            person_role: cleanedPersonRole,
            track_id: parsedTrackId,
            sensor_metadata: safeSensorMeta,
            snapshot_url: null,
            snapshot_path: snapshot_path || null,
        };

        const gate = whatsappGate(resolvedSeverity);

        // --- Idempotency: a repeated edge event_id must not create a second alert ---
        if (eventId) {
            const existing = await findByEdgeEventId(eventId);
            if (existing) {
                return handleDuplicate(res, existing, messageAlert, gate);
            }
        }

        // Non-observability log: safe metadata only — no tokens, no phone numbers.
        console.log('[Edge] Detection alert ingest', JSON.stringify({
            event_id: eventId, alert_type: cleanedAlertType, object_class: cleanedObjectClass,
            severity: resolvedSeverity, zone: cleanedZone, camera: cleanedCamera,
            device_id: cleanedDevice, track_id: parsedTrackId, sensor_metadata: safeSensorMeta,
        }));

        const { links, detectionType } = await resolveLinks(cleanedZone, cleanedCamera);
        const incidentType = resolveIncidentType({
            alert_type: cleanedAlertType,
            object_class: cleanedObjectClass,
            detection_type: detectionType
        });

        // Whatsapp status is stamped at creation (inside the transaction) so a concurrent
        // duplicate request that arrives after commit sees 'Pending'/'Skipped'/'Not
        // Requested' and never starts a second send.
        const initialWhatsappStatus = gate.enabled
            ? (gate.willSend ? 'Pending' : 'Skipped')
            : 'Not Requested';

        // Alert + linked incident are created atomically: a failed incident create rolls
        // back the detection alert so the edge node can safely retry the whole event.
        // WhatsApp is attempted only AFTER this transaction commits (below).
        let alert;
        try {
            alert = await withTransaction(async (t) => {
                const created = await DetectionAlert.create({
                    zone_name: cleanedZone,
                    camera_location: cleanedCamera,
                    status: status || 'Active',
                    object_class: cleanedObjectClass,
                    duration_seconds: parsedDuration,
                    person_name: cleanedPerson,
                    alert_type: cleanedAlertType,
                    severity: resolvedSeverity,
                    source: EDGE_SOURCE,
                    confidence: parsedConfidence,
                    snapshot_url: null,
                    device_id: cleanedDevice,
                    sensor_metadata: safeSensorMeta,
                    occurred_at: parsedOccurredAt,
                    edge_event_id: eventId,
                    whatsapp_status: initialWhatsappStatus,
                    ...links
                }, { transaction: t });

                const incident = await IncidentLog.create({
                    camera_location: cleanedCamera,
                    status: incidentType,
                    source: EDGE_SOURCE,
                    severity: resolvedSeverity,
                    person_name: (person_name && person_name !== 'UNKNOWN') ? cleanedPerson : null,
                    confidence_score: null,
                    resolutionStatus: 'Active',
                    notes: `[Object Detection] Zone: ${cleanedZone}`
                }, { transaction: t });

                await created.update({ incident_log_id: incident.id }, { transaction: t });
                return created;
            });
        } catch (err) {
            // Two simultaneous requests with the same event_id: the loser hits the unique
            // index. Recover by returning the row the winner created — never a 500, and
            // never a second WhatsApp send.
            if (isUniqueViolation(err) && eventId) {
                const existing = await findByEdgeEventId(eventId);
                if (existing) return handleDuplicate(res, existing, messageAlert, gate);
            }
            throw err;
        }

        try {
            const uploadedSnapshotUrl = await persistUploadedSnapshot(alert, req.file);
            if (uploadedSnapshotUrl) {
                messageAlert.snapshot_url = uploadedSnapshotUrl;
            }
        } catch (snapshotErr) {
            // The alert and incident already committed. Snapshot persistence is additive,
            // so report/log its failure without turning a successful idempotent ingest
            // into a retryable 500 that leaves WhatsApp stuck in Pending.
            console.error('[Edge] Snapshot persistence failed:', snapshotErr);
        }

        // Post-commit WhatsApp. A failure here never rolls back or fails the 201.
        let whatsappResult = { status: initialWhatsappStatus };
        if (gate.willSend) {
            whatsappResult = await attemptSecurityWhatsapp(alert, messageAlert);
        }

        return res.status(201).json(serializeAlert(alert, whatsappResult));
    } catch (err) {
        return sendUnexpectedError(res, 'Edge detection alert ingestion failed:', err);
    }
});

// Resolve a duplicate edge event. Never creates a second alert/incident. Only a
// previously-Failed notification is retried (one controlled attempt), and only when
// WhatsApp is currently eligible; Sent/Simulated/Pending are returned untouched.
async function handleDuplicate(res, existing, messageAlert, gate) {
    const currentStatus = existing.whatsapp_status || 'Not Requested';
    const base = { duplicate: true, resent: false, status: currentStatus };

    if (currentStatus === 'Failed' && gate.willSend) {
        await safeUpdateWhatsapp(existing, { whatsapp_status: 'Pending' });
        const result = await attemptSecurityWhatsapp(existing, messageAlert);
        return res.status(200).json(serializeAlert(existing, { ...result, duplicate: true, resent: true }));
    }

    // Sent / Simulated / Pending / Skipped / Not Requested → return as-is, no resend.
    return res.status(200).json(serializeAlert(existing, base));
}

module.exports = router;
