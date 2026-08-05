# AI Log — Cloud Run Deployment Preparation
**Date:** 2026-07-16
**Branch:** deploy/staging
**Tool:** Claude Code (claude-fable-5)
**Project:** FlowGuard
**Source session:** `88824081-1195-43ad-883a-0eb95f9bdded`

**Archive note:** User-authored prompts are reproduced verbatim except that credential-like values are replaced with `[REDACTED]`. Internal auto-review, subagent, command, and tool-notification records are omitted.

---

## Task 1 — Prepare the current FlowGuard deploy/staging branch for deployment to Google Cloud Run…

**Prompt date/time:** 2026-07-16 21:55:39 SGT

**Prompt (verbatim):**

> Prepare the current FlowGuard deploy/staging branch for deployment to Google
> Cloud Run in asia-southeast1.
>
> Cloud project:
> flowguard-502613
>
> Artifact Registry:
> asia-southeast1-docker.pkg.dev/flowguard-502613/flowguard-containers
>
> Services:
> - React client
> - Node.js server
> - Python FastAPI AI service
>
> Do not deploy, commit, push, reset, or modify cloud resources.
>
> First audit the current repository and environment-variable usage.
>
> Create or repair:
>
> 1. server/Dockerfile
> 2. server/.dockerignore
> 3. client/Dockerfile
> 4. client/.dockerignore
> 5. client/nginx.conf if N/Dockerfile
> 4. client/.dockerignore
> 5. client/nginx.conf if Nginx is used
> 6. ai-service/Dockerfile
> 7. ai-service/.dockerignore
> 8. deployment/cloud-run/README.md
> 9. deployment/cloud-run/env.example
>
> Cloud Run requirements:
>
> - Node and Python must listen on the PORT environment variable supplied by
>   Cloud Run.
> - Bind to 0.0.0.0.
> - Do not hardcode localhost between cloud services.
> - Do not set PORT manually in Google Cloud configuration.
> - Node production startup must use node, not nodemon.
> - Python must start with uvicorn.
> - React Router routes must fall back to index.html.
> - The production frontend must not rely on the Vite development proxy.
> - All backend and AI URLs must come from environment variables.
> - Do not copy .env files, face images, screenshots, database files, logs,
>   model caches containing personal data, or test recordings into images.
> - Do not include Git history, node_modules, virtual environments or test output.
> - Do not expose Raspberry Pi private IP addresses publicly.
> - Do not place secrets in Dockerfiles or frontend build arguments.
>
> Inspect whether the React app currently needs a build-time API URL or can call
> the same domain through a reverse proxy. Recommend the safest architecture and
> make only the minimum required code changes.
>
> For the AI image:
>
> - inspect InsightFace, ONNX and YOLO dependencies;
> - confirm model-loading behaviour;
> - do not download models on every request;
> - report estimated image size and Cloud Run RAM/CPU needs;
> - preserve CPU execution support.
>
> Validate locally where available:
>
> - npm test -- --run
> - npm run build
> - full server Jest suite
> - Python tests
> - Dockerfile syntax/build feasibility
>
> Leave all changes unstaged.
>
> Return:
>
> 1. files created or changed;
> 2. Cloud Run compatibility fixes;
> 3. exact environment-variable names;
> 4. anything blocking container builds;
> 5. recommended RAM/CPU for each service;
> 6. PDPA and security controls;
> 7. test results;
> 8. confirmation nothing committed or pushed.

**Response summary:** The archived final response for this task stated:

