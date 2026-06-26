# Backend Test Cases — Facial Recognition & Access Management (Felicia)

## Create — Registration & Face Enrollment

| # | What is tested | Expected outcome |
|---|----------------|------------------|
| BE-1 | POST /user/register without reCAPTCHA token | Responds 400 with "Security token missing" |
| BE-2 | POST /user/enroll-face stores returned vector | User.update called with faceVector + isEnrolled=true |

## Read — Auth, Login & Logs

| # | What is tested | Expected outcome |
|---|----------------|------------------|
| BE-3 | verifyToken rejects a request with no token | Responds 401 Unauthorized |
| BE-4 | verifyToken rejects an invalid/expired token | Responds 401/403 |
| BE-5 | verifyToken attaches req.user for a valid token | next() called; req.user populated |
| BE-6 | POST /user/login with wrong password | Responds 401; no token issued |
| BE-7 | /user/recognize returns DENIED for unknown face | status = DENIED, no personnel name |
| BE-8 | GET /security/logs returns events list | 200 with an array of log entries |

## Update — Face Re-enrollment

| # | What is tested | Expected outcome |
|---|----------------|------------------|
| BE-9 | PUT /user/:id/enroll-face accepts new face images | Responds 200; processes uploaded images for the existing user |
| BE-10 | PUT /user/:id/enroll-face updates user's vector in DB | User.update called with new faceVector; old vector overwritten |

## Delete — User & Biometric Removal

| # | What is tested | Expected outcome |
|---|----------------|------------------|
| BE-11 | DELETE /user/:id removes user record | User row deleted; subsequent GET /user/:id returns 404 |
| BE-12 | DELETE /user/:id removes biometric vector | faceVector set to null / row cascade-deleted; no orphaned biometric data |
| BE-13 | DELETE /user/:id removes related access logs | AccessLog entries referencing the user are cascade-deleted |
| BE-14 | After delete, user auth fails | POST /user/login with deleted user's credentials responds 401 |
