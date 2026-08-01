const express = require('express');
const router = express.Router();
const { aiProxyLimiter } = require('../middlewares/rateLimit');
router.use(aiProxyLimiter); // high-frequency edge ingest — generous per-client policy
const { DetectionAlert, IncidentLog, MonitoringZone, Camera, sequelize } = require('../models');
const { Op } = require('sequelize');
const { resolveIncidentType } = require('../utils/detectionAlertBridge');
const { verifyEdgeIngestToken } = require('../middlewares/edgeAuth');
const { DEFAULT_DETECTION_TYPE } = require('../config/detectionTypes');
const whatsapp = require('../services/whatsappService');

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
//   Pest / Restricted-Zone Motion -> High
//   Forgotten Belonging           -> Medium, escalating to High past 5 min
//   Item Picked Up / Set Down     -> Medium
// Pest is High by default (NOT Critical — a generic rodent sighting is not an
// emergency); Critical is reserved for an explicitly-configured/escalated event.
function defaultSeverityForType(alertType, durationSeconds) {
    const key = String(alertType || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
    switch (key) {
        case 'PEST_DETECTION':
        case 'RESTRICTED_MOTION':
        case 'RESTRICTED_ZONE_MOTION':
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

// Edge-ingest bearer-token auth is shared with the snapshot-upload and zone-config
// routes — see middlewares/edgeAuth.js (single source of truth). Missing server config
// → 503, wrong/absent token → 401; the token is never logged.

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
        await safeUpdateWhatsapp(alert, { whatsapp_status: 'Failed', whatsapp_error: String(err.message).slice(0, 500) });
        return { status: 'Failed', error: err.message, recipientCount: 0 };
    }
    const sentAt = (result.status === 'Sent' || result.status === 'Simulated') ? new Date() : null;
    await safeUpdateWhatsapp(alert, {
        whatsapp_status: result.status,
        whatsapp_sent_at: sentAt,
        whatsapp_error: result.error ? String(result.error).slice(0, 500) : null,
    });
    return { status: result.status, recipientCount: result.recipientCount, error: result.error || null, sent_at: sentAt };
}

router.post('/detection-alerts', verifyEdgeIngestToken, async (req, res) => {
    try {
        const {
            event_id,
            zone_name,
            camera_location,
            status,
            object_class,
            duration_seconds,
            person_name,
            alert_type,
            severity,
            confidence,
            snapshot_url,
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
        const resolvedSeverity = severity || defaultSeverityForType(cleanedAlertType, parsedDuration);

        // track_id and sensor_metadata are accepted and surfaced in the notification /
        // server log, but (by design) NOT persisted as detection_alerts columns — they
        // ride inside the event_id and the message rather than expanding the shared schema.
        const parsedTrackId = parsePositiveInt(track_id);
        const safeSensorMeta = (sensor_metadata && typeof sensor_metadata === 'object') ? sensor_metadata : null;

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
            snapshot_url: snapshot_url || null,
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
                    snapshot_url: cleanText(snapshot_url || snapshot_path, 500),
                    device_id: cleanedDevice,
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

        // Post-commit WhatsApp. A failure here never rolls back or fails the 201.
        let whatsappResult = { status: initialWhatsappStatus };
        if (gate.willSend) {
            whatsappResult = await attemptSecurityWhatsapp(alert, messageAlert);
        }

        return res.status(201).json(serializeAlert(alert, whatsappResult));
    } catch (err) {
        return res.status(500).json({ error: err.message });
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

// ---------------------------------------------------------------------------
// GET /api/edge/config — live MonitoringZone config for a SecurePi edge device.
// ---------------------------------------------------------------------------
// Authenticated with the SAME edge token as ingestion. Lets the Pi pull the zone
// settings a Facilities Manager changes on the FlowGuard website (unattended
// threshold, alert cooldown, detection_enabled, monitored_classes, severity) instead
// of relying on local presets, so a website change reaches the Pi on its next refresh.

// Parse a zone's monitored_classes (stored as a TEXT JSON string) into an array; never throws.
function parseMonitoredClasses(raw) {
    try {
        const parsed = JSON.parse(raw || '[]');
        return Array.isArray(parsed) ? parsed.map((c) => String(c)) : [];
    } catch {
        return [];
    }
}

// Compact, secrets-free edge config the Pi consumes. `unattended_threshold_seconds`
// prefers the explicit seconds column and falls back to the legacy `time_threshold`
// (stored in MINUTES) so older zones still yield a usable value.
function serializeEdgeZoneConfig(zone, deviceId) {
    const plain = (zone && typeof zone.toJSON === 'function') ? zone.toJSON() : zone;
    const unattended = (plain.unattended_threshold_seconds != null)
        ? plain.unattended_threshold_seconds
        : (plain.time_threshold != null ? plain.time_threshold * 60 : null);
    return {
        device_id: deviceId || null,
        zone_id: plain.id,
        zone_name: plain.zone_name,
        detection_enabled: plain.detection_enabled !== false, // default true
        detection_type: plain.detection_type || DEFAULT_DETECTION_TYPE,
        monitored_classes: parseMonitoredClasses(plain.monitored_classes),
        unattended_threshold_seconds: unattended,
        alert_cooldown_seconds: (plain.alert_cooldown_seconds != null) ? plain.alert_cooldown_seconds : null,
        severity: plain.severity || 'Medium',
    };
}

router.get('/config', verifyEdgeIngestToken, async (req, res) => {
    try {
        const deviceId = cleanText(req.query.device_id, 100);
        const zoneIdRaw = req.query.zone_id;
        const zoneName = cleanText(req.query.zone_name, 255);
        const cameraLocation = cleanText(req.query.camera_location, 255);

        let zone = null;
        // 1) Explicit zone_id (the Pi's SECUREPI_ZONE_ID) — the most direct mapping.
        if (zoneIdRaw !== undefined && /^\d+$/.test(String(zoneIdRaw))) {
            zone = await MonitoringZone.findByPk(parseInt(zoneIdRaw, 10));
        }
        // 2) zone_name.
        if (!zone && zoneName) {
            zone = await MonitoringZone.findOne({ where: { zone_name: zoneName } });
        }
        // 3) camera_location → Camera → its assigned zone (reuse the existing
        //    Camera.zone_id relationship rather than inventing a new device map).
        if (!zone && cameraLocation && Camera && typeof Camera.findOne === 'function') {
            const camera = await Camera.findOne({
                where: { [Op.or]: [{ camera_name: cameraLocation }, { location: cameraLocation }] }
            });
            if (camera && camera.zone_id) {
                zone = await MonitoringZone.findByPk(camera.zone_id);
            }
        }

        if (!zone) {
            return res.status(404).json({
                error: 'No monitoring zone found for the supplied device_id/zone_id/zone_name/camera_location.'
            });
        }

        // Safe log — identifiers only, never the token.
        console.log('[Edge] Zone config fetch', JSON.stringify({
            device_id: deviceId, zone_id: zone.id, zone_name: zone.zone_name,
            detection_enabled: zone.detection_enabled !== false,
        }));

        return res.json(serializeEdgeZoneConfig(zone, deviceId));
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

module.exports = router;
