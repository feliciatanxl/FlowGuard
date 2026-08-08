# AI Log — SecurePi Live Stream Debug & Snapshot Retrieval Gap
**Date:** 2026-08-06
**Branch:** feature/object-detection-v2
**Tool:** Claude Code (Opus 5)

---

## Task 1 — Live camera feed not showing despite being on the same hotspot as the Pi

**Prompt:** "wait im connected to the same hotspot as my raspberry pi so why isnt the live camera showing up" — followed by a long interactive back-and-forth supplying Pi-side command output on request.

**Response summary:** Traced the stream wiring across `client/.env`, `client/src/utils/securepiStream.js`, `client/src/constants/piCamera.js`, `client/src/pages/ObjectDetection.jsx`, and `edge/securepi/.env`. Worked through and discarded three wrong hypotheses before finding the real cause:

1. **Stale IP (wrong).** Initially suspected `VITE_SECUREPI_STREAM_URL=http://172.20.10.2:8001/video_feed` had gone stale, since `172.20.10.x` is DHCP-assigned on a phone hotspot. User confirmed `hostname -I` returned exactly `172.20.10.2` — the configured value was correct all along.
2. **`hostname -i` red herring.** User first reported `127.0.1.1`. Explained this is the lowercase-`-i` gotcha: on Raspberry Pi OS it resolves the hostname through `/etc/hosts` (`127.0.1.1 raspberrypi`) and always returns that regardless of network state; `-I` (capital) queries real interfaces.
3. **Branch mismatch (real, but not the cause).** Discovered via `git log`/`git cat-file` that `edge/securepi/upstream/securePi.py` is **absent from HEAD** on `feature/object-detection-v2` — the 1451-line working version exists only on the sibling branch `feature/object-detection-space-v2` (commit `dc0a77c`, merged from `deploy/staging`), and `git merge-base --is-ancestor` confirmed it never landed here. Ruled out as today's cause once the user clarified the Pi runs from its own separate folder (`~/Downloads/updated_securePi_FlowGuard`), so repo branch state never affects what the Pi executes. Still flagged as a real deployment hazard.

**Diagnosis method:** `Test-NetConnection` from the laptop showed `PingSucceeded: True` but `TcpTestSucceeded: False` on port 8001 — proving the network path was fine and the problem was Pi-side (nothing listening). `ps aux | grep -i secure` and `ss -tlnp` on the Pi confirmed no process and no listener at all.

**Root cause:** `--stream` is opt-in and off by default (`stream_enabled: bool = False`, with the source comment "MJPEG streaming (off unless --stream is passed)"). Without it the script runs normally, the IMX500 captures, no error is printed — but the HTTP server never binds port 8001. A correction was needed mid-task: the first start command given omitted `--stream`, so the user's initial restart still failed. Also established that a preset arg is mandatory (`securePi.py: error: a settings file is required`), and confirmed `stream_host` already defaults to `0.0.0.0` and `stream_port` to `8001`, so no extra flags are needed beyond `--stream`.

**Verification after fix:** port 8001 open; `GET /health` → `200 {"status":"online","camera":"IMX500","streaming":true,"latest_frame_age_seconds":0.071}`; `/video_feed` returned `Content-Type: multipart/x-mixed-replace; boundary=frame` with `Access-Control-Allow-Origin: *`, delivering 860 KB / 27 JPEG SOI markers in 4s ≈ 6.8 fps (matching the configured `STREAM_FPS=8`). Also found `/people-count` returns **404** on the Pi's build (the repo's `dc0a77c` version does implement it at line 803), so the UI's live people-count stays empty in hardware mode while video renders fine.

Additionally flagged that `getHardwareStreamUrl` prefers the selected Camera Inventory record's stored `stream_url` over the env var, so a stale IP in the DB silently overrides a correct `client/.env`; and that `VITE_*` vars are baked in at Vite startup so the dev server must be restarted after edits.

**Outcome:** Resolved and verified end-to-end — user confirmed "ok can alrd". Two memories were written (`securepi-pi-runtime`, `flowguard-hotspot-networking`) capturing the `--stream` requirement, the `hostname -i`/`-I` trap, and the two independent Pi↔laptop URL directions.

---

