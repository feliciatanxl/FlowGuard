# Backend Test Cases — Facial Recognition & Access Management (Felicia)

| # | What is tested | Expected outcome |
|---|----------------|------------------|
| BE-1 | verifyToken rejects a request with no token | Responds 401 Unauthorized |
| BE-2 | verifyToken rejects an invalid/expired token | Responds 401/403 |
| BE-3 | verifyToken attaches req.user for a valid token | next() called; req.user populated |
| BE-4 | POST /user/register without reCAPTCHA token | Responds 400 with "Security token missing" |
| BE-5 | POST /user/login with wrong password | Responds 401; no token issued |
| BE-6 | POST /user/enroll-face stores returned vector | User.update called with faceVector + isEnrolled=true |
| BE-7 | /user/recognize returns DENIED for unknown face | status = DENIED, no personnel name |
| BE-8 | DELETE /user/:id removes user + biometrics | User row (and cascaded records) deleted |
| BE-9 | GET /security/logs returns events list | 200 with an array of log entries |
