const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());

// Enable CORS for React Frontend
app.use(cors({
    origin: process.env.CLIENT_URL
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

// Sync DB and Start Server
const db = require('./models');

db.sequelize.sync({ alter: true }) 
    .then(() => {
        let port = process.env.APP_PORT || 5000;
        app.listen(port, () => {
            console.log(`⚡ FlowGuard Server running on http://localhost:${port}`);
        });
    })
    .catch((err) => {
        console.error("Database Sync Error: ", err);
    });