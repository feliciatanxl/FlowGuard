# Backend test cases - Charlisa

Latest focused result on 9 August 2026: **9/9 suites and 238/238 tests passed**. Repository-wide, 51/52 suites and 805/805 tests pass; the one suite that does not run (`tests/gcs-detection-snapshots.test.js`) fails to resolve `@google-cloud/storage`, a declared dependency that is simply not installed in this local checkout — it is an environment gap, not a test failure.

| Area | Representative cases | Expected result |
|---|---|---|
| Camera inventory | FM CRUD, Staff read, Tenant/unauthenticated rejection, validation, soft delete, zone inclusion. | Role-correct 2xx/4xx responses and current Sequelize field names. |
| Monitoring zones/detection setup | Zone CRUD, settings fields/units, camera assignment, one-camera-per-zone conflict from both the zone and camera side, enabled/type serialization, atomic rollback when an assignment fails. | Deterministic settings round-trip and 409 conflict behavior. |
| Detection type | Explicit `detection_type` save/update, unsupported value rejection, and the `unattended_object` fallback when an older row has none. | Category survives a reload instead of being guessed back from severity/density. |
| Alert creation bridge | DetectionAlert and IncidentLog creation in one transaction with `incident_log_id`; incident type resolved from zone category or alert text. | Both records commit together or roll back together, with the correct incident type. |
| Alert ingest idempotency | A repeated `event_id`, `cycle_id`, or `sensor_metadata.cycle_id` re-posts the same detection event; a failing lookup; a first-time event. | The repeat returns 200 with the existing row and opens no transaction; only a genuinely new event creates an alert, incident, or notification. |
| Default severity by alert family | Pest, restricted-zone motion (with and without a suspicious/suspended/unknown identity), forgotten belonging either side of 5 minutes, item movement, and unattended objects across all four duration bands. | Each family gets its documented floor on **both** the alert and the linked incident; an explicit severity always wins. |
| Alert field normalisation | Object class/alert type defaults, confidence clamping, non-numeric confidence, `timestamp` preferred over `occurred_at`, unparseable dates, `snapshot_path` aliasing. | Out-of-range input is normalised rather than rejected, and no route-level default silently changes units. |
| Sensor metadata folding | Identity status, person role, track id, person name, and cycle id folded into the `sensor_metadata` JSON column; pre-existing keys preserved; non-object input ignored. | Edge/browser telemetry is captured without a caller being able to overwrite values it already supplied. |
| Alert lifecycle | Status/severity/person updates, unsupported-field rejection, FM-only delete, clear/false-alarm behavior, soft delete. | Linked incident mirrors supported fields and deletion; unknown fields return 400 instead of being silently dropped. |
| Alert list contract | Ordering by `COALESCE(occurred_at, createdAt)`, the 50-row cap, and the optional exact-match `status` filter. | Alerts rank by when the event happened, not when the row was written. |
| Snapshot evidence | Successful JPEG read, encoded path-traversal filenames, a valid-looking UUID that is not the stored one, an alert with no snapshot, an on-device path, another alert's snapshot, expired storage, and unauthenticated access. | Only the exact file recorded on the authenticated alert is served; every other case is an identical bare 404 that leaks no path or storage detail. |
| Reverse incident sync | Incident resolution/severity/person/delete changes propagate back to the linked alert. | Bidirectional state remains consistent without recursion. |
| Edge ingestion | Service/edge authentication, payload validation, camera/zone resolution, alert mapping. | Trusted callers accepted; missing/invalid credentials and malformed input rejected. |
| Incident integration auth | FM incident operations, Staff/Tenant denial, authenticated service frame scan. | Shared RBAC remains consistent with the frontend. |
| Frame upload security | Multipart image MIME and byte limits. | Only JPEG/PNG/WebP up to 8 MiB; unsupported input returns 415 and oversized input returns 413 before AI forwarding. |

The shared YOLO-proxy suite additionally covers FM/Staff JWTs, raster data URLs up to 8 MiB, positive optional camera/zone IDs, field allowlisting, private AI credentials, timeouts, and upstream error mapping.

Scope note: these suites mock `../../models`, so they prove route logic, validation, RBAC, transaction wiring, and response shape — not live Postgres constraint behaviour. The unique index on `edge_event_id` that backs idempotency in production is exercised here only through its recovery path, not by the database itself.
