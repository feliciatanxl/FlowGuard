const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// 🛑 THE FIX #1: Temporarily open CORS to allow your phone to connect
app.use(cors({
    origin: '*' // Changed from process.env.CLIENT_URL
}));

// Simple Route
app.get("/", (req, res) => {
    res.send("FlowGuard Node.js Backend is Active.");
});

// Map Routes
const incidentRoute = require('./routes/incident');
app.use("/api/incident", incidentRoute);
const userRoute = require('./routes/user');
app.use("/user", userRoute);
const bookingRoutes = require('./routes/booking');
app.use('/api/bookings', bookingRoutes);
const securityRoutes = require('./routes/security');
app.use('/api/security', securityRoutes);
const attendanceRoutes = require('./routes/attendance');
app.use('/api/attendance', attendanceRoutes);

// Sync DB and Start Server
const db = require('./models');

db.sequelize.sync({ alter: true }) 
    .then(() => {
        let port = process.env.APP_PORT || 5000;
        app.listen(port, '0.0.0.0', () => {
            // Add this specific log to know exactly when to start testing
            console.log("--------------------------------------------------");
            console.log(`⚡ FlowGuard Server is FULLY READY on port ${port}`);
            console.log("--------------------------------------------------");
        });
    })
    .catch((err) => {
        console.error("Database Sync Error: ", err);
    });