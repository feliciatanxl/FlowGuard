# FlowGuard — Object Detection & SecurePi Integration API Documentation

**Scope:** Camera Inventory, Monitoring Zones (Detection Setup), Detection Alerts,
SecurePi edge-ingest, detection-snapshot evidence, and the Object Detection /
Security Camera pages' supporting AI-service calls.

**Re-audited against source on:** 2026-08-09, branch `feature/object-detection-v2`.
All endpoints below were confirmed to exist in the current implementation — nothing
here is inferred from filenames alone. Where behaviour had to be inferred from
non-obvious code paths, it is explicitly marked **(Inferred)**.

---

## 1. System Overview

Three separate runtimes are involved in this feature, and only one of them is the
"FlowGuard backend" that owns JSON REST endpoints:

| System | Technology | Port (dev) | Role |
|---|---|---|---|
| **FlowGuard Backend** | Node.js / Express / Sequelize | 5001 | Owns Camera Inventory, Monitoring Zones, Detection Alerts, and snapshot evidence. Source of truth in Postgres. |
| **FlowGuard AI Service** | Python / FastAPI | 8501 | Runs YOLO inference. The browser calls Node `/api/yolo/*`; Node calls the private AI service with service-to-service credentials. |
| **SecurePi Camera Node** | Python / Flask on Raspberry Pi (`raspberry-pi4/pi_camera_steam.py`) | 8081 | Streams MJPEG video and serves `/health`, `/snapshot`, `/sensor_status` directly to the browser over the LAN/hotspot. |
| **SecurePi Detection Runtime** | Python on Raspberry Pi (**not checked into this repo**) | — | Performs on-device detection and POSTs alerts to `/api/edge/detection-alerts` with the edge ingest token. See the deployment note in §5. |

The Object Detection page (`client/src/pages/ObjectDetection.jsx`) and the Security
Camera page (`client/src/pages/SecurityCamera.jsx`) use Node for Camera/Zone/Alert
data and browser-camera inference. Node proxies YOLO calls to the private AI service.
Both pages can also load the SecurePi MJPEG stream, health check, and sensor status
directly from the Pi's IP (bypassing the Node backend entirely for those calls).

---

## 2. Endpoint Summary

| Method | Endpoint | Purpose | Authentication | Used By |
|--------|----------|---------|----------------|---------|
| GET | `/api/zones` | List monitoring zones (Detection Setup) | JWT (FM, Staff) | Object Detection, Security Camera, Detection Setup |
| GET | `/api/zones/:id` | Get one monitoring zone | JWT (FM, Staff) | Detection Setup |
| POST | `/api/zones` | Create a monitoring zone | JWT (FM only) | Detection Setup |
| PUT | `/api/zones/:id` | Update a monitoring zone | JWT (FM only) | Detection Setup |
| DELETE | `/api/zones/:id` | Delete a zone + release its camera | JWT (FM only) | Detection Setup |
| GET | `/api/cameras` | List cameras (with zone) | JWT (FM, Staff) | Object Detection, Camera Inventory |
| GET | `/api/cameras/:id` | Get one camera | JWT (FM, Staff) | Camera Inventory |
| POST | `/api/cameras` | Create a camera | JWT (FM only) | Camera Inventory |
| PUT | `/api/cameras/:id` | Update a camera | JWT (FM only) | Camera Inventory |
| DELETE | `/api/cameras/:id` | Deactivate + soft-delete a camera | JWT (FM only) | Camera Inventory |
| GET | `/api/detection-alerts` | List latest 50 detection alerts | JWT (FM, Staff) | Object Detection, Security Camera, Cameras |
| GET | `/api/detection-alerts/:id` | Get one detection alert | JWT (FM, Staff) | — (available; not currently polled) |
| GET | `/api/detection-alerts/:id/snapshot/:filename` | Fetch the stored JPEG evidence for an alert | JWT (FM, Staff) | Object Detection / Security Camera snapshot preview |
| POST | `/api/detection-alerts` | Create a detection alert | JWT (FM, Staff) **or** `x-service-key` (AI engine) | AI engine (server-to-server); Security Camera page; manual test alerts |
| PUT | `/api/detection-alerts/:id` | Update alert `status` / `severity` / `person_name` | JWT (FM, Staff) | Object Detection, Security Camera, Cameras |
| DELETE | `/api/detection-alerts/:id` | False-alarm removal (soft-delete alert + linked incident) | JWT (**FM only**) | **No frontend caller** — API/tests only (see §7.9) |
| POST | `/api/edge/detection-alerts` | SecurePi edge-device alert ingest (JSON **or** multipart with JPEG evidence) | Bearer token (`EDGE_INGEST_TOKEN`) | SecurePi detection runtime |
| GET | `/api/yolo/people-count` | Authenticated Node proxy to private FastAPI people count | JWT (FM, Staff) | Object Detection (5s poll) |
| POST | `/api/yolo/analyze-frame` | Authenticated Node proxy for one browser/upload frame | JWT (FM, Staff) | Object Detection / CameraFeed / Security Camera |
| GET | `http://<pi-ip>:8081/health` *(SecurePi device, not a FlowGuard endpoint)* | Camera + sensor health probe | None | Object Detection / Security Camera (5s poll) |
| GET | `http://<pi-ip>:8081/sensor_status` *(SecurePi device)* | PIR / ultrasonic sensor state | None | Security Camera, and as a `/health` fallback |
| GET | `http://<pi-ip>:8081/video_feed` *(SecurePi device)* | MJPEG live video stream | None | Object Detection / Security Camera (`<img>` tag) |
| GET | `http://<pi-ip>:8081/snapshot` *(SecurePi device)* | One JPEG frame | None | Browser frame capture for hardware-mode inference |

---

## 3. FlowGuard Backend Endpoints (Node.js / Express)

Mounted in `server/index.js`:
```js
app.use("/api/zones", require('./routes/zones'));
app.use("/api/cameras", require('./routes/cameras'));
app.use("/api/detection-alerts", require('./routes/detectionAlerts'));
app.use("/api/edge", require('./routes/edgeDetectionAlerts'));   // → /api/edge/detection-alerts
app.use('/api/yolo', require('./routes/yolo'));
```

All JWT-protected routes require:
```
Authorization: Bearer <accessToken>
Content-Type: application/json
```
`verifyToken` (`server/middlewares/auth.js`) decodes the JWT with `APP_SECRET`, then
re-reads the `User` row from the database on every request — a suspended/deleted
account or a stale `tokenVersion` (password reset, forced logout) is rejected even
if the JWT itself hasn't expired.

### 3.0 Rate limiting (applies to every endpoint in this section)

Every router in this feature applies a route-wide limiter from
`server/middlewares/rateLimit.js` **before** authentication, so **`429 Too Many
Requests`** is a possible response on every endpoint below and is not repeated in
each error table.

| Router | Policy | Default limit | Key |
|---|---|---|---|
| `/api/zones`, `/api/cameras`, `/api/detection-alerts` | `readLimiter` | 300 / minute | verified `req.user.id` after auth, else client IP |
| `/api/yolo/*`, `/api/edge/*` | `aiProxyLimiter` | 1200 / minute | same |

- Body is always `{ "message": "Too many requests. Please try again later." }` — it
  never echoes the key, IP, or token.
- Standard `RateLimit-*` and `Retry-After` headers are sent.
- Callers presenting a valid `x-service-key` (the Python AI engine) are **skipped**
  by both limiters.
- Every threshold is env-tunable (`RATE_LIMIT_READ_MAX`, `RATE_LIMIT_AI_MAX`, …).
- **Deployment caveat:** the default store is in-memory, so counters are per Node
  process — the effective limit is per-instance, not global.

### 3.1 GET `/api/zones`