> All done — every deliverable is in place, all validation passed, and everything is left unstaged.
>
> ## 1. Files created or changed
>
> **Created:** [server/Dockerfile](server/Dockerfile), [server/.dockerignore](server/.dockerignore), [client/Dockerfile](client/Dockerfile), [client/.dockerignore](client/.dockerignore), [client/nginx.conf](client/nginx.conf) (Nginx **is** used — it's an envsubst template), [ai-service/Dockerfile](ai-service/Dockerfile), [ai-service/.dockerignore](ai-service/.dockerignore), [deployment/cloud-run/README.md](deployment/cloud-run/README.md), [deployment/cloud-run/env.example](deployment/cloud-run/env.example).
>
> **Modified (2 minimal code changes):**
> - [server/package.json](server/package.json) — added `"start": "node index.js"` (production start without nodemon).
> - [piCamera.js:6](client/src/constants/piCamera.js:6) — the fallback Pi camera URL was the private IP `172.20.10.4` baked into the public JS bundle; replaced with the mDNS name `raspberrypi.local`. Verified the rebuilt bundle contains no private IPs or localhost URLs.
>
> ## 2. Recommended architecture & Cloud Run compatibility
>
> **Same-origin reverse proxy (recommended and implemented).** The Object Detection pages call `/ai/api/yolo/*` as hardcoded relative paths that only worked through the Vite dev proxy — a build-time `VITE_API_BASE_URL` would not fix those. The Nginx container reproduces the dev-proxy mapping (`/api`+`/user` → Node, `/ai` → FastAPI with prefix stripped) with zero frontend code changes, no CORS surface, and no backend URL baked into the image. Backend hostnames are injected at container start (`BACKEND_HOST`, `AI_HOST`) via Nginx's template mechanism. `VITE_API_BASE_URL` stays empty on purpose.
>
> Compliance: Node already resolved `PORT → APP_PORT → 5001` on `0.0.0.0` ([serverConfig.js](server/config/serverConfig.js)); the AI image starts `uvicorn --host 0.0.0.0 --port ${PORT:-8080}` (main.py's hardcoded 8501 is only in the dev-only `__main__` block); Nginx listens on `${PORT}`; SPA deep links fall back to `index.html`; no service sets PORT itself.
>
> ## 3. Environment variables (exact names, full list in [env.example](deployment/cloud-run/env.example))
>
> - **flowguard-server**: secrets `APP_SECRET, DB_PWD, AI_SERVICE_KEY, RECAPTCHA_SECRET_KEY, SMTP_PASS, EDGE_INGEST_TOKEN, EDGE_SERVICE_TOKEN, WHATSAPP_ACCESS_TOKEN`; plain `CLIENT_URL, ALLOWED_ORIGINS, FRONTEND_URL, DB_HOST, DB_PORT, DB_NAME, DB_USER, FACE_AI_URL, PYTHON_AI_URL, DB_SYNC_ALTER, SMTP_HOST/PORT/SECURE/USER, MAIL_FROM, WHATSAPP_*`
> - **flowguard-ai**: secrets `DB_PWD, AI_SERVICE_KEY` (must match the server's); plain `DB_HOST, DB_PORT, DB_NAME, DB_USER, NODE_SERVER_URL, ALLOWED_ORIGINS, USE_SERVER_CAMERA=false, FACE_CTX_ID=-1, AI_CAMERA_LOCATION`
> - **flowguard-client**: runtime `BACKEND_HOST, AI_HOST` (hostnames only); build-arg `VITE_RECAPTCHA_SITE_KEY` (public value — the only build arg, and BuildKit's linter flags it purely on the `_KEY` name heuristic)
>
> ## 4. Build blockers
>
> **None.** All three images built end-to-end locally. Notes: `insightface==0.7.3` compiles from source (handled by the build-essential builder stage), and torch is installed from the CPU wheel index to avoid ~2 GB of CUDA payload.
>
> ## 5. Recommended resources
>
> | Service | Memory | CPU | Notes |
> |---|---|---|---|
> | flowguard-client | 512 Mi | 1 | Nginx + static; image 142 MB |
> | flowguard-server | 1 Gi | 1 | 50 MB JSON bodies, Sequelize sync on boot; image 375 MB |
> | flowguard-ai | **4 Gi** | **2** | concurrency 8, timeout 300 s; image **4.37 GB**; consider `--min-instances 1` (model load ≈ 10–30 s on cold start) |
>
> ## 6. PDPA & security controls
>
> `.dockerignore` files exclude `.env*`, face images, `known_faces/`, recordings, databases, logs, model caches, tests, and `.git` — I verified the built server image contains no `.env` or tests. Secrets go to Secret Manager only, never Dockerfiles or `VITE_` values. `AI_SERVICE_KEY` must be set on both services or the face endpoints run unprotected (main.py warns). The AI service returns user IDs, not names; frames are never persisted; the 90-day transcript cleanup cron runs with the server. No Pi private IP ships in the bundle; SecurePi pushes outbound with `EDGE_INGEST_TOKEN`. CPU execution preserved (`FACE_CTX_ID=-1`, onnxruntime CPU provider, CPU torch).
>
> ## 7. Test results — all passing
>
> - Client Vitest: **433/433** (47 files) · Client `npm run build`: **OK**
> - Server Jest: **389/389** (28 suites)
> - Python pytest (`ai-service/tests`): **8/8**
> - `docker build --check`: clean for all three (only the site-key naming heuristic warning)
> - Real builds + smoke tests: client container serves the SPA with deep-link fallback on an injected PORT; AI container loads YOLO + buffalo_l **from the baked-in cache with no runtime download** and answers `/api/yolo/people-count`
>
> ## 8. Git state
>
> Nothing committed, pushed, or staged — `git status` shows only unstaged modifications and untracked new files; HEAD remains at `f28a005` on `deploy/staging`. No cloud resources were touched. (I did start Docker Desktop locally to run the build validation.)

**Outcome:** A final response was recorded in the source session.

---

## Task 2 — Review the completed FlowGuard Cloud Run preparation before I commit it. The current im…

**Prompt date/time:** 2026-07-16 22:34:10 SGT

**Prompt (verbatim):**

> Review the completed FlowGuard Cloud Run preparation before I commit it.
>
> The current implementation uses the public client Nginx container to proxy both:
>
> - /api to the Node service
> - /ai to the Python AI service
>
> For a real-world PDPA-sensitive deployment, the Python AI Cloud Run service must
> not be anonymously accessible.
>
> Change the deployment architecture to:
>
> Browser/client → Node backend → private Python AI service
>
> Requirements:
>
> 1. The client Nginx service may proxy /api only to the Node backend.
>
> 2. Remove direct client/Nginx proxying of /ai to the Python service.
>
> 3. Update Object Detection frontend requests currently using:
>    /ai/api/yolo/people-count
>    /ai/api/yolo/analyze-frame
>
>    so they call equivalent Node endpoints.
>
> 4. Add or reuse secure Node proxy routes for:
>    - people count
>    - frame analysis
>    - facial tracking
>    - facial recognition
>
> 5. Node must call the Python AI service using FACE_AI_URL/PYTHON_AI_URL.
>
> 6. Prepare Node for private Cloud Run service-to-service authentication:
>    - obtain a Google-signed ID token for the AI service audience using Google
>      application default credentials / the Cloud Run service account;
>    - send it using Authorization or X-Serverless-Authorization;
>    - preserve X-AI-Service-Key as defence in depth;
>    - keep local development working without requiring Google credentials.
>
> 7. Do not put service-account JSON key files in the repository or container.
>    Cloud Run must use its attached service account identity.
>
> 8. The AI service should be deployed without allowing unauthenticated access.
>    Document that the Node service account requires roles/run.invoker on the AI
>    service.
>
> 9. Remove raspberrypi.local as an automatic cloud fallback.
>    The cloud build should have no default Pi address.
>    Preserve browser camera, uploaded video and authenticated edge-ingestion
>    fallbacks.
>
> 10. Keep:
>    - React Router fallback;
>    - Cloud Run PORT handling;
>    - existing RBAC;
>    - AI_SERVICE_KEY validation;
>    - CPU InsightFace/YOLO support;
>    - all current functionality.
>
> 11. Update:
>    - client/nginx.conf
>    - deployment/cloud-run/README.md
>    - deployment/cloud-run/env.example
>    - deployment commands
>    - relevant Node and client source/tests
>
> 12. Validate:
>    - client full tests
>    - client production build
>    - server full tests
>    - Python tests
>    - all three Docker builds
>    - container smoke tests
>
> Do not deploy, commit, push, stage, reset or create cloud resources.
>
> Return:
> 1. architecture change made;
> 2. routes changed;
> 3. private AI authentication implementation;
> 4. local-development fallback;
> 5. Pi URL behaviour;
> 6. files changed;
> 7. all test/build results;
> 8. confirmation nothing committed or pushed.

**Response summary:** The archived final response for this task stated:

> Rearchitecture complete and fully validated. Here's the report:
>
> ## 1. Architecture change
>
> The AI service is now **private**: `Browser → Nginx (client) → Node backend → private Python AI service`. The client Nginx proxies **only** `/api/*` and `/user/*` to the Node backend — the `/ai/*` passthrough is gone from both [nginx.conf](client/nginx.conf) and the Vite dev proxy ([vite.config.js](client/vite.config.js)), so dev and prod have identical topology. The browser never reaches FastAPI in any environment.
>
> ## 2. Routes changed
>
> - **New Node proxy** [server/routes/yolo.js](server/routes/yolo.js), mounted at `/api/yolo` in [index.js](server/index.js): `GET /api/yolo/people-count` and `POST /api/yolo/analyze-frame`, both gated by `verifyToken + requireRole('FM','Staff')` (same RBAC as the detection dashboards). The analyze-frame proxy validates the data-URL image, caps it at 8 MB, and forwards **only** whitelisted fields (`image`, `camera_id`, `zone_id`, `source`).
> - **Facial tracking/recognition/enrolment** were already Node-proxied (`/api/facial-recognition/*`, `/user/enroll-face`) — reused, now upgraded with ID-token auth.
> - **Client**: [ObjectDetection.jsx](client/src/pages/ObjectDetection.jsx) and [CameraFeed.jsx](client/src/pages/CameraFeed.jsx) now call `/api/yolo/*` with the JWT `Authorization` header instead of `/ai/api/yolo/*` unauthenticated.
>
> ## 3. Private AI authentication
>
> New [server/services/aiServiceAuth.js](server/services/aiServiceAuth.js): `aiServiceHeaders(targetUrl)` fetches a Google-signed ID token from the **Cloud Run metadata server** using the service's **attached service account** (no JSON key files anywhere), with the audience set to the AI service's URL origin (works for both `FACE_AI_URL` and the path-bearing `PYTHON_AI_URL`). Tokens are cached per-audience and refreshed 60 s before expiry. Sent as `Authorization: Bearer [REDACTED] alongside the retained `X-AI-Service-Key` (defence in depth — FastAPI still validates it itself). All six Node→AI call sites now use it: the YOLO proxy, both recognize calls and track in [facialRecognition.js](server/routes/facialRecognition.js), encode-faces and both `/refresh` calls in [user.js](server/routes/user.js), and the incident scan in [incident.js](server/routes/incident.js). The README documents deploying the AI service with `--no-allow-unauthenticated` and granting the Node service account `roles/run.invoker` on it.
>
> ## 4. Local-development fallback
>
> Token fetching activates only when `K_SERVICE` is present (set by Cloud Run itself) or `AI_ID_TOKEN=force`; `AI_ID_TOKEN=off` disables it. Locally the metadata server is never contacted and headers contain just `X-AI-Service-Key` — `npm run dev` needs no Google credentials. This is covered by tests.
>
> ## 5. Pi URL behaviour
>
> [piCamera.js](client/src/constants/piCamera.js): the `raspberrypi.local` fallback is now **dev-only** (`import.meta.env.DEV`). Production/cloud builds ship **no default Pi address** — verified by grepping the built bundle (zero matches for `raspberrypi.local`, private IPs, `/ai/api`, or localhost). With no Pi URL configured, `isPiCameraReachable()` returns false immediately, so every scanner page falls back to the browser webcam; uploaded-video mode and the authenticated SecurePi edge-ingestion route (`/api/edge/detection-alerts`, outbound-push with `EDGE_INGEST_TOKEN`) are untouched.
>
> ## 6. Files changed
>
> **New:** `server/routes/yolo.js`, `server/services/aiServiceAuth.js`, `server/tests/.../yoloProxy.test.js` (13 tests). **Modified:** `server/index.js`, `server/routes/facialRecognition.js`, `server/routes/user.js`, `server/routes/incident.js`, `client/nginx.conf`, `client/Dockerfile` (comment), `client/vite.config.js`, `client/src/pages/ObjectDetection.jsx`, `client/src/pages/CameraFeed.jsx` + its test, `client/tests/.../ObjectDetectionSourceModes.test.jsx`, `client/src/constants/piCamera.js`, `deployment/cloud-run/README.md`, `deployment/cloud-run/env.example`. Env changes: client no longer needs `AI_HOST`; server gains optional `AI_ID_TOKEN` override.
>
> ## 7. Test & build results — all passing
>
> - **Client Vitest: 433/433** (47 files). One file (ApiBase.test.jsx, unrelated to these changes) timed out once while a Docker build was saturating the CPU; it passes in isolation and the full suite passed cleanly on the quiet rerun.
> - **Client production build:** OK; bundle verified free of Pi/AI/localhost addresses.
> - **Server Jest: 402/402** (29 suites — up from 389/28 with the new proxy+auth suite).
> - **Python pytest: 8/8.**
> - **Docker builds:** all three images rebuilt successfully (server 375 MB, client 142 MB, AI 4.37 GB).
> - **Smoke tests:** client container serves the SPA with React Router deep-link fallback on the injected PORT, and `/ai/...` now returns the SPA (text/html) instead of proxying; AI container boots uvicorn on the injected PORT with models loaded from the baked-in cache (no downloads); server container binds `0.0.0.0:$PORT` and serves `/` even with the DB unreachable.
>
> ## 8. Git state
>
> Nothing committed, pushed, staged, or reset — HEAD remains `f28a005` on `deploy/staging`, all changes are unstaged working-tree modifications and untracked files. No cloud resources were created or modified.

**Outcome:** A final response was recorded in the source session.
