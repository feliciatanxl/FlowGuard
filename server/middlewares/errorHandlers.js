// Centralised fallback handlers. Mounted LAST in index.js, after all routes.

// 404 — no route matched the request.
const notFound = (req, res) => {
    res.status(404).json({ error: "Route not found." });
};

// 500 — last-resort handler for anything a route forwarded or threw.
// Express 5 auto-forwards rejected async handlers here. We log the real error
// for developers but never leak the message/stack to the client.
const errorHandler = (err, req, res, next) => {
    console.error("Unhandled server error:", err);
    if (res.headersSent) {
        return next(err);
    }
    res.status(err.status || 500).json({ error: "Internal server error." });
};

module.exports = { notFound, errorHandler };