| | |
|---|---|
| **Purpose** | List all monitoring zones (Detection Setup records), most recent first. |
| **Auth** | JWT required |
| **Roles** | FM, Staff (403 for Tenant; 401 unauthenticated) |
| **Headers** | `Authorization: Bearer <token>` |
| **Path params** | none |
| **Query params** | none |
| **Body** | none |
| **Source** | `server/routes/zones.js:74-81` |

**Example request**
```
GET /api/zones
Authorization: Bearer <accessToken>
```

**Success — 200**
```json
[
  {
    "id": 3,
    "zone_name": "Loading Bay",
    "location": "Warehouse East",
    "time_threshold": 5,
    "monitored_classes": ["backpack", "suitcase", "person"],
    "density_threshold": 12,
    "unattended_threshold_seconds": 60,
    "alert_cooldown_seconds": 30,
    "severity": "High",
    "assigned_team": "Response Team A",
    "detection_enabled": true,
    "detection_type": "unattended_object",
    "createdAt": "2026-07-01T02:00:00.000Z",
    "updatedAt": "2026-07-10T09:00:00.000Z"
  }
]
```
`monitored_classes` is stored as a JSON string column and parsed back into an array
by `serializeZone()` before it is returned. `serializeZone()` also fills in
`detection_type: 'unattended_object'` for rows created before that column existed,
so the field is never `null` in a response even though it is nullable in the DB.

**Errors**
| Status | Cause |
|---|---|
| 401 | Missing/invalid/expired token, revoked session, suspended/deleted account |
| 403 | Valid token but role is not FM/Staff |
| 500 | Database error |

---

### 3.2 GET `/api/zones/:id`

| | |
|---|---|
| **Purpose** | Read one monitoring zone. |
| **Auth / Roles** | JWT, FM or Staff |
| **Path params** | `id` — zone's numeric primary key |
| **Source** | `server/routes/zones.js:83-93` |

**Success — 200:** a single zone object, same shape as a §3.1 list item.
**Errors:** 401, 403, 404 (`sendStatus(404)` with empty body — also returned for a
**non-numeric** `id`, which is rejected by a `/^\d+$/` guard before it can make
Postgres throw on an integer PK lookup), 500.

---

### 3.3 POST `/api/zones`

| | |
|---|---|
| **Purpose** | Create a monitoring zone / Detection Setup rule set. |
| **Auth** | JWT required |
| **Roles** | FM only (403 for Staff/Tenant) |
| **Headers** | `Authorization: Bearer <token>`, `Content-Type: application/json` |
| **Source** | `server/routes/zones.js:95-151` |

**Request-body fields**

| Field | Type | Required | Notes |
|---|---|---|---|
| `zone_name` | string | Yes | |
| `location` | string | Yes | |
| `time_threshold` | number | Yes | Positive integer; legacy unattended-object threshold in **minutes** |
| `density_threshold` | number \| null | No | Positive integer if provided |
| `unattended_threshold_seconds` | number \| null | No | Positive integer if provided; overrides `time_threshold` for the AI engine when set |
| `alert_cooldown_seconds` | number \| null | No | Positive integer if provided |
| `severity` | string | No | One of `Low`, `Medium`, `High`, `Critical` (default `Medium`) |
| `assigned_team` | string \| null | No | Free-text soft link, not a foreign key |
| `detection_enabled` | boolean | No | Coerced with `Boolean()` |
| `detection_type` | string \| null | No | One of `unattended_object`, `crowd_density`, `unauthorized_access` — validated against `server/config/detectionTypes.js`. Drives the IncidentLog type an alert in this zone bridges to (see §3.9). |
| `monitored_classes` | array or comma-separated string | No | Cannot be an empty array if the field is supplied at all |
| `camera_id` | number \| null | No | Assigns an existing Camera Inventory camera to this rule. **One camera per rule** — see below. |

**Camera assignment.** When `camera_id` is supplied the route loads the camera and
then, in the **same transaction** as the zone create, sets `camera.zone_id` to the
new zone. If the camera already carries any `zone_id`, it is never silently stolen:

- Camera not found → **400** `{ "error": "Selected camera does not exist." }`
- Camera already assigned to another rule → **409** `{ "error": "That camera is already assigned to another Detection Setup rule." }`

If the camera update fails, the zone itself is never created.

**Example request**
```
POST /api/zones
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "zone_name": "Loading Bay",
  "location": "Warehouse East",
  "time_threshold": 5,
  "unattended_threshold_seconds": 60,
  "severity": "High",
  "detection_type": "unattended_object",
  "monitored_classes": ["backpack", "suitcase", "person"],
  "detection_enabled": true,
  "camera_id": 5
}
```

**Success — 201** (same shape as §3.1 list item)

**Errors**
| Status | Cause |
|---|---|
| 400 | `zone_name`/`location`/`time_threshold` missing; any threshold not a positive number; invalid `severity`; invalid `detection_type`; empty `monitored_classes` array; `camera_id` not found |
| 401 / 403 | See §3.1 |
| 409 | `camera_id` already assigned to another Detection Setup rule |
| 500 | Database error |

---

### 3.4 PUT `/api/zones/:id`

| | |
|---|---|
| **Purpose** | Update a monitoring zone's Detection Setup fields (partial update — only supplied fields change). |
| **Auth / Roles** | JWT, FM only |
| **Path params** | `id` — zone's numeric primary key |
| **Body fields** | Same as §3.3, all optional; validated the same way when present |
| **Source** | `server/routes/zones.js:153-217` |

**`camera_id` is tri-state:**
- **omitted** → the zone's current camera assignment is left untouched (backward compatible)
- **`null`** → the currently-assigned camera is released (`zone_id = null`)
- **a value** → validated, then swapped in; the previously-assigned camera is released in the same transaction

Re-saving the **same** camera already on this zone is always allowed. A camera held
by a **different** zone returns **409**.

**Success — 200**: updated zone object. **Errors:** 400 (validation, same rules as
POST), 401, 403, 404 (`sendStatus(404)` with empty body — no JSON `error` field),
409 (camera held by another rule), 500.

---

### 3.5 DELETE `/api/zones/:id`

| | |
|---|---|
| **Purpose** | Remove a monitoring zone. The model is `paranoid: true`, so `destroy()` is a soft-delete (sets `deletedAt`); the route does not restore it. |
| **Auth / Roles** | JWT, FM only |
| **Source** | `server/routes/zones.js:219-236` |

Any camera(s) mapped to the rule are released (`zone_id = null`) **before** the zone
is soft-deleted, inside one transaction, so they immediately show as unassigned and
available for another Detection Setup rule instead of pointing at a deleted `zone_id`.

**Success — 200**: empty body (`res.sendStatus(200)`). **Errors:** 401, 403, 404
(empty body), 500.

---

### 3.6 Camera Inventory — `/api/cameras`

Model: `server/models/Camera.js`. All routes require a JWT (`router.use(verifyToken)`
at `server/routes/cameras.js:22`).

#### GET `/api/cameras`
- **Roles:** FM, Staff.
- Returns all cameras, newest first, each with its `zone` (via `include`).
- **Success 200** example:
```json
[
  {
    "id": 5,
    "camera_code": "CAM-05",
    "camera_name": "Loading Bay Camera 01",
    "location": "Warehouse East",
    "zone_id": 3,
    "stream_url": "http://172.20.10.5:8081/video_feed",
    "status": "Online",
    "camera_type": "Fixed",
    "last_active_at": "2026-07-11T09:55:00.000Z",
    "notes": null,
    "zone": { "id": 3, "zone_name": "Loading Bay", "...": "..." }
  }
]
```
- **Errors:** 401, 403, 500.