## Task 2 — What should the FlowGuard API URL be on the Raspberry Pi?

**Prompt:** "wait then what shd be my flowguard api url in my rasp pi"

**Response summary:** Determined the laptop's current hotspot IP via `Get-NetIPAddress` (Wi-Fi adapter, DHCP: `172.20.10.6`) and confirmed `APP_PORT=5001` in `server/.env` plus the route registration `app.use("/api/edge", edgeDetectionAlertsRoute)` at `server/index.js:50`. Answer: `http://172.20.10.6:5001`, which already matched `edge/securepi/.env:1`. Read the server `.env` with token values redacted rather than echoing secrets.

Three caveats given: (1) this is the **opposite direction** from the camera problem — Pi pushes alerts *out* to the laptop on 5001, while the browser pulls MJPEG *in* from the Pi on 8001, so this setting could not fix the black feed; (2) the Pi's own `deploy/securepi.service` documents its env vars as `FLOWGUARD_API_URL` / `SECUREPI_DEVICE_ID`, **not** the repo file's older `FLOWGUARD_API_BASE_URL` / `FLOWGUARD_DEVICE_ID` names, and since the Pi runs a separate folder the repo `.env` is never read by it; (3) the Node server must bind `0.0.0.0` rather than localhost, with a `curl` check from the Pi to verify.

**Outcome:** Accepted — no correction. User moved on to snapshots.

---

## Task 3 — How do I see the snapshots, and can FlowGuard retrieve them?

**Prompt:** "wait then how do i see the snapshots" → "cos in my rasp pi i got save the snapshots into a folder right then in flowguard iis there a way i can retrieve it>" → "Huh so is it possible to have the snapshots in the website or not"

**Response summary:** Traced the full snapshot path across `server/routes/edgeDetectionAlerts.js`, `client/src/pages/ObjectDetection.jsx`, and the Pi's `edge/securePi.py` (via targeted `grep` output the user supplied, since that file is not in this repo).

**Finding — a genuine end-to-end gap, not a misconfiguration.** The server side is fully built: `multer` accepts a multipart field named `snapshot` (JPEG-only via `/^image\/jpe?g$/i`, 5 MB cap from `DETECTION_SNAPSHOT_MAX_BYTES`), stores to `server/uploads/detection-snapshots/`, sets `snapshot_url` to `/api/detection-alerts/:id/snapshot/:filename`, and the UI fetches it as an authenticated blob rendering a preview plus a "View edge snapshot" link. But the Pi **never transmits the image**: `grep -nE "multipart|form-data|boundary|snapshot"` on the Pi's `securePi.py` returned no multipart/form-data hits at all. The repo's `dc0a77c` `FlowGuardBridge` confirms the shape — `build_headers()` returns `{"Content-Type": "application/json"}` and `build_payload()` contains no snapshot field whatsoever; the snapshot filename goes only into the local CSV event log.

The Pi's newer build does send `snapshot_path` (line 957, `str(snapshot_path)`), but that is a **local Pi filesystem path**, and `ObjectDetection.jsx:66-69` deliberately refuses to render it — gating image `src` on `^https?://` or the `/api/detection-alerts/:id/snapshot/:file` form, with an explicit comment that a Pi local path "must NEVER be turned into an" image source. Hence the UI's existing fallback string *"Snapshot captured on the edge device; remote upload unavailable"* is the expected state today.

