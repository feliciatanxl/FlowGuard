# Frontend test cases - Charlisa

Final focused result on 28 July 2026: **4/4 files and 38/38 tests passed in three consecutive runs**. This includes the three files in this folder and `src/pages/CameraFeed.test.jsx`.

| Area | Representative cases | Expected result |
|---|---|---|
| Detection settings payload | Camera/zone identifiers, monitored classes, thresholds, cooldown, severity, enablement, and type are serialised consistently. | Node-compatible field names and values; no accidental omission or unit change. |
| Analyze-frame payload | Camera selector `id/zone_id` and camera-card `databaseId/zoneId` map to one `{ image, source?, camera_id?, zone_id? }` contract. | Only positive IDs and a trimmed source are included. |
| CameraFeed local video | A ready MP4 frame is captured and posted with canonical IDs, a real Bearer token, timeout, and AbortSignal. | Detection continues for local video and in-flight work is cancellable on cleanup. |
| CameraFeed missing token | Local frame is otherwise ready but no access token exists. | No analyze-frame request is made; `Bearer null`/`Bearer undefined` is never sent. |
| CameraFeed hardware stream | SecurePi/MJPEG URL is rendered directly. | Browser does not duplicate edge inference with Node analyze-frame calls. |
| Object Detection source modes | Browser camera, uploaded video, and SecurePi UI/source transitions. | Correct source-specific controls, cleanup, status, and payload behavior. |
| SecurePi URL resolution | Explicit stream/health URLs and derived fallbacks. | Stable `/video_feed` and `/health` targets without changing Node/private-AI architecture. |

Hardware note: these are deterministic jsdom tests; they do not prove a real IMX500 model, MJPEG server, or browser camera permission flow.