#### GET `/api/cameras/:id`
- **Roles:** FM, Staff. **Path param:** `id`.
- **Success 200:** single camera with `zone`. **Errors:** 401, 403, 404
  (`{ "error": "Camera not found." }`), 500.

#### POST `/api/cameras`
- **Roles:** FM only.

| Field | Type | Required | Validation |
|---|---|---|---|
| `camera_code` | string | Yes | Non-empty after trim; must be unique (case-insensitive) → 409 on duplicate |
| `camera_name` | string | Yes | Non-empty after trim |
| `location` | string | Yes | Non-empty after trim |
| `zone_id` | number \| null | No | Must reference an existing zone; that zone must not already hold a camera → 409 |
| `stream_url` | string \| null | No | No format validation server-side (the frontend enforces a strict `http(s)://` URL — see §5) |
| `status` | string | No | One of `Online`, `Offline`, `Maintenance`, `Disabled` (default `Online`) |
| `camera_type` | string \| null | No | |
| `notes` | string \| null | No | |

**One camera per zone.** `findCameraByZone()` (`cameras.js:18`) enforces the same
exclusivity rule as `/api/zones` from the camera side: assigning a `zone_id` that
already has a camera mapped to it returns **409**
`{ "error": "That zone already has a camera assigned. Unassign it before mapping another camera." }`.
On PUT, the camera being edited is excluded from that check so it can re-save its own zone.

**Example request**
```
POST /api/cameras
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "camera_code": "CAM-05",
  "camera_name": "Loading Bay Camera 01",
  "location": "Warehouse East",
  "zone_id": 3,
  "stream_url": "http://172.20.10.5:8081/video_feed",
  "status": "Online"
}
```
**Success — 201:** created camera object (`last_active_at` set to now).
**Errors:** 400 (missing required field, invalid `status`, `zone_id` not found),
401, 403, 409 (duplicate `camera_code` **or** zone already has a camera), 500.

#### PUT `/api/cameras/:id`
- **Roles:** FM only. Partial update; same field validation as POST when a field is
  supplied. **Errors:** 400, 401, 403, 404 (`{ "error": "Camera not found." }`),
  409 (duplicate code excluding self, or zone already taken by another camera), 500.

#### DELETE `/api/cameras/:id`
- **Roles:** FM only. Sets `status: 'Disabled'` then calls `destroy()` (soft-delete,
  `paranoid: true`). **Success — 200:** empty body. **Errors:** 401, 403, 404
  (`{ "error": "Camera not found." }`), 500.

---

### 3.7 Detection Alerts — `/api/detection-alerts`

Model: `server/models/DetectionAlert.js`. Source: `server/routes/detectionAlerts.js`.

#### GET `/api/detection-alerts`
| | |
|---|---|
| **Purpose** | List the 50 most recent detection alerts. |
| **Auth / Roles** | JWT, FM or Staff |
| **Query params** | `status` (optional) — filters to an exact status match |
| **Ordering** | `COALESCE(occurred_at, createdAt) DESC`, then `createdAt DESC` — an alert is ranked by **when the event happened**, falling back to row-creation time only when the edge device sent no timestamp |
| **Source** | lines 109-129 |

**Example request**
```
GET /api/detection-alerts?status=Active
Authorization: Bearer <accessToken>
```

**Success — 200**
```json
[
  {
    "id": 42,
    "zone_name": "Loading Bay",
    "camera_location": "Loading Bay Camera 01",
    "status": "Active",
    "object_class": "backpack",
    "duration_seconds": 65,
    "person_name": null,
    "alert_type": "Unattended Object",
    "severity": "Low",
    "source": "SecurePi Edge Node",
    "confidence": 0.87,
    "snapshot_url": "/api/detection-alerts/42/snapshot/6f1c2b7e-6c1e-4a3f-9b2d-77c4a1e0f9aa.jpg",
    "device_id": "securepi-loading-bay-01",
    "sensor_metadata": { "pir": true, "distance_cm": 42.5, "trigger": "motion" },
    "edge_event_id": "securepi-01:unattended:7:1783094400",
    "whatsapp_status": "Sent",
    "whatsapp_sent_at": "2026-07-11T10:00:03.000Z",
    "whatsapp_error": null,
    "occurred_at": "2026-07-11T10:00:00.000Z",
    "camera_id": 5,
    "zone_id": 3,
    "incident_log_id": 88,
    "createdAt": "2026-07-11T10:00:02.000Z",
    "updatedAt": "2026-07-11T10:00:02.000Z"
  }
]
```
**Errors:** 401, 403, 500.

#### GET `/api/detection-alerts/:id`
| | |
|---|---|
| **Purpose** | Read one alert. |
| **Auth / Roles** | JWT, FM or Staff |
| **Source** | lines 131-141 |

**Success — 200:** a single alert object. **Errors:** 401, 403, 404 (`sendStatus`,
empty body — including for a non-numeric `id`), 500.

#### GET `/api/detection-alerts/:id/snapshot/:filename`
| | |
|---|---|
| **Purpose** | Serve the stored JPEG evidence captured by the SecurePi edge device for this alert. |
| **Auth / Roles** | JWT, FM or Staff |
| **Response type** | `image/jpeg` (raw bytes, not JSON) |
| **Source** | lines 143-168 |

This is the **only** way to read a detection snapshot — the bytes are never
publicly reachable. Authorisation is deliberately layered:

1. `id` must be numeric, and `filename` must match `GENERATED_SNAPSHOT_RE`
   (a v4 UUID + `.jpg`) — no client-supplied path can be used as a storage path.
2. The alert is loaded and its stored `snapshot_url` must start with
   `/api/detection-alerts/<id>/snapshot/`.
3. The filename is recovered **from the stored URL**, and the requested filename
   must equal it exactly. `req.params.filename` only ever authorises that one
   stored resource; it never selects a file.

Every failure — bad id, bad filename format, alert missing, alert has no stored
snapshot, mismatch, or object missing from storage — collapses to the same
**404 (empty body)** so the endpoint reveals nothing about what exists.

The frontend fetches this with `responseType: 'blob'` and renders an object URL
(`ObjectDetection.jsx`); a `snapshot_url` that is *not* in this protected form is
treated as an on-device edge path and is never rendered as a clickable link.

**Errors:** 401, 403, 404 (all of the above), 500.

#### POST `/api/detection-alerts`
| | |
|---|---|
| **Purpose** | Create a detection alert. Used by the Python AI engine server-to-server, by the **Security Camera page** in the browser, and by a logged-in FM/Staff user for a manual test alert. |
| **Auth** | `verifyServiceOrRole('FM','Staff')` — **either** header `x-service-key: <AI_SERVICE_KEY>` **or** a valid FM/Staff JWT |
| **Headers** | `x-service-key: <value>` **or** `Authorization: Bearer <token>`; `Content-Type: application/json` |
| **Source** | lines 202-377 |

**Request-body fields**

