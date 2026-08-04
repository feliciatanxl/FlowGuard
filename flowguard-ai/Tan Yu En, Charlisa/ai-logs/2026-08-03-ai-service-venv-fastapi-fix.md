# AI Log — ai-service FastAPI Install Fix & 404 Diagnosis
**Date:** 2026-08-03
**Branch:** feature/object-detection-v2
**Tool:** Claude Code (Sonnet 5)

---

## Task 1 — Diagnose `/api/dashboard/summary` and `/api/yolo/analyze-frame` 404s

**Prompt:** User pasted browser console output showing repeated 404s on `GET /api/dashboard/summary` (`Dashboard.jsx:137`) and `POST /api/yolo/analyze-frame` (`CameraFeed.jsx:76`), alongside unrelated `raspberrypi.local` DNS failures (`ERR_NAME_NOT_RESOLVED`) and a `NotReadableError: Device in use` from `VPatrol.jsx`.

**Response summary:** Launched a background `Explore` agent to check the full request path: frontend axios calls (`Dashboard.jsx:132`, `CameraFeed.jsx:67`, `ObjectDetection.jsx:18`), backend route mounting (`server/index.js:59-60,71-72`, `server/routes/dashboard.js:51`, `server/routes/yolo.js:65`), and the Vite dev-server proxy (`client/vite.config.js:9-19`, proxying `/api` → `http://127.0.0.1:5001`). The agent confirmed every route, call site, and proxy rule was correctly wired — this was not a missing-route or misconfigured-path bug. It flagged `client/dist/` as freshly built and noted Vite's `server.proxy` only applies under `vite dev`, not `vite preview`/static serving, and that the 404s were consistent with either the ai-service/backend simply not running, or the frontend being served from a built bundle instead of the dev server. Reported findings and asked how the frontend was currently being launched and whether the Node backend (5001) / ai-service (8501) were up.

**Outcome:** Accepted — user didn't answer directly but proceeded to try starting `ai-service` themselves, which surfaced the real root cause (Task 2).

---

## Task 2 — Fix `ModuleNotFoundError: No module named 'fastapi'` in ai-service

**Prompt:** User pasted terminal output: `pip install` failed with `OSError: [WinError 5] Access is denied: '...Python313\Lib\site-packages\cv2\cv2.pyd'`, followed by `uvicorn main:app --host 0.0.0.0 --port 8501` failing with `ModuleNotFoundError: No module named 'fastapi'`.

**Response summary:** Diagnosed that the pip install had aborted partway through — the locked global `cv2.pyd` (in the machine-wide Python313 install, not a project venv) blocked the install, so packages listed after `opencv-python-headless` in `ai-service/requirements.txt`, including `fastapi`, never got installed; that's why uvicorn couldn't import it. Asked the user via `AskUserQuestion` how to fix it (venv vs. `--user` vs. clearing the file lock); user chose to create a venv. Created `ai-service/venv`, ran `pip install -r requirements.txt` inside it — succeeded cleanly, pulling in `opencv-python-headless`, `torch`, `torchvision`, `fastapi`, `insightface`, etc. as direct/transitive deps with no permission errors. Started `uvicorn main:app` from the venv in the background, confirmed `Application startup complete` in the logs and `GET /docs` returning `200`. Also verified the rest of the chain: Node backend on port 5001 returned `401` (auth required, i.e. up and routing correctly) and the Vite dev server on port 5173 proxied `/api/dashboard/summary` through to that same `401` (not a 404), confirming the original Task 1 404s were caused by ai-service simply not running, and were now resolved end-to-end.

**Outcome:** Accepted — venv created and verified working; asked user whether to stop the background verification instance so they could run their own.

---

## Task 3 — Same pip `OSError` recurs

**Prompt:** User pasted the identical `OSError: [WinError 5] Access is denied: '...cv2.pyd'` again from what was still the global Python (same `Python313\Lib\site-packages` path).

**Response summary:** Identified that the user had re-run `pip install` in a fresh terminal that wasn't using the venv created in Task 2 — same global-site-packages lock, not a new issue. Verified the existing `ai-service/venv` already had working `fastapi` (0.136.1) and `cv2` (5.0.0) importable directly, so no reinstall was needed. Gave exact activation commands for both cmd.exe (`venv\Scripts\activate.bat`) and PowerShell (`venv\Scripts\Activate.ps1`) so the user's terminal would resolve `python`/`uvicorn` to the venv copies instead of the global install. Flagged that the background uvicorn instance from Task 2 was still bound to port 8501 and offered to stop it to avoid a port conflict.

**Outcome:** A `task-notification` arrived showing the background uvicorn process had already stopped on its own (no completion record — likely reaped by session teardown), so port 8501 was free without needing action; no port conflict occurred.

---

## Task 4 — Save this session log

**Prompt:** "Summarize the entire session as a markdown log, per-task prompt/response-summary/outcome, saved as `<yyyy-mm-dd>-<task>.md` in `ai-logs/<name>/`."

**Response summary:** Followed the existing repo convention (`flowguard-ai/<Full Name>/ai-logs/`), matching the identity mapping already established for this Git identity (`251787T` → `Tan Yu En, Charlisa`) in the same day's other logs. Picked a filename distinct from the two other `2026-08-03` logs already present (`object-detection-hardcoded-values-audit.md`, `vite-proxy-connection-refused.md`), since this session's tasks were a separate 404-diagnosis-and-dependency-fix thread.

**Outcome:** In progress (this file).
