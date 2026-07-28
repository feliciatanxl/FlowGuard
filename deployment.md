# FlowGuard Google Cloud deployment

This document records the current repository-backed deployment design. It contains environment-variable names and placeholders only; it does not contain credentials.

## Current architecture

| Tier | Google Cloud service | Access | Verified detail |
|---|---|---|---|
| React client | Cloud Run `flowguard-client`, Nginx static SPA/reverse proxy | Public | Repository-configured region `asia-southeast1`; staging URL below returned HTTP 200 on 28 July 2026. |
| Node API | Cloud Run `flowguard-server` | Public through the client proxy and API URL | Direct public URL is not recorded as a verified value in the repository. |
| FastAPI AI | Cloud Run `flowguard-ai` | **Private/authenticated** | `--no-allow-unauthenticated`; Node service account needs `roles/run.invoker`; app key remains defence in depth. No public URL is published. |
| Database | Cloud SQL for PostgreSQL | Private application data service | Instance and database names are not verified in repository files. |
| Secrets | Secret Manager and Cloud Run secret bindings | Runtime service identities | Real values must never enter source, images, build arguments, or `VITE_` variables. |
| Images/build | Artifact Registry and Cloud Build | Deployment pipeline | Repository documents image tags and `gcloud builds submit`; Developer Connect/trigger names and branch filters are not checked in and remain evidence to capture from Google Cloud Console. |

Repository-configured Google Cloud project/region: `flowguard-502613`, `asia-southeast1`. These values are present in `deployment/cloud-run/README.md`; the `gcloud` CLI was unavailable on the audit machine, so live console state was not queried.

## Verified public URLs

| Surface | URL | Audit status |
|---|---|---|
| Client | <https://flowguard-client-staging-590663319889.asia-southeast1.run.app> | Verified with HTTP 200 and `Google Frontend` response on 28 July 2026. |
| Node server | Not stated | Direct service URL not independently verified; the client proxies `/api/*` and `/user/*` to Node through runtime `BACKEND_HOST`. |
| AI service | Not published | Intentionally private; authentication is required. |

Do not replace missing URLs with guessed Cloud Run hostnames.

## Request and trust flow

1. Browser requests the public Cloud Run client.
2. Nginx serves the React SPA and proxies `/api/*` and `/user/*` to the Node Cloud Run service.
3. Node validates application JWT/RBAC before forwarding facial, QR, or YOLO work.
4. Node obtains a Google ID token for the AI service audience and supplies `X-AI-Service-Key`.
5. Private FastAPI performs transient inference. Node remains authoritative for users, bookings, gate decisions, and audit writes.
6. Node/FastAPI use Cloud SQL PostgreSQL. SecurePi sends authenticated outbound alert events to Node.

Local browser QR detection does not leave the browser. Cloud QR fallback is Browser -> Node `/api/qr/decode` -> private FastAPI `/api/qr/decode`.

## Build and trigger flow

The checked-in Dockerfiles build these images:

```bash
REG=asia-southeast1-docker.pkg.dev/flowguard-502613/flowguard-containers
docker build -t $REG/flowguard-server:<revision> server/
docker build -t $REG/flowguard-ai:<revision> ai-service/
docker build -t $REG/flowguard-client:<revision> client/
```

`deployment/cloud-run/README.md` also documents `gcloud builds submit` and Cloud Run deployment commands. If Developer Connect/Cloud Build triggers are used, submission evidence still needs the actual connection, repository, trigger name, branch pattern, successful build ID, and resulting Cloud Run revision screenshot/export. No trigger YAML or live trigger output is available in this repository.

Suggested branch flow: merge reviewed work to the configured deployment branch -> Developer Connect/Cloud Build trigger -> build tagged images -> push to Artifact Registry -> deploy a new Cloud Run revision -> smoke test -> shift traffic. The actual trigger branch must be copied from Google Cloud, not inferred from the current local Git branch.

## Environment-variable names

### `flowguard-server`