| Field | Type | Required | Notes |
|---|---|---|---|
| `zone_name` | string | Yes | Trimmed, max 255 |
| `camera_location` | string | Yes | Trimmed, max 255 |
| `status` | string | No | One of `Active`, `Acknowledged`, `Investigating`, `Dispatched`, `Escalated`, `Cleared` (default `Active`) |
| `object_class` | string | No | Max 100; **defaults to `"package-like object"`** |
| `duration_seconds` | number | No | Non-negative integer or `null` |
| `person_name` | string | No | Max 255 |
| `identity_status` | string | No | Max 50 — e.g. `SUSPICIOUS`, `SUSPENDED`. Not a column; folded into `sensor_metadata` and used for default severity |
| `person_role` | string | No | Max 100 — same handling as `identity_status` |
| `alert_type` | string | No | Max 100; **defaults to `"Unattended Object"`** |
| `severity` | string | No | One of `Low`, `Medium`, `High`, `Critical`. **No flat default** — see below |
| `source` | string | No | **Whitelisted** — see below |
| `confidence` | number | No | Clamped into `[0, 1]`; non-numeric → `null` (not a 400) |
| `snapshot_url` / `snapshot_path` | string | No | Max 500; either key accepted, `snapshot_path` is a fallback alias |
| `device_id` | string | No | Max 100 |
| `track_id` | number | No | Non-negative integer; folded into `sensor_metadata` |
| `sensor_metadata` | object | No | Stored as-is in the `sensor_metadata` JSON column, enriched with `identity_status` / `person_role` / `track_id` / `person_name` / `cycle_id` when those are sent as top-level fields and not already present |
| `event_id` / `cycle_id` | string | No | Idempotency key — see below. Also read from `sensor_metadata.cycle_id` / `sensor_metadata.inspection_cycle_id` |
| `timestamp` / `occurred_at` | string (ISO date) | No | Either key accepted; invalid dates become `null` |

**`source` is whitelisted, not free text.** `resolveAlertSource()` (line 58) accepts
only `Browser Webcam`, `Uploaded Video`, and `Object Detection`; **anything else
silently becomes `"Object Detection"`** rather than returning an error. This is
deliberate: it stops a caller on this route from setting
`source: "SecurePi Edge Node"` and having an alert masquerade as edge-ingested.

**Default severity is type-aware, not a flat `High`.** When `severity` is omitted,
`defaultSeverityForType(alert_type, duration_seconds, identity_status, person_name)`
(line 16) decides:

| `alert_type` (normalised) | Default severity |
|---|---|
| `PEST_DETECTION` | `High` |
| `RESTRICTED_MOTION` / `RESTRICTED_ZONE_MOTION` | `Critical` if `identity_status` is `SUSPICIOUS`/`SUSPENDED` or the person is `UNKNOWN`; otherwise `High` |
| `FORGOTTEN_BELONGING` | `High` if `duration_seconds ≥ 300`, else `Medium` |
| `ITEM_PICKED_UP` / `ITEM_SET_DOWN` / `ITEM_MOVEMENT` | `Medium` |
| `UNATTENDED_OBJECT` and everything else | Duration-based: `<120s → Low`, `<300s → Medium`, `<600s → High`, `≥600s → Critical` |

(The model's own column default is still `High`, but the route always supplies a
resolved value, so that default is never what a created alert receives.)

**Idempotency — 200 instead of 201.** If `event_id` / `cycle_id` (or the equivalent
key inside `sensor_metadata`) matches an existing alert's `edge_event_id`, the route
returns **`200` with the existing alert** and creates nothing. The Security Camera
page sends its inspection `cycle_id` as `event_id`, so a re-fired cycle can never
duplicate an alert.

**Success — 201:** created alert object with `incident_log_id`. The route creates
the alert and its mapped `IncidentLog` **atomically**, then links them; a failure
rolls the transaction back and returns 500. The incident type is chosen by
`resolveIncidentType()` — see §3.9.

**WhatsApp side effect.** After the transaction commits, if
`WHATSAPP_DETECTION_ALERTS_ENABLED=true` the route attempts a security WhatsApp and
stamps `whatsapp_status` / `whatsapp_sent_at` / `whatsapp_error` on the alert — see
§3.10. A WhatsApp failure never fails the 201.

**Errors:** 400 (`zone_name`/`camera_location` missing, invalid `status`, invalid
`severity`), 401 (no service key and no/invalid JWT), 403 (JWT valid but role not
FM/Staff), 500.

#### PUT `/api/detection-alerts/:id`

| | |
|---|---|
| **Purpose** | Update an alert's workflow fields — the endpoint behind the Acknowledge / Mark Investigating / Escalate / Mark Resolved-Cleared buttons. |
| **Auth / Roles** | JWT, FM or Staff |
| **Path params** | `id` — alert's numeric primary key |
| **Source** | lines 393-434 |

**Request-body fields** — `UPDATABLE_FIELDS` is a strict allow-list (line 379):

| Field | Type | Required | Validation |
|---|---|---|---|
| `status` | string | No | Must be one of `Active`, `Acknowledged`, `Investigating`, `Dispatched`, `Escalated`, `Cleared` if provided |
| `severity` | string | No | Must be one of `Low`, `Medium`, `High`, `Critical` if provided |
| `person_name` | string \| null | No | Trimmed, max 255 |

**Any other key in the body is rejected** with **400**
`{ "error": "Unsupported field(s): <keys>. Updatable fields are: status, severity, person_name." }`
— a partial update is not a free-form patch.

**Incident mirroring.** Inside one transaction the route also updates the linked
`IncidentLog` (when `incident_log_id` is set), so both dashboards agree:

| Alert `status` | Incident `resolutionStatus` |
|---|---|
| `Active`, `Acknowledged` | `Active` |
| `Investigating`, `Dispatched` | `Investigating` |
| `Escalated` | `Escalated to Security` |
| `Cleared` | `Cleared` |

`severity` and `person_name` are mirrored verbatim. Alerts predating incident
linking simply skip this step.

**Example request**
```
PUT /api/detection-alerts/42
Authorization: Bearer <accessToken>
Content-Type: application/json

{ "status": "Acknowledged" }
```

**Success — 200:** updated alert object.
**Errors:** 400 (invalid value, or unsupported field), 401, 403 (Tenant role), 404
(`sendStatus`, no JSON body — including non-numeric `id`), 500.

> **Frontend↔backend behaviour note:** `handleAcknowledgeAlert`,
> `handleInvestigateAlert`, `handleEscalateAlert`, and `handleClearAlert` in
> `ObjectDetection.jsx` all funnel into this single PUT endpoint with different
> `status` values — there is no dedicated "acknowledge"/"escalate" route. The page
> also has a bulk "clear all" action that issues one PUT per open alert.

#### DELETE `/api/detection-alerts/:id`

| | |
|---|---|
| **Purpose** | False-alarm removal. |
| **Auth / Roles** | JWT, **FM only** — the one endpoint in this feature where Staff is denied but FM is allowed |
| **Source** | lines 436-456 |

