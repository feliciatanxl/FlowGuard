# AI Log — Vite Proxy ECONNREFUSED Troubleshooting
**Date:** 2026-08-03
**Branch:** feature/object-detection-v2
**Tool:** Claude Code (Sonnet 5)

---

## Task 1 — Diagnose Vite proxy connection errors

**Prompt:** User pasted dev-server terminal output showing `[vite] http proxy error: /api/detection-alerts` (`ECONNREFUSED 127.0.0.1:5001`) and `/api/yolo/people-count` (`AggregateError [ECONNREFUSED]`), alongside an IDE selection of the `uvicorn main:app --host 0.0.0.0 --port 8501 --reload` line in `README.md`.

**Response summary:** Ran `netstat -ano` filtered on ports 5001/8501/5173 to check live listener state, then cross-checked the PID on port 5001 with `tasklist`. Found both the Node backend (port 5001, `node.exe` PID 416) and the AI service (port 8501, PID 23000) were listening at the time of the check, with only `TIME_WAIT` connections in the history — indicating the proxy errors were a transient startup-ordering issue (Vite/frontend proxying to the backend before it had finished booting), not an ongoing outage. Reported both ports as currently up and suggested retrying the request, while offering to dig into `ai-service` logs or the Node server logs if errors persisted after refresh.

**Outcome:** Accepted — no follow-up indicating the error recurred.

---

## Task 2 — Save this session log

**Prompt:** "Summarize the entire session as a markdown log, per-task prompt/response-summary/outcome, saved as `<yyyy-mm-dd>-<task>.md` in `ai-logs/<name>/`."

**Response summary:** Followed the existing repo convention (`flowguard-ai/<Full Name>/ai-logs/`). Resolved `<name>` via `git config user.name`/`user.email` (`251787T` / `251787T@mymail.nyp.edu.sg`), matching the mapping already established in this identity's prior logs: `251787T` → `Tan Yu En, Charlisa`. Listed the existing files in that `ai-logs/` folder and picked a filename distinct from the same-day `2026-08-03-object-detection-hardcoded-values-audit.md` (an unrelated, separate session), since this session's only substantive task was the proxy-connection check above.

**Outcome:** In progress (this file).
