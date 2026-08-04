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

// Database-backed health endpoints. Liveness only confirms the process can serve
// HTTP; readiness also requires successful startup schema validation and a fresh
// Sequelize connection check.
const db = require('./models');
const { createHealthRouter } = require('./routes/health');
const {
    createReadinessState,
    initializeDatabase,
    createGracefulShutdown
} = require('./services/serverLifecycle');
const readiness = createReadinessState();
app.use('/health', createHealthRouter({ sequelize: db.sequelize, readiness }));

// Fallback handlers - MUST stay last, after every route is mounted.
const { notFound, errorHandler } = require('./middlewares/errorHandlers');
app.use(notFound);       // unknown route -> 404 JSON
app.use(errorHandler);   // anything thrown/forwarded -> 500 JSON (no stack leak)

// Sync DB and Start Server
const startCleanupCron = require('./cron/cleanupTranscripts');
// Cloud-compatible binding: PORT (cloud) -> APP_PORT (local .env) -> 5001,
// listening on 0.0.0.0 so deployed containers accept external traffic.
const { resolvePort, resolveHost } = require('./config/serverConfig');

let httpServer = null;
let cleanupTask = null;
let shutdown = null;

async function startServer({ exitOnFailure = require.main === module } = {}) {
    readiness.markNotReady();
    try {
        // IMPORTANT: faceVector is stored as a PostgreSQL FLOAT[] (Sequelize ARRAY(FLOAT)),
        // NOT pgvector. We intentionally do NOT create the pgvector extension or drop the
        // "faceVector" column on startup. The previous drop-on-fallback logic wiped every
        // enrolled face on each restart, so it has been removed. Sequelize sync (below)
        // manages the column safely without data loss.

        // Schema alteration is opt-in: set DB_SYNC_ALTER=true only when a model
        // schema intentionally changed. Normal startup creates missing tables
        // but never re-alters every existing table (and never uses force).
        const alterSchema = process.env.DB_SYNC_ALTER === 'true';

        // Visible startup progress: the HTTP listener only binds AFTER this
        // loop, so a slow remote database must never look like a silent hang
        // (the classic symptom is the Vite proxy timing out on 127.0.0.1:5001).
        const modelCount = Object.keys(db).filter((name) => name !== 'sequelize' && name !== 'Sequelize').length;
        console.log(`Validating ${modelCount} models (alter:${alterSchema}) - port ${resolvePort()} opens only after this succeeds...`);
        const syncStart = Date.now();
        const modelNames = await initializeDatabase(db, { alter: alterSchema });
        console.log(`Database and ${modelNames.length} model schemas validated in ${Math.round((Date.now() - syncStart) / 1000)}s.`);

        // Route import is handle-free. Begin detection-alert retention only now,
        // after the database has authenticated and every model has validated.
        detectionAlertsRoute.retentionTask.start();

        // Start PDPA 90-day transcript cleanup cron
        cleanupTask = startCleanupCron(db);

        const port = resolvePort();
        const host = resolveHost();
        httpServer = app.listen(port, host, () => {
            readiness.markReady();
            console.log("--------------------------------------------------");
            console.log(`FlowGuard Server is FULLY READY on ${host}:${port}`);
            console.log("--------------------------------------------------");
        });
        httpServer.once('close', () => readiness.markNotReady());

        shutdown = createGracefulShutdown({
            getServer: () => httpServer,
            sequelize: db.sequelize,
            cleanupTasks: [cleanupTask, detectionAlertsRoute.retentionTask],
        });
        const handleSignal = (signal) => {
            readiness.markNotReady();
            void shutdown(signal);
        };
        process.once('SIGTERM', () => handleSignal('SIGTERM'));
        process.once('SIGINT', () => handleSignal('SIGINT'));
        return httpServer;
    } catch (err) {
        readiness.markNotReady();
        detectionAlertsRoute.retentionTask.stop();
        console.error('Critical database/schema initialization failed; HTTP server was not started:', err);
        try { await db.sequelize.close(); } catch (closeError) {
            console.error('Failed to close Sequelize after startup failure:', closeError);
        }
        if (exitOnFailure) process.exit(1);
        return null;
    }
}

if (require.main === module) {
    void startServer();
}

module.exports = { app, startServer, readiness };
