# AI Log — Object Detection: Hardcoded Values Audit
**Date:** 2026-08-03
**Branch:** feature/object-detection-v2
**Tool:** Claude Code (Sonnet 5)

---

## Task 1 — Are there any hardcoded values left in object detection?

**Prompt:** "in my object detection are there anything thats still hardcoded?"

**Response summary:** Investigated directly via `Read`/`Grep`/`Bash` (and in parallel launched a background `Explore` agent for a deeper sweep) across `ai-service/main.py` (the live YOLO/InsightFace FastAPI service), `ai-service/yolo_service.py`, `ai-service/zone_rules.py`, `ai-service/Dockerfile`, `ai-service/.env.example`, `raspberry-pi/pi_camera_steam.py`, `client/src/pages/ObjectDetection.jsx`, `client/src/pages/detectionSettingsPayload.js`, `client/src/utils/analyzeFrame.js`, and `server/config/detectionTypes.js`.

Found the object-detection tuning block in `main.py` (`YOLO_IMG_SIZE`, `YOLO_CONFIDENCE`, `CAMERA_WIDTH/HEIGHT`, `YOLO_FPS`, `FACE_RECOG_*`, `PERSON_*`, `NODE_SERVER_URL`, etc.) is already well env-driven, but flagged several things still hardcoded next to it: the YOLO model filename (`'yolov8n.pt'`, no env override), `iou=0.45` (NMS threshold), `_PROXIMITY_PX = 160`, `_TRACK_MAX_FACES = 2`, `_THRESHOLD_TTL = 60`, default zone name `"Zone A"`, JPEG stream quality `65`, and camera-backend fallback list. Most notably, found a real inconsistency bug: two call sites (`_recognize_person_crop` and `_yolo_detection_loop`) hardcode a face-match threshold of `0.45` instead of using the existing, env-configurable `_FACE_MATCH_THRESHOLD` constant used everywhere else — so setting `FACE_MATCH_THRESHOLD` in `.env` silently has no effect on face recognition during YOLO tracking.

Also flagged `ai-service/yolo_service.py` as an apparently dead/unused duplicate (100% hardcoded CORS origins, class allow/block lists, per-class confidence thresholds, inference params, plus a leftover debug `print`) that the Dockerfile still copies into the image even though `main:app`, not `yolo_service:app`, is what actually runs. Minor items also called out in the Pi camera streamer (`raspberry-pi/pi_camera_steam.py`: FPS/JPEG quality/resolution/port constants) and the frontend (`ObjectDetection.jsx`: hardcoded polling intervals and fallback frame size). Noted a documentation gap: several working env vars aren't listed in `ai-service/.env.example`.

**Outcome:** Accepted — user asked no follow-up correction, then let the background research agent continue running.

---

## Task 2 — Background deep-sweep results

**Prompt:** (automated `task-notification` — the `Explore` agent launched during Task 1 finished and returned its full findings; no new human prompt.)

**Response summary:** Synthesized the agent's report into a second pass on top of Task 1's answer, surfacing issues the direct read-through hadn't caught. Highlights: (1) `main.py:625`'s hardcoded `_zone_threshold_sec = 300` is an independent, non-env-driven duplicate of the same 5-minute default already centralized in `zone_rules.py` via `DEFAULT_ZONE_THRESHOLD_SEC`; (2) a port mismatch — `main.py`'s `__main__` block hardcodes `8501` while `Dockerfile` hardcodes a `8080` fallback for the same service; (3) `Dockerfile` bakes the InsightFace model as literal `'buffalo_l'` at build time, which can silently drift from the runtime `FACE_MODEL_NAME` env var; (4) alert-severity duration thresholds (`120`/`300`/`600`s) are duplicated verbatim across `server/routes/edgeDetectionAlerts.js` and `server/routes/detectionAlerts.js`; (5) the strings `"SecurePi Edge Node"` / `"Browser Webcam"` / `"Uploaded Video"` are hardcoded independently in three files that must be hand-synced; (6) more magic numbers in `main.py` (grid-snap sizes `50`/`80`, Windows-only camera backend list, `NODE_SERVER_URL` default `localhost:5001`).

Also surfaced repo-history context: the `edge/securepi/` module referenced in recent commits ("added snapshot logic + fixed clashes in ai-service offline") was actually deleted from the working tree in commits `0c86bca` and `4137852` — only a stale `.env` (with a real LAN IP, ingest token, device id, `.rpk` model path) and `__pycache__` remain. The deleted version, recovered read-only via `git show`, was flagged as a good template to follow if that module is rebuilt: every tunable went through a `Config` dataclass with CLI flag + env-var + preset-file overrides, rather than inline constants.

**Outcome:** No correction yet — user has not responded to the follow-up findings; ended by asking whether to start fixing the highest-impact items (face-threshold bypass, zone-threshold duplication, port mismatch) or tackle a specific file first.

---

## Task 3 — Save this session log

**Prompt:** "Summarize the entire session as a markdown log, per-task prompt/response-summary/outcome, saved as `<yyyy-mm-dd>-<task>.md` in `ai-logs/<name>/`."

**Response summary:** Followed the existing repo convention (`flowguard-ai/<Full Name>/ai-logs/`). Resolved `<name>` by checking `git config user.name`/`user.email` (`251787T` / `251787T@mymail.nyp.edu.sg`) and cross-checking recent commit authorship (`git log`) against the folder set under `flowguard-ai/` — confirmed the same mapping already used in this identity's prior logs: `251787T` → `Tan Yu En, Charlisa`. Listed the existing files in that `ai-logs/` folder to pick a distinct filename for today's topic, since no log for 2026-08-03 existed yet.

**Outcome:** In progress (this file).