Plain configuration: `NODE_ENV`, `APP_PORT` (local only; Cloud Run injects `PORT`), `CLIENT_URL`, `FRONTEND_URL`, `ALLOWED_ORIGINS`, `TRUST_PROXY`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_SYNC_ALTER`, `FACE_AI_URL`, `PYTHON_AI_URL`, `AI_ID_TOKEN`, `GATE_EARLY_MINUTES`, `GATE_LATE_MINUTES`, `WHATSAPP_ENABLED`, `WHATSAPP_API_URL`, `WHATSAPP_PHONE_NUMBER_ID`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `MAIL_FROM`, and the `RATE_LIMIT_*` overrides.

Secret Manager candidates: `APP_SECRET`, `DB_PWD`, `AI_SERVICE_KEY`, `RECAPTCHA_SECRET_KEY`, `SMTP_PASS`, `EDGE_INGEST_TOKEN`, `EDGE_SERVICE_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, and optional `WHATSAPP_API_KEY`.

### `flowguard-ai`

Plain configuration: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `NODE_SERVER_URL`, `USE_SERVER_CAMERA=false`, `FACE_CTX_ID=-1`, `FACE_MODEL_NAME`, `FACE_DET_SIZE`, `TRACK_DET_SIZE`, `YOLO_IMG_SIZE`, `YOLO_CONFIDENCE`, `AI_CAMERA_LOCATION`, and optional `ALLOWED_ORIGINS` for local use.

Secrets: `DB_PWD`, `AI_SERVICE_KEY`.

### `flowguard-client`

Runtime: `BACKEND_HOST` is a hostname without a scheme for the Nginx template. Build-time public variables include `VITE_RECAPTCHA_SITE_KEY`. `VITE_API_BASE_URL` stays empty for the same-origin Cloud Run/Nginx design. Production should leave `VITE_PI_CAMERA_*` unset unless an explicitly reachable, secure Pi gateway exists.

## CORS, proxy, and rate-limit requirements

- Set `NODE_ENV=production` and configure the exact client origin in `CLIENT_URL`, `FRONTEND_URL`, or `ALLOWED_ORIGINS`. Production/staging fails closed if no origin exists.
- Set `TRUST_PROXY=1` for the single Cloud Run proxy hop unless the deployed topology proves a different hop count. Never trust every proxy.
- The current `express-rate-limit` store is `MemoryStore`. Quotas reset on cold start and apply per Node instance; autoscaling means this is not a global distributed limit. A shared store is required for production-wide enforcement.
- The client uses credentials with an exact-origin allowlist; do not combine credentialed CORS with a wildcard.

## Storage and privacy

- Facial enrolment images, recognition frames, QR images, and plate images are transient request memory/canvas data and are not permanently stored by the current PoC.
- PostgreSQL stores the facial `FLOAT[]` embedding and audit/operational metadata.
- Detection alerts may store `snapshot_url`/`snapshot_path` metadata; SecurePi can keep local snapshots. This is not a general Cloud Storage upload pipeline.
- InsightFace and YOLO models are baked into the AI container image. No model download is required per request.
- Current scope does not require persistent user-upload storage.

## Local container validation

Use explicit local-only tags:

```bash
docker build -t flowguard-server:local server/
docker build -t flowguard-ai:local ai-service/
docker build -t flowguard-client:local client/

docker run --rm -p 8080:8080 -e PORT=8080 --env-file server/.env flowguard-server:local
docker run --rm -p 8081:8081 -e PORT=8081 --env-file ai-service/.env flowguard-ai:local
docker run --rm -p 8082:8082 -e PORT=8082 -e BACKEND_HOST=<server-host> flowguard-client:local
```

Never paste real environment values into shell history, documentation, Dockerfiles, or build arguments.

## Rollback and revision handling

1. Record the current serving revisions and image digests before changing traffic.
2. Deploy with immutable revision/image tags rather than reusing `latest`.
3. Smoke-test client deep links, Node health, login/RBAC, private AI invocation, database access, Driver Pass, and CORS.
4. If validation fails, route traffic back to the last known-good Cloud Run revision; do not rebuild an old tag in place.
5. Database changes require a separate rollback plan. Normal startup uses `DB_SYNC_ALTER=false`; do not use schema alteration as an automatic rollback mechanism.
6. Keep the AI service private throughout rollback. Do not temporarily enable unauthenticated access to diagnose invocation failures.

## Remaining deployment evidence

- Direct Node service URL and health response.
- Cloud SQL instance/database name, region, connectivity method, backup status, and least-privilege database user evidence.
- Private AI IAM policy showing only the intended invoker identity.
- Secret Manager bindings without secret values.
- Developer Connect/Cloud Build trigger name, branch rule, recent successful build, and deployed revision mapping.
- Rollback exercise or revision traffic-shift evidence.
