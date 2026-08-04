# AI Log — "Node.js Server Offline" Banner: False Alarm vs. Missing DB Migration
**Date:** 2026-08-03
**Branch:** feature/object-detection-v2
**Tool:** Claude Code (Sonnet 5)

---

## Task 1 — Diagnose the "Node.js server offline" banner despite the server running

**Prompt:** "why does it say offline even tho i have already run it" — with a screenshot of the Object Detection page showing `AI Engine: Online` and live YOLO detections working, but a red `Node.js server offline - run node index.js in /server (port 5001)` banner, alongside an IDE selection of the `uvicorn main:app --host 0.0.0.0 --port 8501` line in `README.md`.

**Response summary:** Read the `nodeOffline`/`aiOffline` state logic in `client/src/pages/ObjectDetection.jsx`. Found `fetchZones`/`fetchAlerts`/`handleRefreshAlerts` (lines ~144-171) set `nodeOffline = true` on *any* axios rejection with zero error inspection and no debounce, unlike `fetchPeopleCount`'s AI-engine check, which requires 3 consecutive failures (`aiHealthFailuresRef.current >= 3`) before flipping `aiOffline`. Ran `netstat -ano` and confirmed port 5001 was actively `LISTENING` under `node.exe`, then curled `/api/zones` and `/api/detection-alerts` directly and got a structured `401 {"message":"Access Denied. No security token provided."}` — a real response, not connection-refused — proving the Node process was healthy and the banner was a false positive. Found access tokens expire after 1h (`server/routes/user.js:253-257`), which combined with the missing debounce would explain a stale-login 401 instantly flipping the Node banner while the AI badge stays green. Proposed and started a frontend fix (distinguish a missing `err.response` from an actual 401, add a `sessionExpired` state/banner) — added `const [sessionExpired, setSessionExpired] = useState(false);` to `ObjectDetection.jsx` before being interrupted.

**Outcome:** Superseded — user reported already logging out and back in with no change, disproving the pure-expired-token theory and prompting a deeper look (Task 2).

---

## Task 2 — Find the real root cause

**Prompt:** "wait but i log out and login already still cannot work eh"

**Response summary:** Set the in-progress frontend patch aside and re-investigated end-to-end instead of re-guessing. Confirmed `client/src/pages/Login.jsx:41` stores the token under the same `accessToken` key `ObjectDetection.jsx` reads. Queried the live Postgres DB directly with a one-off Sequelize script (`User.findAll`) and found a single account, `admin@harrison.com`, role `FM`, `isActive: true`, `tokenVersion: 0` — ruling out role/permission/suspension causes. Minted a correctly-signed JWT for that user (same `jwt.sign` payload shape as the login route) and hit both endpoints directly with curl: `GET /api/zones` → 200 OK, but `GET /api/detection-alerts` → 500 `{"error":"column \"edge_event_id\" does not exist"}` — a genuine Postgres schema error, unrelated to auth entirely. Traced this to `server/migrations/20260729_edge_idempotency_and_whatsapp.sql`, a hand-run SQL migration (this project has no Sequelize-CLI, per `server/migrations/README.md`) adding the `edge_event_id`/`whatsapp_status`/`whatsapp_sent_at`/`whatsapp_error` columns the `DetectionAlert` model and the recent WhatsApp/SecurePi edge work expect. The migration file existed in the repo but had never been run against the local dev DB — the same README documents an identical prior incident on 2026-07-14. Applied the migration directly to the local `flowguard` Postgres DB via a small Node script using the `pg` package (the migration is additive-only: `ADD COLUMN IF NOT EXISTS`, no drops, wrapped in `BEGIN`/`COMMIT`), then re-verified with the same minted token: `GET /api/detection-alerts` now returns 200 with real alert rows. Flagged as an aside that the alert log came back with a very large number of `"status":"Active"` rows, which may be worth separate attention.

**Outcome:** Accepted — root cause fixed at the database level; the "Node.js server offline" banner should clear on the next refetch. Offered to finish the deferred frontend fix (banner should distinguish a real network failure from an HTTP error response) or stop there; the next message was the log-save request below rather than an answer to that offer.

---

## Task 3 — Save this session log

**Prompt:** "Summarize the entire session as a markdown log, per-task prompt/response-summary/outcome, saved as `<yyyy-mm-dd>-<task>.md` in `ai-logs/<name>/`."

**Response summary:** Followed the existing repo convention (`flowguard-ai/<Full Name>/ai-logs/`), confirmed by the two same-day logs already present in `flowguard-ai/Tan Yu En, Charlisa/ai-logs/` (`...-object-detection-hardcoded-values-audit.md`, `...-vite-proxy-connection-refused.md`) plus a third, `...-ai-service-venv-fastapi-fix.md`, that had appeared in the same folder during this session without this conversation creating it. Resolved `<name>` via `git config user.name`/`user.email` (`251787T` / `251787T@mymail.nyp.edu.sg`), matching the mapping already used by those prior logs. While double-checking the working tree before writing, found that the changes present at the start of this session (`server/routes/detectionAlerts.js`, `server/routes/edgeDetectionAlerts.js`, `server/config/detectionTypes.js`, `server/utils/detectionAlertBridge.js`, `client/src/css/ObjectDetection.css`, plus this session's own `sessionExpired` edit) no longer show as a diff against `HEAD` — `git cat-file -p HEAD:<path>` confirmed the content is already part of commit `2c73838`, and the working-tree blob hash matches `HEAD` exactly for each file. Nothing was lost; something outside this conversation (likely a teammate's parallel session, consistent with the unrelated `ai-service-venv-fastapi-fix` log appearing at the same time) had already folded the WIP into that commit. Picked a filename distinct from the existing 2026-08-03 logs.

**Outcome:** In progress (this file).