Inside one transaction the route soft-deletes the linked `IncidentLog` (so it stops
showing as an active incident, exactly as the incident dashboard's own delete does)
and then soft-deletes the alert. Both models are `paranoid: true`, so the audit rows
survive with `deletedAt` set. The stored snapshot object is **not** deleted here —
it is cleaned up by the retention job (§3.11).

> **Not currently called from any frontend page.** No `axios.delete` against this
> URL exists anywhere in `client/src`. The endpoint is implemented, role-gated, and
> reachable, but the false-alarm removal flow has no UI yet — see §7.9.

**Success — 200:** empty body. **Errors:** 401, 403 (Staff or Tenant), 404
(`sendStatus`, empty body), 500.

---

### 3.8 SecurePi Edge Ingest — POST `/api/edge/detection-alerts`

This is the endpoint the SecurePi detection runtime calls to report a detection. It
is a distinct route from §3.7's `/api/detection-alerts` and uses a different
authentication mechanism (a static bearer token instead of a user JWT or service key).

**Mounting.** In `server/index.js`:
```js
const edgeDetectionAlertsRoute = require('./routes/edgeDetectionAlerts');
app.use("/api/edge", edgeDetectionAlertsRoute);
```
and inside `server/routes/edgeDetectionAlerts.js`:
```js
router.post('/detection-alerts', verifyEdgeIngestToken, handleSnapshotUpload, async (req, res) => { ... });
```
so the full path is `/api/edge` + `/detection-alerts` = **`/api/edge/detection-alerts`**.

**Authentication.** A hand-rolled middleware (`verifyEdgeIngestToken`, lines 246-256)
— *not* the shared `verifyToken`/`requireRole` middleware used elsewhere:
- Reads `Authorization: Bearer <token>`.
- If `process.env.EDGE_INGEST_TOKEN` is unset on the server → **503** (edge ingest
  not configured), even before checking the caller's token.
- If the token is missing or does not exactly match `EDGE_INGEST_TOKEN` → **401**.
- Otherwise → `next()`.

There is no role concept here (no FM/Staff/Tenant) — it is a single shared secret
for the trusted device, stored in `EDGE_INGEST_TOKEN` (see `server/.env.example`).

| | |
|---|---|
| **Method** | POST |
| **Full route** | `/api/edge/detection-alerts` |
| **Purpose** | Accept a detection alert (optionally with JPEG evidence) pushed by the SecurePi edge node and persist it as a `DetectionAlert` row. |
| **Auth type** | Static bearer token (`EDGE_INGEST_TOKEN`), not a user JWT |
| **Authorised roles** | N/A — device-level trust, no user role check |
| **Required headers** | `Authorization: Bearer <EDGE_INGEST_TOKEN>`; `Content-Type: application/json` **or** `multipart/form-data` |
| **Path params** | none |
| **Query params** | none |
| **Source** | `server/routes/edgeDetectionAlerts.js` |

**Request-body fields**

| Field | Type | Required | Default if omitted | Validation |
|---|---|---|---|---|
| `zone_name` | string | **Yes** | — | Non-empty after trim, max 255 chars → 400 if missing |
| `camera_location` | string | **Yes** | — | Non-empty after trim, max 255 chars → 400 if missing |
| `event_id` | string | No | `null` | Idempotency key. Must match `/^[A-Za-z0-9._:-]{1,255}$/` → **400 `"event_id is malformed."`** |
| `status` | string | No | `"Active"` | Must be one of `Active`, `Acknowledged`, `Investigating`, `Dispatched`, `Escalated`, `Cleared` if provided |
| `object_class` | string | No | `"package-like object"` | Max 100 chars |
| `duration_seconds` | number | No | `null` | Coerced to a non-negative integer; invalid values become `null` |
| `person_name` | string | No | `null` | Max 255 chars |
| `identity_status` | string | No | `null` | Max 50; folded into `sensor_metadata`, feeds default severity |
| `person_role` | string | No | `null` | Max 100; folded into `sensor_metadata` |
| `alert_type` | string | No | `"Unattended Object"` | Max 100 chars |
| `severity` | string | No | type-aware (see below) | Must be one of `Low`, `Medium`, `High`, `Critical` if provided |
| `confidence` | number | No | `null` | Clamped into `[0, 1]` |
| `snapshot_path` | string | No | `null` | The device's **local** path. Recorded in the notification payload only; never stored in `snapshot_url` and never rendered as a link |
| `device_id` | string | No | `null` | Max 100 chars |
| `track_id` | number | No | `null` | Non-negative integer; folded into `sensor_metadata` |
| `sensor_metadata` | object | No | `null` | Stored in the `sensor_metadata` JSON column |
| `timestamp` / `occurred_at` | string (ISO 8601) | No | **server receipt time** | Either key accepted; invalid/unparseable dates fall back to `new Date()` so an edge alert always has an event time to sort by |
| `snapshot` | file (multipart) | No | — | JPEG evidence — see below |

**`source` is not accepted.** This route is only reachable with a valid
`EDGE_INGEST_TOKEN`, so the source is always the authenticated SecurePi device.
A `source` field in the body is **ignored**, and the row is always written with
`source: "SecurePi Edge Node"` (line 382).

Any other field sent in the body is silently dropped — the route destructures only
the fields above before calling `DetectionAlert.create()`.

**Default severity.** Identical to §3.7: `defaultSeverityForType()` applies only
when the device did not send an explicit `severity`.

**Snapshot upload (multipart).** The route accepts an optional `snapshot` file part
handled by `multer` in memory:

- MIME type must be `image/jpeg` / `image/jpg`.
- The multipart filename must end in `.jpg`/`.jpeg` and must contain no path
  syntax — checked against the raw value **and** up to three URL-decodings, so
  `%2e%2e%2f` style traversal is rejected. (The filename is metadata only and never
  becomes a storage path; it is validated anyway, before the bytes are accepted.)
- Size limit: `DETECTION_SNAPSHOT_MAX_BYTES`, default **5 MiB**.
- The buffer must start `FF D8` and end `FF D9` — real JPEG magic bytes, not just a
  claimed MIME type.

On success the server generates its **own** UUID filename, stores the bytes (§3.12),
and sets `snapshot_url` to `/api/detection-alerts/<id>/snapshot/<uuid>.jpg`.
Snapshot persistence happens **after** the alert transaction commits, so a storage
failure is logged but does not turn a successful ingest into a retryable 500 —
the alert is still created and returned.

Upload rejections all return **400**:
`"snapshot must be a JPEG image."`, `"snapshot filename is invalid."`,
`"snapshot filename must use a .jpg or .jpeg extension."`,
`"snapshot exceeds the configured maximum size."`,
`"snapshot content is not a valid JPEG image."`, or the generic
`"snapshot upload is invalid."`.

**Idempotency — duplicates return 200, not 201.** `edge_event_id` is a **unique**
column. SecurePi sends the same deterministic `event_id`
(`"<device>:<type>:<track>:<timestamp>"`) when it retries over flaky Wi-Fi:

- A pre-check looks the event up before doing any work.
- If two requests race, the loser hits the unique index; the route catches the
  constraint violation and recovers the winner's row instead of returning 500.
- Either way the response is **200** with the existing alert plus a
  `whatsapp: { duplicate: true, resent: <bool>, status: ... }` object. No second
  alert, no second incident, and no duplicate WhatsApp.
- **If the duplicate carries new JPEG evidence**, the existing alert's
  `snapshot_url` and `occurred_at` are refreshed (and the superseded object
  deleted) — `createdAt` is untouched.
- The one case that *does* re-send WhatsApp is a duplicate whose stored
  `whatsapp_status` is `Failed` and whose severity still passes the gate; it is
  retried and returned with `resent: true`.

**Zone/camera enrichment.** After validation, `resolveLinks()` best-effort looks up
a `MonitoringZone` by exact `zone_name` and a `Camera` by `camera_name` OR
`location` matching `camera_location`, and adds `zone_id`/`camera_id` to the created
row if found. It also reads the zone's `detection_type` (returned separately, never
spread into `DetectionAlert.create()` — the model has no such column) so the
incident bridge can use it without a second query. A lookup failure is swallowed and
never blocks alert creation.

**Example request (JSON)**
```
POST /api/edge/detection-alerts
Authorization: Bearer <EDGE_INGEST_TOKEN>
Content-Type: application/json

{
  "event_id": "securepi-01:unattended:7:1783094400",
  "alert_type": "Unattended Object",
  "object_class": "bag",
  "zone_name": "Loading Bay",
  "camera_location": "Loading Bay Camera 01",
  "duration_seconds": 15,
  "severity": "High",
  "status": "Active",
  "confidence": 0.91,
  "device_id": "securepi-loading-bay-01",
  "occurred_at": "2026-07-11T10:00:00.000Z"
}
```

**Example request (multipart, with evidence)**
```
POST /api/edge/detection-alerts
Authorization: Bearer <EDGE_INGEST_TOKEN>
Content-Type: multipart/form-data; boundary=----edge

------edge
Content-Disposition: form-data; name="event_id"

securepi-01:unattended:7:1783094400
------edge
Content-Disposition: form-data; name="zone_name"

Loading Bay
------edge
Content-Disposition: form-data; name="camera_location"

Loading Bay Camera 01
------edge
Content-Disposition: form-data; name="snapshot"; filename="event.jpg"
Content-Type: image/jpeg

<JPEG bytes>
------edge--
```

