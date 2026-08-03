# FlowGuard — Google Cloud Run deployment (asia-southeast1)

Project: `flowguard-502613`
Artifact Registry: `asia-southeast1-docker.pkg.dev/flowguard-502613/flowguard-containers`

Three services, deployed in this order (each later service needs the earlier one's URL):

| Service            | Source        | Image name          | Access | What it runs                          |
|--------------------|---------------|---------------------|--------|----------------------------------------|
| `flowguard-server` | `server/`     | `flowguard-server`  | public | Node.js/Express API (`node index.js`) |
| `flowguard-ai`     | `ai-service/` | `flowguard-ai`      | **PRIVATE** | FastAPI + InsightFace + YOLOv8 (uvicorn) |
| `flowguard-client` | `client/`     | `flowguard-client`  | public | React static build behind Nginx reverse proxy |

## Architecture

The AI service is **private** — it holds the biometric matching engine, so it
must never be anonymously reachable. Only the Node backend can invoke it:

```
Browser ──► flowguard-client (Nginx, public)
              ├── /api/*, /user/*  ──► flowguard-server (Node, public)
              └── everything else ──► React SPA (index.html fallback for React Router)

flowguard-server (JWT/RBAC first) ──► flowguard-ai (PRIVATE)
    /api/facial-recognition/*  -> /user/recognize, /user/track      (face)
    /user/enroll-face          -> /api/encode-faces, /refresh       (enrolment)
    /api/yolo/*                -> /api/yolo/*                       (object detection)
    each call carries: Authorization: Bearer <Google ID token>      (Cloud Run IAM)
                       X-AI-Service-Key: <shared secret>            (defence in depth)

flowguard-ai ──► flowguard-server (detection alerts, x-service-key)
Both         ──► Cloud SQL PostgreSQL
SecurePi (LAN) ──► flowguard-server /api/edge/detection-alerts (Bearer EDGE_INGEST_TOKEN)
```

Why this architecture:

- **The AI service is deployed with `--no-allow-unauthenticated`.** Cloud Run's
  IAM layer rejects any caller without a Google-signed ID token for the AI
  service's audience — the biometric endpoints are unreachable from the
  internet even if the app-level `AI_SERVICE_KEY` ever leaked.
- The browser **never** talks to FastAPI: the old `/ai/*` passthrough is gone.
  YOLO object detection now flows through the Node proxy `/api/yolo/*`
  (JWT + FM/Staff role), like facial recognition always did.
- The Node backend obtains its ID token from the **Cloud Run metadata server**
  using the service's attached service account
  (`server/services/aiServiceAuth.js`). **No service-account JSON key file
  exists in the repo, images, or env** — Cloud Run's own identity is used.
- No backend URL or secret is baked into the client image or JS bundle; the
  backend host is injected at container start (`BACKEND_HOST`).
- `VITE_API_BASE_URL` is deliberately left **empty** at build time (relative
  URLs, same-origin Nginx proxy, no CORS surface).

## Cloud Run compliance checklist (already handled in code/images)

- **PORT**: Node resolves `PORT → APP_PORT → 5001` (`server/config/serverConfig.js`);
  the AI image starts `uvicorn --port ${PORT:-8080}`; Nginx listens on `${PORT}`
  via the official image's envsubst templates. **Never set PORT manually** on a
  Cloud Run service — it is injected.
- **0.0.0.0** binding on all three services.
- **No nodemon in production** — the server image installs `--omit=dev` and runs
  `node index.js` (also available as `npm start`).
- **SPA fallback** — Nginx `try_files ... /index.html` for React Router deep links.
- **No localhost between services** — `FACE_AI_URL`, `NODE_SERVER_URL`,
  `PYTHON_AI_URL`, `BACKEND_HOST` all come from env vars.
- **Models baked at build time** — buffalo_l (InsightFace) and yolov8n.pt are
  inside the AI image; nothing downloads at cold start or per request.
- **Private-service auth** — ID tokens are fetched from the metadata server and
  cached until shortly before expiry; locally (no `K_SERVICE`) no token is
  attempted, so `npm run dev` needs no Google credentials.

## Build & push (run from the repo root — DO NOT run until you intend to deploy)

```bash
gcloud auth configure-docker asia-southeast1-docker.pkg.dev

REG=asia-southeast1-docker.pkg.dev/flowguard-502613/flowguard-containers

docker build -t $REG/flowguard-server:v1 server/
docker build -t $REG/flowguard-ai:v1 ai-service/
docker build -t $REG/flowguard-client:v1 \
  --build-arg VITE_RECAPTCHA_SITE_KEY=<public-site-key> client/

docker push $REG/flowguard-server:v1
docker push $REG/flowguard-ai:v1
docker push $REG/flowguard-client:v1
```

(Or `gcloud builds submit` per directory with the same tags.)

Pi runtime Settings is preferred. For a device-specific kiosk image only, the client
Dockerfile also accepts the public optional arguments
`VITE_ENABLE_PI_CAMERA`, `VITE_PI_CAMERA_HEALTH_URL`,
`VITE_PI_CAMERA_STREAM_URL`, and `VITE_PI_CAMERA_SNAPSHOT_URL`. Leave all four unset
for the normal deployable build with webcam fallback. These values ship in JavaScript;
never use them for secrets and do not bake a transient hotspot IP into a shared image.

## Deploy

Put every secret in **Secret Manager** first (`APP_SECRET`, `DB_PWD`,
`AI_SERVICE_KEY`, `RECAPTCHA_SECRET_KEY`, `SMTP_PASS`, `EDGE_INGEST_TOKEN`, …)
and grant the runtime service account `roles/secretmanager.secretAccessor`.
See [env.example](env.example) for the full variable list per service.

```bash
REGION=asia-southeast1

# 0) Dedicated identity for the Node backend (recommended over the default SA)
gcloud iam service-accounts create flowguard-server-sa \
  --display-name "FlowGuard Node backend"
SERVER_SA=flowguard-server-sa@flowguard-502613.iam.gserviceaccount.com

# 1) Backend
gcloud run deploy flowguard-server \
  --image $REG/flowguard-server:v1 --region $REGION \
  --service-account $SERVER_SA \
  --memory 1Gi --cpu 1 --min-instances 0 --max-instances 3 \
  --allow-unauthenticated \
  --set-env-vars DB_HOST=...,DB_PORT=5432,DB_NAME=...,DB_USER=...,DB_SYNC_ALTER=false \
  --set-secrets APP_SECRET=APP_SECRET:latest,DB_PWD=DB_PWD:latest,AI_SERVICE_KEY=AI_SERVICE_KEY:latest,RECAPTCHA_SECRET_KEY=RECAPTCHA_SECRET_KEY:latest,SMTP_PASS=SMTP_PASS:latest,EDGE_INGEST_TOKEN=EDGE_INGEST_TOKEN:latest
# note the URL it prints -> SERVER_URL

# 2) AI service — PRIVATE: no unauthenticated access, ingress restricted.
gcloud run deploy flowguard-ai \
  --image $REG/flowguard-ai:v1 --region $REGION \
  --memory 4Gi --cpu 2 --min-instances 0 --max-instances 2 \
  --concurrency 8 --timeout 300 \
  --no-allow-unauthenticated \
  --set-env-vars DB_HOST=...,DB_PORT=5432,DB_NAME=...,DB_USER=...,NODE_SERVER_URL=$SERVER_URL,USE_SERVER_CAMERA=false,FACE_CTX_ID=-1 \
  --set-secrets DB_PWD=DB_PWD:latest,AI_SERVICE_KEY=AI_SERVICE_KEY:latest
# note the URL -> AI_URL

# 2b) REQUIRED: only the Node backend's service account may invoke the AI service.
gcloud run services add-iam-policy-binding flowguard-ai --region $REGION \
  --member serviceAccount:$SERVER_SA \
  --role roles/run.invoker

# 2c) Point the backend at the AI service (audience for its ID tokens = this URL).
gcloud run services update flowguard-server --region $REGION \
  --update-env-vars FACE_AI_URL=$AI_URL

# 3) Frontend (hostname only, no https://). No AI_HOST — the AI service is private.
gcloud run deploy flowguard-client \
  --image $REG/flowguard-client:v1 --region $REGION \
  --memory 512Mi --cpu 1 --min-instances 0 --max-instances 3 \
  --allow-unauthenticated \
  --set-env-vars BACKEND_HOST=${SERVER_URL#https://}
# note the URL -> CLIENT_URL

# 4) Point the backend's CORS + links at the real frontend URL
gcloud run services update flowguard-server --region $REGION \
  --update-env-vars CLIENT_URL=$CLIENT_URL,FRONTEND_URL=$CLIENT_URL
```

## Recommended resources

| Service            | Memory | CPU | Concurrency | Notes |
|--------------------|--------|-----|-------------|-------|
| `flowguard-client` | 512 Mi | 1   | default (80)| Nginx + static files; 256 Mi also works |
| `flowguard-server` | 1 Gi   | 1   | default (80)| Sequelize sync on boot; 50 MB JSON bodies; now also relays YOLO frames |
| `flowguard-ai`     | **4 Gi** | **2** | **8**   | buffalo_l (det+recog ONNX) + YOLOv8n resident ≈ 1.5–2.5 GB RSS; per-request numpy/cv2 spikes. 2 vCPU keeps analyze-frame latency usable on CPU. `--timeout 300`. |

AI image size ≈ **4.4 GB** (CPU torch, torchvision, 2× OpenCV wheels,
onnxruntime, buffalo_l pack ≈ 280 MB, yolov8n.pt 6.5 MB). Consider
`--min-instances 1` for the AI service if cold starts (model load ≈ 10–30 s)
are unacceptable for the demo.

## PDPA & security controls

- **The biometric engine is not internet-reachable**: `flowguard-ai` refuses
  unauthenticated requests at the IAM layer; only the Node backend's service
  account holds `roles/run.invoker`. The app-level `AI_SERVICE_KEY` check
  remains as a second, independent layer.
- **All AI access is RBAC-gated first**: facial recognition/tracking and the
  YOLO proxy (`/api/yolo/*`) require a valid FlowGuard JWT with the same
  FM/Staff roles as the detection dashboards, before any frame is forwarded.
- **No service-account key files** anywhere — identity comes from the attached
  Cloud Run service account via the metadata server.
- **Biometric data never enters an image**: `.dockerignore` files exclude
  `.env*`, face images, `known_faces/`, screenshots, recordings, databases,
  logs, model caches, `node_modules`, `.venv`, tests, and `.git`.
- **Secrets** live in Secret Manager only — never in Dockerfiles, build args,
  or `VITE_` variables (every `VITE_` value ships to the browser).
- The AI service returns **user IDs, not names**, to callers; names appear in
  developer logs only. Embeddings stay in PostgreSQL; the recognize path never
  persists frames.
- **PDPA retention**: the backend's 90-day transcript cleanup cron starts with
  the server process.
- **Raspberry Pi**: production builds contain **no active default Pi address**.
  The laptop browser can set the current hotspot address at Settings -> Raspberry
  Pi Camera without rebuilding; optional public `VITE_PI_CAMERA_*` build arguments
  remain available as fallback. Without runtime or Vite configuration, scanner
  pages make no Pi request and automatically use the browser webcam. The browser,
  not Cloud Run, connects directly to the private Pi. The SecurePi edge node pushes alerts *outbound* to
  `/api/edge/detection-alerts` with `EDGE_INGEST_TOKEN` — the cloud never
  needs to reach into the LAN.
- Nginx adds `X-Content-Type-Options`, `X-Frame-Options: DENY` and a referrer
  policy; body size is capped at 50 MB to match the backend.

## Local smoke test

```bash
docker run --rm -p 8080:8080 -e PORT=8080 --env-file server/.env  <server-image>
docker run --rm -p 8081:8081 -e PORT=8081 --env-file ai-service/.env <ai-image>
docker run --rm -p 8082:8082 -e PORT=8082 -e BACKEND_HOST=<server-host> <client-image>
```

Locally the Node backend sends only `X-AI-Service-Key` (no metadata server
exists off-GCP); on Cloud Run it detects `K_SERVICE` and adds the ID token
automatically. Set `AI_ID_TOKEN=off` to suppress tokens even on Cloud Run
(e.g. if the AI service were ever made public again).
