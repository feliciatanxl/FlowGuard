const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Trust the Cloud Run / reverse-proxy hop so req.ip is the REAL client address
// (from X-Forwarded-For) that the rate limiters key on — configured NARROWLY
// (a hop count, default 1), never blindly `true`, so a client cannot spoof its
// address by injecting extra X-Forwarded-For entries. TRUST_PROXY is a string in
// the environment; parseTrustProxy converts a numeric string to a Number and
// leaves named presets / subnets as strings (see config/serverConfig.js).
const { parseTrustProxy } = require('./config/serverConfig');
app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Environment-based CORS allowlist (FRONTEND_URL + CLIENT_URL + ALLOWED_ORIGINS).
// Production/staging FAILS CLOSED when nothing is configured (see corsOptions.js);
// development uses an explicit localhost allowlist. Never a wildcard.
const { buildCorsOptions, buildAllowedOrigins, isProductionLike } = require('./middlewares/corsOptions');
// Startup verification: log the effective CORS posture so an operator can CONFIRM
// the deployed client origin is present BEFORE relying on the fail-closed change.
// (Origins only — no secrets.) In production/staging with an empty allowlist this
// is a hard misconfiguration warning: browser requests will be denied.
const _corsAllowed = buildAllowedOrigins();
if (isProductionLike() && _corsAllowed.length === 0) {
    console.error('[startup] CORS is FAIL-CLOSED: no FRONTEND_URL/CLIENT_URL/ALLOWED_ORIGINS set in production/staging. All browser origins will be DENIED — set the deployed client origin before deploying.');
} else {
    console.log(`[startup] CORS allowlist (${isProductionLike() ? 'production/staging' : 'development'}): ${_corsAllowed.length ? _corsAllowed.join(', ') : '(none configured → localhost dev allowlist)'}`);
}
app.use(cors(buildCorsOptions()));

// Simple Route
app.get("/", (req, res) => {
    res.send("FlowGuard Node.js Backend is Active.");
});

// Map Routes
const incidentRoute = require('./routes/incident');
app.use("/api/incident", incidentRoute);
const zonesRoute = require('./routes/zones');
app.use("/api/zones", zonesRoute);
const camerasRoute = require('./routes/cameras');
app.use("/api/cameras", camerasRoute);
const detectionAlertsRoute = require('./routes/detectionAlerts');
app.use("/api/detection-alerts", detectionAlertsRoute);
// SecurePi snapshot upload (edge-token) + controlled serving of stored snapshots.
// Mounted BEFORE the /api/edge router so the more-specific prefix matches first and a
// snapshot request doesn't also pass through the detection-alert router's rate limiter.
const edgeSnapshotsRoute = require('./routes/edgeSnapshots');
app.use("/api/edge/snapshots", edgeSnapshotsRoute);
const edgeDetectionAlertsRoute = require('./routes/edgeDetectionAlerts');
app.use("/api/edge", edgeDetectionAlertsRoute);
const userRoute = require('./routes/user');
app.use("/user", userRoute);
const bookingRoutes = require('./routes/booking');
app.use('/api/bookings', bookingRoutes);
const securityRoutes = require('./routes/security');
app.use('/api/security', securityRoutes);
const attendanceRoutes = require('./routes/attendance');
app.use('/api/attendance', attendanceRoutes);
const dashboardRoutes = require('./routes/dashboard');
app.use('/api/dashboard', dashboardRoutes);
const facialRecognitionRoutes = require('./routes/facialRecognition');
app.use('/api/facial-recognition', facialRecognitionRoutes);
// Authenticated proxy to the AI service's Cloud QR snapshot decoder. Returns a
// CANDIDATE booking ref only — never authoritative (gate-verification decides).
const qrRoutes = require('./routes/qr');
app.use('/api/qr', qrRoutes);
const supportRoutes = require('./routes/support');
app.use('/api/support', supportRoutes);
// Authenticated proxy to the (private) AI service's YOLO endpoints — the
// browser never talks to FastAPI directly in any environment.
const yoloRoutes = require('./routes/yolo');
app.use('/api/yolo', yoloRoutes);

// Fallback handlers - MUST stay last, after every route is mounted.
const { notFound, errorHandler } = require('./middlewares/errorHandlers');
app.use(notFound);       // unknown route -> 404 JSON
app.use(errorHandler);   // anything thrown/forwarded -> 500 JSON (no stack leak)

// Sync DB and Start Server
const db = require('./models');
const startCleanupCron = require('./cron/cleanupTranscripts');
// Cloud-compatible binding: PORT (cloud) -> APP_PORT (local .env) -> 5001,
// listening on 0.0.0.0 so deployed containers accept external traffic.
const { resolvePort, resolveHost } = require('./config/serverConfig');

async function startServer() {
    try {
        // IMPORTANT: faceVector is stored as a PostgreSQL FLOAT[] (Sequelize ARRAY(FLOAT)),
        // NOT pgvector. We intentionally do NOT create the pgvector extension or drop the
        // "faceVector" column on startup. The previous drop-on-fallback logic wiped every
        // enrolled face on each restart, so it has been removed. Sequelize sync (below)
        // manages the column safely without data loss.

        const modelNames = Object.keys(db).filter(
            k => k !== 'sequelize' && k !== 'Sequelize'
        );
        const failedModels = [];

        // Schema alteration is opt-in: set DB_SYNC_ALTER=true only when a model
        // schema intentionally changed. Normal startup creates missing tables
        // but never re-alters every existing table (and never uses force).
        const alterSchema = process.env.DB_SYNC_ALTER === 'true';

        // Visible startup progress: the HTTP listener only binds AFTER this
        // loop, so a slow remote database must never look like a silent hang
        // (the classic symptom is the Vite proxy timing out on 127.0.0.1:5001).
        console.log(`Syncing ${modelNames.length} models (alter:${alterSchema}) - port ${resolvePort()} opens when this finishes...`);
        const syncStart = Date.now();

        for (const [i, name] of modelNames.entries()) {
            // Heartbeat: if one model sync stalls (slow/unreachable DB), keep
            // saying so instead of going quiet.
            const heartbeat = setInterval(() => {
                console.log(`  ... still syncing ${name} (${Math.round((Date.now() - syncStart) / 1000)}s elapsed) - check DB_HOST/network if this persists`);
            }, 10000);
            const modelStart = Date.now();
            try {
                await db[name].sync({ alter: alterSchema });
                console.log(`  OK [${i + 1}/${modelNames.length}] Synced: ${name} (${Date.now() - modelStart}ms)`);
            } catch (syncErr) {
                failedModels.push(name);
                console.error(`  FAIL [${i + 1}/${modelNames.length}] Failed to sync ${name}:`, syncErr.message);
            } finally {
                clearInterval(heartbeat);
            }
        }
        console.log(`Model sync finished in ${Math.round((Date.now() - syncStart) / 1000)}s.`);

        if (failedModels.length > 0) {
            console.warn(`\nWARNING: ${failedModels.length} model(s) failed to sync: ${failedModels.join(', ')}`);
            console.warn("The server will start, but those tables may be missing or outdated.\n");
        }

        // Start PDPA 90-day transcript cleanup cron
        startCleanupCron(db);

        const port = resolvePort();
        const host = resolveHost();
        app.listen(port, host, () => {
            console.log("--------------------------------------------------");
            console.log(`FlowGuard Server is FULLY READY on ${host}:${port}`);
            console.log("--------------------------------------------------");
        });
    } catch (err) {
        console.error("Database Sync Error: ", err);
    }
}

startServer();