**Success response**

- **Status:** `201 Created` (new alert) or `200 OK` (duplicate `event_id`)
- **Body:** the `DetectionAlert` serialized to JSON, plus a top-level `whatsapp`
  object describing the notification outcome:
```json
{
  "id": 57,
  "zone_name": "Loading Bay",
  "camera_location": "Loading Bay Camera 01",
  "status": "Active",
  "object_class": "bag",
  "duration_seconds": 15,
  "person_name": null,
  "alert_type": "Unattended Object",
  "severity": "High",
  "source": "SecurePi Edge Node",
  "confidence": 0.91,
  "snapshot_url": "/api/detection-alerts/57/snapshot/6f1c2b7e-6c1e-4a3f-9b2d-77c4a1e0f9aa.jpg",
  "device_id": "securepi-loading-bay-01",
  "sensor_metadata": { "pir": true, "distance_cm": 42.5 },
  "edge_event_id": "securepi-01:unattended:7:1783094400",
  "whatsapp_status": "Sent",
  "whatsapp_sent_at": "2026-07-11T10:00:02.000Z",
  "whatsapp_error": null,
  "occurred_at": "2026-07-11T10:00:00.000Z",
  "camera_id": 5,
  "zone_id": 3,
  "incident_log_id": 88,
  "createdAt": "2026-07-11T10:00:01.000Z",
  "updatedAt": "2026-07-11T10:00:02.000Z",
  "whatsapp": { "status": "Sent", "recipientCount": 2, "error": null, "sent_at": "2026-07-11T10:00:02.000Z" }
}
```

**Error responses**

| Status | Condition | Example body |
|---|---|---|
| 400 | `zone_name`/`camera_location` missing; invalid `status`/`severity`; malformed `event_id`; any snapshot-upload rejection | `{ "error": "zone_name and camera_location are required." }` |
| 401 | No/blank bearer token, or token does not match `EDGE_INGEST_TOKEN` | `{ "error": "Invalid edge ingest token." }` |
| 429 | `aiProxyLimiter` exceeded (§3.0) | `{ "message": "Too many requests. Please try again later." }` |
| 503 | `EDGE_INGEST_TOKEN` is not set in the server's environment (feature not configured) | `{ "error": "Edge ingest is not configured." }` |
| 500 | Unexpected error (e.g. DB write failure) | Sanitised body from `sendUnexpectedError` |

Confirmed by `server/tests/Tan Yu En, Charlisa/edge-detection-alerts.test.js`.

**How the alert is stored.** `DetectionAlert.create()` writes a row to the
`detection_alerts` table (model is `paranoid: true`, i.e. soft-deletable). This is
the **same table and model** used by `/api/detection-alerts` — the two routes are
two different front doors (device token vs. user JWT/service key) into one
underlying alert store. Alerts created here are picked up by the Object Detection
page's `GET /api/detection-alerts` polling exactly like AI-engine-created alerts.

---

### 3.9 Alert → Incident bridging

Both create routes build an `IncidentLog` alongside the alert, in the same
transaction. The incident **type** (stored, confusingly, in `IncidentLog.status` —
`resolutionStatus` holds the workflow state) is chosen by `resolveIncidentType()`
in `server/utils/detectionAlertBridge.js`:

1. If the resolved zone has an explicit `detection_type`, its mapping wins:
   `unattended_object → UNATTENDED_OBJECT`, `crowd_density → OVERCROWDING`,
   `unauthorized_access → UNAUTHORIZED_ACCESS`.
2. Otherwise the alert's `alert_type` + `object_class` text is matched, **most
   specific first**: unauthorized → pest (`rat`/`mouse`/`mice`/`rodent`/`pest` as
   whole words) → restricted-zone/after-hours/night motion → forgotten belonging →
   item picked up/set down/moved → person/crowd → `UNATTENDED_OBJECT` as the default.

The order is deliberate: a pest sighting or after-hours motion event must never be
mislabelled `OVERCROWDING` or collapsed into `UNATTENDED_OBJECT`.

`server/config/detectionTypes.js` is the single backend source of truth for these
values. The client keeps a hand-synced copy in
`client/src/pages/detectionSettingsPayload.js` because browser bundles cannot import
server modules.

---

### 3.10 WhatsApp security notifications

Both alert-create routes can dispatch a WhatsApp message to security staff via
`server/services/whatsappService.js`, and record the outcome on the alert.

**Gate** (all must pass, else no send is attempted):
- `WHATSAPP_DETECTION_ALERTS_ENABLED === 'true'` (master switch for detection alerts)
- `WHATSAPP_SECURITY_RECIPIENTS` resolves to at least one number
- the alert's severity meets `WHATSAPP_DETECTION_MIN_SEVERITY` (`Low < Medium < High < Critical`)

`WHATSAPP_ENABLED` separately governs mock vs. real delivery — `false` produces a
**simulated** send, which is the safe demo default.

**`whatsapp_status` values** (plain string column, not a DB enum, so the set can
grow without a migration):

| Value | Meaning |
|---|---|
| `Not Requested` | The master switch is off |
| `Pending` | Stamped inside the edge route's transaction before the send is attempted, so a concurrent duplicate never starts a second send |
| `Sent` | Delivered to at least one recipient |
| `Simulated` | `WHATSAPP_ENABLED=false` — message built and logged, not delivered |
| `Skipped` | No recipients configured, or below the minimum severity |
| `Failed` | Delivery raised or returned an error; `whatsapp_error` holds up to 500 chars of detail |

Notification failures are **never** allowed to fail the request or roll back the
alert — WhatsApp is attempted post-commit and every persistence step is wrapped so a
DB hiccup while stamping status cannot break the response. The public `whatsapp`
object in the edge response deliberately carries a generic
`"Notification delivery failed."` string rather than the provider's error text, and
never includes phone numbers or tokens.

---

### 3.11 Detection alert retention (background job)

Implemented in `server/services/detectionAlertRetention.js` as
`createDetectionAlertRetentionTask({ DetectionAlert, Op })`, attached to the router
as `detectionAlertsRoute.retentionTask`, and started by `server/index.js` **only
after database initialization succeeds** (it is also stopped on graceful shutdown —
constructing the route must never start process handles).

- First run 20 s after start-up, then every 24 h.
- Deletes alerts whose `createdAt` is older than **30 days**.
- For each stale alert it first deletes the stored snapshot object, then
  `DetectionAlert.destroy({ ..., force: true })` — a **hard** delete that bypasses
  the paranoid soft-delete.
- Any error is logged and swallowed; retention is maintenance work and never
  affects request handling or readiness.

---

### 3.12 Snapshot storage (`server/utils/detectionSnapshotStorage.js`)

Snapshot bytes are stored by the backend, never by the client, and are only ever
read back through the authenticated endpoint in §3.7.

| Mode | Trigger | Location |
|---|---|---|
| **Google Cloud Storage** | `DETECTION_SNAPSHOT_BUCKET` set | `gs://<bucket>/<DETECTION_SNAPSHOT_PREFIX>/<uuid>.jpg` — a **private** bucket; no public or signed URL is ever generated |
| **Local disk** | bucket unset (dev/test default) | `DETECTION_SNAPSHOT_DIR`, else `<os.tmpdir()>/flowguard/detection-snapshots`; directory `0700`, files opened `wx` with mode `0600` |

Filenames are always server-generated v4 UUIDs (`GENERATED_SNAPSHOT_RE`) and are
re-validated on every save/read/delete. The local path resolver additionally
verifies the resolved path stays under the snapshot root, so no client value can
escape the directory.

---

