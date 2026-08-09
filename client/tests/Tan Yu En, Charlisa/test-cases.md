# Frontend test cases - Charlisa

Latest focused result on 9 August 2026: **10/10 files and 142/142 tests passed** in this folder. Repository-wide, 81/83 files and 866/869 tests pass; the three failures are in `tests/Lucas Renjie Wong/SupportDashboard.test.jsx` and reproduce in isolation, so they are unrelated to this folder.

| Area | Representative cases | Expected result |
|---|---|---|
| Detection settings payload | Camera/zone identifiers, monitored classes, thresholds, cooldown, severity, enablement, and type are serialised consistently. | Node-compatible field names and values; no accidental omission or unit change. |
| Analyze-frame payload | Camera selector `id/zone_id` and camera-card `databaseId/zoneId` map to one `{ image, source?, camera_id?, zone_id? }` contract. | Only positive IDs and a trimmed source are included. |
| CameraFeed local video | A ready MP4 frame is captured and posted with canonical IDs, a real Bearer token, timeout, and AbortSignal. | Detection continues for local video and in-flight work is cancellable on cleanup. |
| CameraFeed missing token | Local frame is otherwise ready but no access token exists. | No analyze-frame request is made; `Bearer null`/`Bearer undefined` is never sent. |
| CameraFeed hardware stream | SecurePi/MJPEG URL is rendered directly. | Browser does not duplicate edge inference with Node analyze-frame calls. |
| Object Detection source modes | Browser camera, uploaded video, and SecurePi UI/source transitions. | Correct source-specific controls, cleanup, status, and payload behavior. |
| Object Detection refresh | Alert polling and snapshot preview refresh behaviour. | The panel reflects newly ingested alerts without a manual reload. |
| SecurePi URL resolution | Explicit stream/health URLs, per-camera browser overrides, derived `/health`, `/people-count`, `/snapshot`, `/sensor_status`, and rejection of malformed, credential-bearing, or secret-bearing URLs. | Stable endpoint targets without changing Node/private-AI architecture, and no token ever travels in a stream URL. |
| SecurePi camera health | Health status vocabulary, `streaming: false`, stale frame age, optional people-count `404/405/501`, CORS `TypeError`, and abort/timeout classification. | A degraded or unreachable Pi is classified precisely instead of collapsing to one generic error. |
| Sensor status normalisation | PIR/motion aliasing in both directions, boolean-only flags, non-negative finite distances and countdowns, trigger trimming and 120-char capping, and `inspection_id`/`inspection_cycle_id`/`cycle_id` cross-population. | A malformed or hostile sensor payload cannot inject values into the inspection UI, and the cycle id that becomes the alert idempotency key survives whichever spelling the device sends. |
| Sensor data over health | Embedded `sensor` block, top-level sensor fields, a disconnected bridge, a stale camera frame, an invalid health body, and probe opt-out. | Camera and sensor fail independently; sensor readings are never trusted from a health body that failed validation; probes carry no credentials. |

Hardware note: these are deterministic jsdom tests; they do not prove a real IMX500 model, MJPEG server, Arduino/PIR serial link, or browser camera permission flow.

Behaviour pinned deliberately: `testSecurePiConnection` never issues a separate `/sensor_status` request, because health normalisation always derives a sensor reading from the health body itself. The derived `sensorStatusUrl` is therefore currently unused by this helper. A test asserts the current call sequence so that if the fallback is ever wired up, it changes under review rather than silently.
