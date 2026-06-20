# API Documentation — Facial Recognition & Access Management (Felicia)

Base URLs: Node backend `/user`, `/security`, `/attendance`; Python AI service on port 8500.
Protected routes require `Authorization: Bearer <JWT>`. Common error codes:
`400` bad request, `401` unauthorized, `403` forbidden, `404` not found, `409` conflict,
`500` server error.

## Authentication

### POST `/user/register`
Register a new user (validates Google reCAPTCHA).
- Body: `{ "name","email","password","recaptchaToken","companyCode?" }`
- 200: `{ message }` · 400: missing reCAPTCHA / validation · 409: email exists

### POST `/user/login`
Authenticate and receive a JWT.
- Body: `{ "email","password","recaptchaToken" }`
- 200: `{ accessToken, user }` · 401: invalid credentials

## Biometric Enrolment

### POST `/user/enroll-face`  🔒
Forwards captured images to the AI service, stores the returned 512-d vector.
- Body: `{ "images": { "front": "<base64>", "left": "<base64?>", "right": "<base64?>" } }`
- 200: `{ message: "Biometric enrollment successful" }` · 400: no face detected · 500: vectoring failed

### POST `/api/encode-faces` (Python)
Extracts and averages face embeddings from 1–3 images.
- Body: `{ "front": "<base64>", "left": "<base64?>", "right": "<base64?>" }`
- 200: `{ status, vector: number[512], samples }` · 400: no/multiple faces

## Recognition

### POST `/user/recognize` (Python)
Matches a live frame against enrolled users (cosine similarity).
- Body: `{ "image": "data:image/jpeg;base64,..." }`
- 200: `{ user:{name,status,confidence}, box:[x,y,w,h], liveness_ratio }`

### GET `/refresh` (Python)
Reloads enrolled embeddings from the DB. → `{ message }`

### POST `/attendance/scan`
Records an IN/OUT attendance event from a recognised face.

## Security Logs  🔒
All `/security/*` routes now require a valid JWT (`router.use(verifyToken)`).

### POST `/security/logs`
Create a security/access event (used by the AI gantry — automatic task). Safe events are
stored as `reviewStatus: 'Resolved'`; non-safe events default to `'Pending Review'`.
→ `201 { log }`

### GET `/security/logs`
List events for the V-Patrol dashboard / review queue.
- Query: `?status=<Pending Review|False Positive|Escalated|Resolved>` and `?limit=<n≤200>`
- `200` array of logs · `400` invalid status filter

### GET `/security/logs/personnel/:name`
Events filtered by personnel name.

### GET `/security/logs/user/:id`
Events for a specific user id.

### PATCH `/security/logs/:id/review`  🔒 FM-only
**Manual task** — an FM triages a suspicious log.
- Body: `{ "reviewStatus": "Escalated", "reviewNotes": "..." }`
- `200 { log }` · `400` invalid/missing status · `403` non-FM · `404` log not found

## Access & User Management  🔒

### POST `/user/invite-tenant`
Create a tenant invitation. → `{ invite }`

### PUT `/user/generate-code`
Generate/refresh a tenant's registration code (48h, max-usage limited).

### GET `/user/my-code` · GET `/user/my-staff`
Return the caller's active code / their enrolled staff.

### GET `/user/`
List users (for the access-management table).

### PUT `/user/suspend/:id`
Toggle a user's active status (soft access revocation).

### GET `/user/logs/:id`
Access history for a user.

### DELETE `/user/:id`
PDPA off-boarding. Wipes `faceVector`, hard-deletes the user + attendance trail, and
**anonymises** (nulls `personnelName` on) the user's security logs so the audit trail is
kept but no biometric-linked identity remains.

🔒 = requires a valid JWT.
