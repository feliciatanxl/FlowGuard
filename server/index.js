const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Temporarily open CORS to allow phone/local-network testing.
app.use(cors({
    origin: '*'
}));

// Simple Route
app.get("/", (req, res) => {
    res.send("FlowGuard Node.js Backend is Active.");
});

// Map Routes
const incidentRoute = require('./routes/incident');
app.use("/api/incident", incidentRoute);
const zonesRoute = require('./routes/zones');
app.use("/api/zones", zonesRoute);
const detectionAlertsRoute = require('./routes/detectionAlerts');
app.use("/api/detection-alerts", detectionAlertsRoute);
const userRoute = require('./routes/user');
app.use("/user", userRoute);
const bookingRoutes = require('./routes/booking');
app.use('/api/bookings', bookingRoutes);
const securityRoutes = require('./routes/security');
app.use('/api/security', securityRoutes);
const attendanceRoutes = require('./routes/attendance');
app.use('/api/attendance', attendanceRoutes);

// Fallback handlers — MUST stay last, after every route is mounted.
const { notFound, errorHandler } = require('./middlewares/errorHandlers');
app.use(notFound);       // unknown route → 404 JSON
app.use(errorHandler);   // anything thrown/forwarded → 500 JSON (no stack leak)

// Sync DB and Start Server
const db = require('./models');

async function startServer() {
    try {
        let pgvectorReady = false;
        try {
            await db.sequelize.query('CREATE EXTENSION IF NOT EXISTS vector');
            pgvectorReady = true;
        } catch (extErr) {
            console.warn("WARNING: pgvector not available — migrating faceVector to FLOAT[].");
            // The column may exist as 'vector' type; drop it so sync can recreate as FLOAT[]
            try {
                await db.sequelize.query(`
                    ALTER TABLE "users"
                    DROP COLUMN IF EXISTS "faceVector";
                `);
            } catch (dropErr) {
                // Table may not exist yet — that's fine, sync will create it
            }
        }

        const modelNames = Object.keys(db).filter(
            k => k !== 'sequelize' && k !== 'Sequelize'
        );
        const failedModels = [];

        for (const name of modelNames) {
            try {
                await db[name].sync({ alter: true });
                console.log(`  ✔ Synced: ${name}`);
            } catch (syncErr) {
                failedModels.push(name);
                console.error(`  ✖ Failed to sync ${name}:`, syncErr.message);
            }
        }

        if (failedModels.length > 0) {
            console.warn(`\nWARNING: ${failedModels.length} model(s) failed to sync: ${failedModels.join(', ')}`);
            console.warn("The server will start, but those tables may be missing or outdated.\n");
        }

        let port = process.env.APP_PORT || 5000;
        app.listen(port, '127.0.0.1', () => {
            console.log("--------------------------------------------------");
            console.log(`FlowGuard Server is FULLY READY on port ${port}`);
            console.log("--------------------------------------------------");
        });
    } catch (err) {
        console.error("Database Sync Error: ", err);
    }
}

startServer();
