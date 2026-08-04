# SecurePi → FlowGuard → WhatsApp security-alert integration

How the Raspberry Pi edge monitor delivers detection events to the FlowGuard
backend, which persists them and notifies FM/security staff over the existing
WhatsApp Cloud API integration.

> **Canonical external SecurePi runtime:** https://github.com/charlisaa/updated_securePi_FlowGuard —
> the Raspberry Pi 5 + Sony IMX500 build physically used with this FlowGuard integration. It is
> owned and maintained separately and is neither copied nor deployed from FlowGuard. The
> `edge/…`, `securePi.py`, `sensor_bridge.py`, and `deploy/…` paths shown below illustrate the
> edge-runtime design; the canonical repository is authoritative for the actual runtime layout.
> See the group [SecurePi edge-AI reference](securepi-flowguard-edge-ai.md).

## Architecture

```
IMX500 / PIR+ultrasonic (Arduino)
  → SecurePi edge (securePi.py _fire_alert/_fire_pest_alert, or sensor_bridge.py)
  → edge/flowguard_api.py  (background worker, disk-backed outbox, stable event_id)
  → POST /api/edge/detection-alerts   (Authorization: Bearer <EDGE_INGEST_TOKEN>)
  → FlowGuard backend: DetectionAlert + linked IncidentLog (one DB transaction)
  → AFTER commit: whatsappService.sendDetectionAlert() → WHATSAPP_SECURITY_RECIPIENTS
  → whatsapp_status persisted on the alert
  → Object Detection page + Incident Dashboard
```

**Which repo does what**

| Concern | Owner |
|---|---|
| Runs on the Raspberry Pi | `SecurePi_FlowGuard` (edge runtime) |
| Sends WhatsApp | `FlowGuard` backend **only** (owns credentials, formatting, retries) |
| Database persistence, idempotency, notification status | `FlowGuard` backend |

**The Raspberry Pi never calls WhatsApp.** It only POSTs authenticated events to
FlowGuard. Driver/booking WhatsApp messages (Smart Logistics) and security-alert
messages are built by separate functions and go to different recipients — a driver
phone is never used for a security alert, and a security recipient never receives
booking details.

## Message families are separate

`server/services/whatsappService.js`:

- **Booking (unchanged):** `sendBookingCreated/Confirmed/Arrived/Completed/Cancelled`,
  `sendNextInLine` → sent to `booking.driver_phone`.
- **Security (new):** `buildDetectionAlertMessage` (pure), `resolveDetectionRecipients`,
  `sendDetectionAlertToRecipients`, `sendDetectionAlert` → sent to
  `WHATSAPP_SECURITY_RECIPIENTS`.

Headings by alert type:

| Alert type | Heading |
|---|---|
| Pest Detection | 🚨 FlowGuard Pest Alert |
| Unattended Object | 🚨 FlowGuard Unattended Item Alert |
| Forgotten Belonging | ⚠️ FlowGuard Forgotten Belonging Alert |
| Restricted-Zone Motion | 🚨 FlowGuard Restricted-Zone Motion Alert |
| Item Picked Up / Set Down | ⚠️ FlowGuard Item Movement Alert |
| (unknown) | 🚨 FlowGuard Detection Alert |

Timestamps are always formatted in **Asia/Singapore**. Confidence is shown as a
percentage. Optional fields (duration, device, person, photo) are included only
when present and meaningful (`person_name` = `UNKNOWN` is omitted).

## Environment variables

**FlowGuard backend** (`server/.env.example`):

```
EDGE_INGEST_TOKEN=dev-securepi-token          # edge auth (already present)
WHATSAPP_ENABLED=false                        # false = simulated sends (safe demo)
WHATSAPP_DETECTION_ALERTS_ENABLED=false       # master switch for security alerts
WHATSAPP_SECURITY_RECIPIENTS=6591234567,6598765432   # NEVER commit real numbers
WHATSAPP_DETECTION_MIN_SEVERITY=Low           # Low < Medium < High < Critical
FRONTEND_URL / CLIENT_URL                     # used for the dashboard link
```