## 4. Authenticated Node proxies to the private AI service

`ai-service/main.py` is a separate FastAPI process (default `FACE_AI_URL` is
`http://127.0.0.1:8501` locally, private Cloud Run in deployment). Browser calls go
to Node `/api/yolo/*`, which requires an FM/Staff JWT and adds the Google ID token
plus the service key when calling FastAPI.

### GET `/api/yolo/people-count` → private FastAPI `/api/yolo/people-count`
| | |
|---|---|
| **Purpose** | Poll the current people count from the AI service's background YOLO detection loop. |
| **Auth** | FlowGuard JWT; FM or Staff. Private FastAPI credentials are added by Node. |
| **Used by** | `ObjectDetection.jsx` — polled every 5 seconds (`fetchPeopleCount`) |
| **Source** | `server/routes/yolo.js:48-60` |

**Success — 200** (Node normalises the upstream reply to exactly these three keys)
```json
{ "count": 2, "detection_active": true, "camera_status": "browser_camera" }
```
The frontend treats any request failure (including a timeout) as "AI Engine:
Offline" after 3 consecutive failures.

### POST `/api/yolo/analyze-frame` → private FastAPI `/api/yolo/analyze-frame`
| | |
|---|---|
| **Purpose** | Analyze a single frame captured from the browser camera, a Pi snapshot, or an uploaded video file and return YOLO detections for overlay boxes. |
| **Auth** | FlowGuard JWT; FM or Staff. |
| **Body** | `{ "image": "data:image/jpeg;base64,...", "source": "Uploaded Video", "camera_id": 7, "zone_id": 3 }`. `image` is required; JPEG, PNG, and WebP data URLs are accepted up to 8 MiB. The IDs are optional positive integers. Only these four keys are forwarded upstream. |
| **Used by** | `ObjectDetection.jsx` — every ~2.2 s while `sourceMode` is `camera` or `file`; `CameraFeed.jsx` — every 1.8 s for local-video tiles; `SecurityCamera.jsx` — during an inspection cycle |
| **Source** | Node contract: `server/routes/yolo.js:65-95`; private inference: `ai-service/main.py` |

**Success — 200**
```json
{
  "count": 2,
  "detections": [
    { "label": "person", "box": [120, 40, 300, 480], "status": "normal", "confidence": 0.91, "type": "person" }
  ],
  "frame_width": 960,
  "frame_height": 540,
  "detection_active": true,
  "camera_status": "browser_camera"
}
```
**Errors:** Node returns `400` `{ "error": "..." }` for a missing/malformed or
unsupported data URL and for non-positive `camera_id`/`zone_id`, `401`/`403` for
JWT/RBAC failure, `413` for an image over 8 MiB, `429` for the AI-proxy rate
limit, `502` for an upstream error, and `503` when the private AI service is
offline. The browser never calls this private FastAPI route directly.

**Frontend↔backend behaviour:** the browser calls same-origin `/api/yolo/*`.
Vite proxies `/api` to Node in development, while the production client container
proxies `/api/*` to the configured Node service. Node then calls private FastAPI;
there is no browser `/ai/*` dependency.

---

## 5. SecurePi Device Endpoints (Raspberry Pi service, not FlowGuard endpoints)

These are **not** FlowGuard REST endpoints — they run on the Raspberry Pi itself
(`raspberry-pi4/pi_camera_steam.py`, a Flask app on **port 8081**) and are reached
directly by the browser over the LAN/hotspot, completely bypassing the Node backend
and any FlowGuard authentication. They exist in this documentation only because the
"SecurePi Hardware" source mode calls them directly.

> **Deployment note.** Two separate Pi components exist, and neither is a drop-in
> replacement for the other. `raspberry-pi4/pi_camera_steam.py` (in this repo) is
> the **camera/sensor** service documented below; it streams video and reports
> sensor state but does **not** post alerts. The **detection runtime** that performs
> on-device inference and POSTs to `/api/edge/detection-alerts` (§3.8) is deployed
> separately on the device and is **not checked into this repository** — earlier
> revisions of this document referenced `edge/securepi/securepi_edge.py` and
> `edge/securepi/upstream/securePi.py`, which no longer exist here. A deployment
> that needs both live stream and edge alerts must run both components.

The frontend resolves stream and derived endpoint URLs via
`client/src/utils/securepiStream.js`. **Resolution order** (`getHardwareStreamUrl`):

1. A per-camera browser-local override in `localStorage`
   (`flowguard.securepiStreamUrl.<cameraId>`) — lets different hotspot users resolve
   the same inventory camera without changing cloud data
2. The selected Camera Inventory record's `stream_url`
3. `VITE_SECUREPI_STREAM_URL` (development fallback)

Every candidate passes `validateSecurePiStreamUrl()`, which requires an absolute
`http:`/`https:` URL and rejects embedded credentials, URL fragments, and any query
key that looks like a secret (`token`, `api_key`, `auth`, `jwt`, `password`, …).
`/health`, `/sensor_status`, `/people-count`, and `/snapshot` URLs are then derived
from that URL's **origin**, so the configured port is always honoured — do not
assume a fixed port.

### GET `http://<pi-ip>:8081/health`
| | |
|---|---|
| **Purpose** | Camera + sensor health/telemetry for the SecurePi service. |
| **Auth** | None |
| **Used by** | `ObjectDetection.jsx` / `SecurityCamera.jsx`, polled every **5 seconds** (`SECUREPI_POLL_MS`) while SecurePi Hardware mode is active; drives the "SECUREPI EDGE LIVE" / "CONNECTING" / offline banner |
| **URL resolution** | `getHardwareHealthUrl()`: prefers `VITE_SECUREPI_HEALTH_URL`, else derives `<stream origin>/health` |

**Response — 200** (operational telemetry only; never image data)
```json
{
  "status": "ok",
  "camera": "Pi Camera Module 3",
  "camera_description": "Pi Camera Module 3 + Arduino PIR/ultrasonic",
  "device_id": "flowguard-pi-camera",
  "zone": "Loading Bay",
  "streaming": true,
  "detection_active": false,
  "targetFps": 15,
  "frameAgeMs": 120,
  "latest_frame_age_seconds": 0.12,
  "sequence": 4821,
  "sensor": { "connected": true, "pir": false, "distance_cm": 88.0, "inspection_active": false }
}
```

Unlike earlier revisions, the frontend **does** inspect this body:
`normalizeHealth()` requires `status` to be one of
`ok|online|healthy|connected|degraded|stale`, type-checks `detection_active` /
`streaming`, and returns `invalid-response` otherwise. A frame older than
`SECUREPI_STALE_FRAME_SECONDS` (10 s) — or `status: "stale"`/`"degraded"`, or
`streaming: false` — downgrades the connection to **stale** rather than connected.
`testSecurePiConnection()` classifies failures into `timeout`, `unreachable`,
`permission-required` (browser local-network permission), `invalid-response`,
`invalid-url`, and `aborted`.

### GET `http://<pi-ip>:8081/sensor_status`
| | |
|---|---|
| **Purpose** | PIR / ultrasonic sensor state from `raspberry-pi4/sensor_bridge.py` (Arduino over serial, `EDGE_SERIAL_PORT`, default `/dev/ttyACM0`). |
| **Auth** | None |
| **Used by** | The Security Camera inspection workflow; also probed as a fallback when `/health` carries no embedded `sensor` block |
| **Response** | `connected`, `pir`/`motion`, `pir_ready`, `distance_cm`, `baseline_distance_cm`, `distance_change_cm`, `object_close`, `trigger`, `inspection_active`, `inspection_remaining_seconds`, `after_hours`, `inspection_id`/`inspection_cycle_id` — normalised by `normalizeSensorStatus()` |
| **Errors** | **503** `{ "connected": false, "inspection_active": false, "last_error": "Sensor bridge disabled" }` when the bridge is not running. `404`/`405`/`501` are treated by the client as "endpoint not supported", not as a failure. |