Also established: FlowGuard **cannot pull** from the Pi by design — `client/src/constants/piCamera.js:5-10` documents that the Pi pushes outbound to the authenticated `/api/edge` route and "the cloud never reaches into the LAN" (and a private DHCP hotspot address wouldn't be inbound-reachable anyway). Corrected an earlier guess about the snapshot location: it derives from `runtime_dir`, i.e. `runtime/snapshots/<zone>/`, not `alerts/`. Gave `scp -r keatkean@172.20.10.2:.../runtime/snapshots ./pi-snapshots` as an immediate no-code-change workaround for demo purposes.

**Outcome:** Answered definitively (yes, it's possible; ~15-line Pi-side change, nothing downstream needs touching). Not implemented — writing the patch requires the Pi's actual bridge code, and two attempts to extract it failed: `grep -n "class FlowGuardBridge"` returned empty (the class has a different name in that build), causing the follow-up `sed` range to error.

---

## Task 4 — Write a prompt for the Pi's Claude Code to implement the snapshot upload

**Prompt:** "so give me a prompt so i can tell the rasp pi claude to configure"

**Response summary:** Read the server contract precisely first (`edgeDetectionAlerts.js:55-147, 242-259`) to capture what the Pi-side agent cannot discover on its own: endpoint, `Authorization: Bearer <EDGE_INGEST_TOKEN>` header handling, the exact multipart field name `snapshot`, the JPEG mimetype filter and 5 MB limit, the full list of body fields that must still be sent as multipart text fields, and the `EVENT_ID_RE` (`^[A-Za-z0-9._:-]{1,255}$`) dedupe contract making retries idempotent.

Authored a self-contained copy-pasteable prompt specifying: stdlib-only implementation (hand-built multipart via `urllib.request`, no new dependencies on a working Pi); **the `SNAPSHOT_EXECUTOR` race** — `save_snapshot()` submits the write to a `ThreadPoolExecutor` and returns the path immediately, so the file usually does not exist yet when the alert is queued, requiring a bounded (~2s) wait-for-file with JSON fallback; fail-soft behaviour preserving the bounded-queue/daemon-worker pattern so a slow server can never stall detection, the MJPEG stream, local snapshot writing, or CSV logging; a longer (~20s) timeout for the multipart path only; oversize handling; an explicit do-not-change list; and verification steps including re-checking `/health` afterward to prove the upload didn't stall the pipeline. Added two operator notes: `EDGE_INGEST_TOKEN` must match `server/.env` or every POST 401s, and the hardcoded `172.20.10.6` is DHCP and should be re-checked before a demo.

**Outcome:** Delivered. Not yet executed on the Pi — no result reported back this session.

---

## Task 5 — Are there any hardcoded values left in object detection?

**Prompt:** "in my object detection are there anything thats still hardcoded?" (with a background agent launched for a deeper sweep)

**Response summary:** Re-ran the audit across `ai-service/main.py`, `yolo_service.py`, `zone_rules.py`, `Dockerfile`, `.env.example`, `raspberry-pi/pi_camera_steam.py`, `client/src/pages/ObjectDetection.jsx`, and `server/config/detectionTypes.js`, with a background agent covering the broader sweep.

**This is a near-verbatim repeat of `2026-08-03-object-detection-hardcoded-values-audit.md`** — same prompt, same findings, and nothing has been fixed in the interim. Both passes independently surfaced: the hardcoded `'yolov8n.pt'` model filename with no env override; `iou=0.45` at both YOLO call sites; `_PROXIMITY_PX = 160`; `_TRACK_MAX_FACES = 2`; `_THRESHOLD_TTL = 60`; the `"Zone A"` fallback; the **face-threshold bypass** where `main.py:852` and `main.py:1129` hardcode `0.45` instead of the env-configurable `_FACE_MATCH_THRESHOLD` (so `FACE_MATCH_THRESHOLD` in `.env` silently has no effect during YOLO person-tracking); the `_zone_threshold_sec = 300` duplicate of `zone_rules.py`'s `DEFAULT_ZONE_THRESHOLD_SEC`; the `8501` vs `${PORT:-8080}` port mismatch between `main.py.__main__` and the Dockerfile; the `buffalo_l` build-time bake vs runtime `FACE_MODEL_NAME`; duplicated `120/300/600` severity thresholds across the two alert routes; the three-way hand-synced `"SecurePi Edge Node"` / `"Browser Webcam"` / `"Uploaded Video"` strings; grid-snap magic numbers `50`/`80`; the Windows-only `cv2.CAP_DSHOW/CAP_MSMF` backend list; and `yolo_service.py` as a fully-hardcoded dead duplicate still copied into the Docker image.

One correction to the agent's report worth recording: it claimed `edge/securepi/`'s `.env` is orphaned config "for a deleted module." That is accurate for *this branch's working tree*, but the module is not gone from the project — it lives on `feature/object-detection-space-v2` at `dc0a77c`, and a separate (different-lineage) copy runs on the actual Pi hardware, as Tasks 1–4 established.

**Outcome:** Reported; no fixes applied. The three highest-impact items (face-threshold bypass, zone-threshold duplication, port mismatch) remain open and were offered as the starting point — same offer as 2026-08-03, still unactioned.

---

## Task 6 — Save this session log

**Prompt:** "Summarize the entire session as a markdown log, per-task prompt/response-summary/outcome, saved as `<yyyy-mm-dd>-<task>.md` in `ai-logs/<name>/`."

**Response summary:** Followed the established repo convention `flowguard-ai/<Full Name>/ai-logs/`, resolving `<name>` from the session's git user `251787T` → `Tan Yu En, Charlisa` (the same mapping already used by this identity's prior logs). Listed the existing folder contents to pick a distinct filename, and read `2026-08-03-object-detection-hardcoded-values-audit.md` to avoid restating an audit already logged three days earlier — noting the repeat in Task 5 instead.

**Outcome:** Completed — log written to `flowguard-ai/Tan Yu En, Charlisa/ai-logs/2026-08-06-securepi-stream-and-snapshot-retrieval.md`. Nothing committed, per the convention in this folder's prior logs.

---

## Open items carried out of this session

1. **Snapshot upload patch not written** — needs the Pi's actual `FlowGuardBridge`-equivalent class name and `_post` body; the extraction commands failed. Prompt for the Pi-side agent is ready (Task 4).
2. **`/people-count` 404s** on the Pi's build, so live people-count stays empty in hardware mode.
3. **`securePi.py` missing from `feature/object-detection-v2`** — only on `feature/object-detection-space-v2` (`dc0a77c`). Anyone deploying from the current branch has no edge source to run; worth cherry-picking before merge.
4. **`--stream` must be made durable** — either added to the preset `.args` file or via the `deploy/securepi.service` systemd unit; the Pi process currently runs in the foreground and dies with the SSH session.
5. **Hardcoding fixes still unactioned** since 2026-08-03, notably the `FACE_MATCH_THRESHOLD` bypass, which is a silent correctness bug rather than a tidiness issue.

---

## Addendum — 2026-08-08 status re-check

Re-checked the open items above against the repo. Several commits landed in the interim, all authored by **`fel` (feliciatanxl@gmail.com)** rather than in this session, so they are not logged as tasks here — no prompts are available for them:

- `dda9cc9` feat: persist detection snapshots in private GCS (`server/utils/detectionSnapshotStorage.js` +193, `server/tests/gcs-detection-snapshots.test.js` +389, both alert routes)
- `cade242` fix: refresh edge snapshots and evidence timestamps (`edgeDetectionAlerts.js` +61, `ObjectDetection.jsx`, `ObjectDetectionRefresh.test.jsx` +121)
- `0cf8c96`, `5997e3b` merges of `fix/snapshot-refresh-timestamp` and `ai-chatbot` into this branch

**Effect on open item 1 — still open.** This work is entirely server- and client-side: it changes where snapshots are *stored* (private GCS instead of local disk) and refreshes evidence timestamps. It does **not** touch the Pi, and the gap identified in Task 3 is on the Pi — `securePi.py` still posts `application/json` and never attaches the JPEG. So the images still cannot reach the website until the Pi-side multipart change is made.

**The Task 4 prompt remains valid.** Verified the ingest contract it encodes is unchanged after `cade242`: `snapshotUpload.single('snapshot')` (same field name), the JPEG mimetype filter (now via a `JPEG_MIME_TYPES` set), the env-driven `SNAPSHOT_MAX_BYTES` limit, and `snapshotUrlFor` are all intact.

**One addition to fold into that prompt:** `cade242` added `refreshDuplicateSnapshotAndTimestamp`, so a duplicate `event_id` arriving **with a JPEG attached** now refreshes the existing alert's `snapshot_url` and `occurred_at` and deletes the superseded snapshot, rather than being a no-op. Retries are therefore still safe, but they now *replace* the stored evidence instead of being ignored — worth stating explicitly so the Pi-side implementation doesn't re-POST more often than intended.

Open items 2–5 (the `/people-count` 404, `securePi.py` missing from this branch, making `--stream` durable, and the unactioned hardcoding fixes including the `FACE_MATCH_THRESHOLD` bypass) are all unchanged.