**SecurePi edge** (`deploy/securepi.env.example`):

```
FLOWGUARD_EDGE_ENABLED=false
FLOWGUARD_API_URL=https://your-flowguard-server.example
EDGE_INGEST_TOKEN=replace-me                  # must equal the backend value
SECUREPI_DEVICE_ID=securepi-01
SECUREPI_CAMERA_LOCATION=Kitchen Camera 01
SECUREPI_HTTP_TIMEOUT_SEC=5
SECUREPI_RETRY_INTERVAL_SEC=30
SECUREPI_OUTBOX_DIR=/var/lib/securepi/runtime/alerts/outbox
```

## Local simulated-mode end-to-end test

No real WhatsApp, no hardware, no rat required.

1. Backend `.env` (or shell env):

```
WHATSAPP_ENABLED=false
WHATSAPP_DETECTION_ALERTS_ENABLED=true
WHATSAPP_SECURITY_RECIPIENTS=6590000000
WHATSAPP_DETECTION_MIN_SEVERITY=Low
EDGE_INGEST_TOKEN=test-edge-token
```

2. Start the backend, then POST a fake rat event:

```bash
curl -X POST http://localhost:5001/api/edge/detection-alerts \
  -H "Authorization: Bearer test-edge-token" \
  -H "Content-Type: application/json" \
  -d '{
    "event_id":"securepi-test:pest_detection:1:20260729T090000Z",
    "zone_name":"Kitchen",
    "camera_location":"Kitchen Camera 01",
    "alert_type":"Pest Detection",
    "object_class":"rat",
    "severity":"High",
    "confidence":0.92,
    "device_id":"securepi-test",
    "track_id":1,
    "timestamp":"2026-07-29T09:00:00Z"
  }'
```

Expected: **HTTP 201**; a `DetectionAlert` + linked `IncidentLog` created; the
response includes `"whatsapp": { "status": "Simulated" }`; the alert appears on the
Object Detection page. **Repeat the same `event_id`** → **HTTP 200**, no second alert,
no re-send (`"whatsapp": { "duplicate": true, "resent": false }`).

3. SecurePi side, without the camera:

```bash
python edge/send_test_event.py --dry-run --type pest      # print the payload only
# or POST it for real to a running backend:
FLOWGUARD_API_URL=http://localhost:5001 EDGE_INGEST_TOKEN=test-edge-token \
  python edge/send_test_event.py --type pest
```

## Real WhatsApp configuration

Set on the **backend only** (never on the Pi):
`WHATSAPP_ENABLED=true`, `WHATSAPP_API_URL`, `WHATSAPP_ACCESS_TOKEN` (or
`WHATSAPP_API_KEY`), `WHATSAPP_PHONE_NUMBER_ID`, plus
`WHATSAPP_DETECTION_ALERTS_ENABLED=true` and `WHATSAPP_SECURITY_RECIPIENTS`.
Recipients must be WhatsApp-reachable numbers (and, for a Meta test number, added
as allowed recipients).

## Idempotency behaviour

`DetectionAlert.edge_event_id` is unique when non-null (migration
`20260729_edge_idempotency_and_whatsapp.sql`). For a request carrying `event_id`:

- **New id** → create alert + incident, then send.
- **Existing id, status Sent / Simulated / Pending** → return the existing alert
  (HTTP 200), **no** second alert, **no** re-send.
- **Existing id, status Failed** → one controlled retry (no new alert/incident).
- **Malformed id** → HTTP 400.
- **Two simultaneous new requests** → the DB unique index makes one lose; the route
  recovers cleanly and returns the winning row (no duplicate).

Browser/AI-engine alerts leave `edge_event_id` null and are unaffected.

## Offline queue behaviour (SecurePi)

`edge/flowguard_api.py` never blocks the camera loop. Events are written to a
disk-backed outbox (one JSON file per event, atomic temp-file + rename) and sent by
a background worker. On send:

- HTTP 200/201 → removed from the outbox.
- Network error / HTTP 5xx / 408 / 429 → kept, retried periodically and on restart.
- HTTP 401/403 → sending is **halted** (a token/URL fix is needed) — no retry spam.
- HTTP 400/422 → moved to a `dead/` folder (never retried forever).

The queue survives power loss; pending events flush on next startup. The
`event_id` is computed once per occurrence and reused on every retry.

## Sensor bridge (PIR + ultrasonic)

`edge/sensor_bridge.py` is a **separate optional process** that reads the Arduino's
JSON serial lines and raises `RESTRICTED_MOTION` events. It owns only the serial
port (never the camera), so it is safe to run beside `securePi.py`.

- Fires on a motion **transition** (rising edge), not every line.
- Ignored during PIR warm-up.
- Restricted hours in Singapore time, overnight ranges supported (e.g. 22:00–06:00).
- Configurable cooldown between alerts.
- `--dry-run` prints the event without sending.

Config (`deploy/securepi.env.example`): `SENSOR_BRIDGE_ENABLED`,
`SENSOR_SERIAL_PORT` (default `/dev/ttyACM0`), `SENSOR_BAUD_RATE`,
`RESTRICTED_ZONE_NAME`, `RESTRICTED_CAMERA_LOCATION`, `RESTRICTED_HOURS_START/END`,
`MOTION_ALERT_COOLDOWN_SEC`.

### Arduino serial schema

`arduino/FlowGuard_Ardunio.ino` emits one JSON object per line (~2 Hz), no
third-party library:

```json
{"type":"sensor_status","pir_ready":true,"motion":true,"distance_cm":18.4,"object_close":true,"uptime_ms":65432}
```

`distance_cm` is `null` when the ultrasonic gets no echo; `motion` stays `false`
during the 30 s PIR warm-up.

## Systemd

- `deploy/securepi.service` — the camera monitor (unchanged behaviour; the
  FlowGuard variables come from the shared `EnvironmentFile`, so no secret is in
  the unit).
- `deploy/securepi-sensor-bridge.service` — the optional sensor bridge (run-user in
  the `dialout` group for serial access).

## Troubleshooting

- **Alert saved but no WhatsApp** → check `WHATSAPP_DETECTION_ALERTS_ENABLED=true`,
  `WHATSAPP_SECURITY_RECIPIENTS` set, and severity ≥ `WHATSAPP_DETECTION_MIN_SEVERITY`
  (status `Skipped` means one of these gated it).
- **status Failed** → real send attempted but Meta rejected/timed out; the alert is
  still saved. Fix credentials/recipients; a duplicate `event_id` triggers one retry.
- **SecurePi outbox not draining** → 401/403 halts sending; verify
  `EDGE_INGEST_TOKEN` matches and `FLOWGUARD_API_URL` is reachable.
- **Snapshot shows a note instead of a link** → the alert only has a local Pi path
  (see limitations).

## Security considerations

- `EDGE_INGEST_TOKEN` authenticates the edge route; keep the real
  `/etc/securepi/securepi.env` root-owned, mode 0600. It is never a CLI flag and
  never logged.
- WhatsApp credentials live only on the backend. Logs mask tokens and phone numbers.
- The edge route always stamps `source: "SecurePi Edge Node"` and ignores any
  client-supplied `source`.

## Current limitations (do not overclaim)

- **Local snapshot paths are not phone-accessible.** SecurePi snapshots are saved on
  the Pi (`runtime/snapshots/...`). Such a path is **never** rendered as a link in
  WhatsApp or the browser; the message says "Photo captured on edge device; remote
  upload unavailable." **Future work:** upload snapshots to cloud/object storage or
  Meta media before the image itself can be delivered remotely.
- **No same-rat or person re-identification.** Each detection is independent; the
  system does not claim to recognise the *same* rat or person across events.
- **Ultrasonic distance cannot identify an object class.** The PIR/ultrasonic bridge
  reports motion + distance only; it never claims a bag/person, and item
  pick-up/set-down alerts are **not** derived from distance.