### GET `http://<pi-ip>:8081/video_feed`
| | |
|---|---|
| **Purpose** | Live MJPEG video stream from the Pi's camera. |
| **Auth** | None |
| **Used by** | `ObjectDetection.jsx` / `SecurityCamera.jsx` — rendered directly via `<img src={hardwareStreamUrl}>` |
| **Response type** | `multipart/x-mixed-replace; boundary=frame` — **not** a JSON REST response. The browser's `<img>` tag natively decodes this as a continuously-updating image; there is no request/response cycle to document in JSON terms, and it must not be modeled as a normal OpenAPI JSON response. |
| **Network assumption** | Works only when the browser and the Pi are on the same LAN/hotspot network — this is the current prototype's networking model, not a general-purpose internet-facing stream. |

### GET `http://<pi-ip>:8081/snapshot`
| | |
|---|---|
| **Purpose** | One JPEG frame from the same in-memory cache the stream serves (frames never touch the Pi's disk). |
| **Auth** | None |
| **Response** | `image/jpeg`, or **503** `"Camera warming up — no frame available yet"` before the first frame is captured |

---

## 6. Authentication Summary

| Mechanism | Header | Used for | Verified against |
|---|---|---|---|
| User JWT | `Authorization: Bearer <token>` | `/api/zones`, `/api/cameras`, `/api/detection-alerts` (all verbs; POST as a fallback) | `APP_SECRET`; DB re-check of `User` row + `tokenVersion` on every request (`verifyToken`) |
| AI-service shared key | `x-service-key: <value>` | `POST /api/detection-alerts` (service path); also exempts the caller from rate limiting | `process.env.AI_SERVICE_KEY` |
| Edge device bearer token | `Authorization: Bearer <value>` | `POST /api/edge/detection-alerts` | `process.env.EDGE_INGEST_TOKEN` (separate secret from `AI_SERVICE_KEY` and from user JWTs) |
| Node AI proxy | JWT plus server-side Google ID token/service key | Browser `/api/yolo/*` → private FastAPI | JWT/RBAC at Node; IAM and app key at AI service |
| None | — | LAN-only SecurePi `/health`, `/sensor_status`, `/video_feed`, `/snapshot` | No application credential; PoC network limitation |

Role gate (`requireRole`, applies only after a JWT is verified):

| Role | Zones | Cameras | Detection Alerts |
|---|---|---|---|
| FM | Full CRUD | Full CRUD | View, create, update, **delete** |
| Staff | **View only** (403 on POST/PUT/DELETE) | **View only** (403 on POST/PUT/DELETE) | View, create, update — **403 on delete** |
| Tenant | 403 on all zone/camera/alert routes | 403 | 403 |

---

## 7. Implementation Inconsistencies & Notes

1. **Two different bodies of auth exist for creating alerts** — a shared service
   key (`AI_SERVICE_KEY`) for `/api/detection-alerts` and a separate bearer token
   (`EDGE_INGEST_TOKEN`) for `/api/edge/detection-alerts`. They are deliberately
   kept independent per the comments in `server/.env.example`; a caller with only
   an edge token cannot use the service-key path and vice versa (confirmed by test:
   reusing an edge token on `/api/detection-alerts` yields 403, not 201).
2. **`source` is trusted differently on the two ingest paths.** The edge route
   ignores it entirely and hardcodes `"SecurePi Edge Node"`; the standard route
   whitelists three browser/AI values and silently downgrades anything else. Between
   them, no caller can forge an edge-origin alert — but the *silent* downgrade means
   a typo'd `source` is accepted with the wrong value rather than rejected.
3. **The browser does not call the AI service directly.** Node applies JWT/RBAC and
   private-service credentials. SecurePi stream/health/sensor endpoints remain
   unauthenticated LAN PoC surfaces and require a secure relay/auth layer before
   internet exposure. Note the contrast with detection **snapshots**, which are now
   fully authenticated (§3.7) even though the live stream they came from is not.
4. **Error response shape is inconsistent across systems**: the Node backend
   returns `{ "error": "..." }` (mostly), `{ "message": "..." }` (auth middleware
   and the 429 handler specifically), the AI Service (FastAPI) returns
   `{ "detail": "..." }`, and several Node routes on 404 use `res.sendStatus(404)`
   with **no JSON body at all** (`GET/PUT/DELETE /api/zones/:id`, `GET/PUT/DELETE
   /api/detection-alerts/:id`, and the snapshot route). Frontend error handling
   should not assume a single error envelope.
5. **`GET /api/edge/detection-alerts` does not exist.** Only `POST` is defined on
   that router; SecurePi alerts are read back by FM/Staff through
   `GET /api/detection-alerts` (the shared alert list), not through a
   `/api/edge/...` read path.
6. **Two near-duplicate implementations** of `resolveLinks()`, `defaultSeverityForType()`,
   `parseConfidence()`, `parseOccurredAt()`, and the validation constants exist in
   `detectionAlerts.js` and `edgeDetectionAlerts.js`. They agree today, but nothing
   structurally prevents them from drifting apart.
7. **`POST /api/detection-alerts` has three distinct callers with different needs** —
   the AI engine (service key), `SecurityCamera.jsx` in the browser (user JWT, sends
   `cycle_id` for idempotency and a rich `sensor_metadata` object), and manual test
   alerts. `ObjectDetection.jsx` still never POSTs; it only reads and updates.
8. **Rate limiting is per-process** (in-memory store), so on an autoscaled Cloud Run
   deployment the effective limit is per-instance rather than global.
9. **`DELETE /api/detection-alerts/:id` has no frontend caller.** It is fully
   implemented and is the only FM-exclusive operation in this feature, but no page
   in `client/src` issues the request — false-alarm removal is currently reachable
   only through the API directly. Flagged so it isn't mistaken for dead code: it has
   a documented purpose and a distinct role gate, it just isn't wired into a UI yet.

---

## 8. Endpoints Explicitly Out of Scope / Excluded

The following were found in the codebase during inspection but are excluded from
this document because they are not part of the Object Detection / SecurePi
integration feature per the requested scope:

- `POST /api/incident`, `GET /api/incident`, `PATCH /api/incident/:id`, `DELETE
  /api/incident/:id`, `POST /api/incident/scan-frame` (`server/routes/incident.js`)
  — this is the **Facial Recognition / Incident Dashboard** module. It is only
  related to Object Detection through atomic linked incident creation and
  bidirectional status/severity/person/delete synchronisation. The Object Detection
  page itself does not call `/api/incident/*`.
- `/api/facial-recognition/*`, `/api/attendance/*`, `/api/bookings/*`,
  `/api/security/*`, `/api/support/*`, `/api/qr/*`, `/api/dashboard/*`, `/health`,
  `/user/*` — unrelated FlowGuard modules (facial recognition, staff attendance,
  driver/tenant bookings, security logs, support tickets, QR, dashboard summary,
  liveness probes, auth/user management). Note that `/api/dashboard` *does* surface
  camera counts and urgent detection-alert counts, but through its own aggregate
  route rather than the endpoints documented here.
- `GET /ai/api/yolo/stream` (`ai-service/main.py`) — an MJPEG stream endpoint on the
  AI Service, analogous in spirit to SecurePi's `/video_feed` but **not referenced
  by any current frontend page**; an alternative/legacy stream path. Marked here as
  present-but-unused rather than silently omitted.
- `POST /user/recognize`, `POST /api/encode-faces`, `GET /refresh` on the AI
  Service — face-recognition endpoints, unrelated to object detection.
