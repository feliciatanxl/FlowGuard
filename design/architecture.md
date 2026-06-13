# FlowGuard – System Architecture

FlowGuard is a three-tier application: a React frontend, a Node.js/Express backend, and a
dedicated Python AI microservice, backed by a PostgreSQL database. See
`architecture-diagram.md` (and `.png`) for the visual, and `er-diagram.md` for the data model.

## 1. Folder structure

### `client/` (React + Vite frontend)
- `src/pages/` — route-level screens (e.g. `FaceEnrollment.jsx`, `GateScanner.jsx`,
  `VPatrol.jsx`, `Dashboard.jsx`, `Login.jsx`, public pages).
- `src/components/` — reusable UI pieces (NavBar, Sidebar, ProtectedRoute, AIChatPopup, etc.).
- `src/css/` — per-page/component stylesheets (enterprise dark-mode).
- `src/assets/` — images and static media.
- `App.jsx` / `main.jsx` — app shell and routing entry point.

### `server/` (Node.js + Express backend)
- `routes/` — Express routers grouped by domain (`user`, `attendance`, `booking`,
  `incident`, `security`).
- `models/` — Sequelize models and associations (`index.js` wires them up).
- `middlewares/` — `auth.js` (JWT verification + role-based access control).
- `index.js` — server entry point; `seed.js` — seeds the FM admin account.

### `ai-service/` (Python + FastAPI)
- `main.py` — FastAPI app exposing the face endpoints (`/api/encode-faces`, `/user/recognize`,
  `/refresh`); loads registered embeddings from PostgreSQL on startup.
- `requirements.txt` — pinned Python dependencies.
- `test/` — model/sanity scripts for InsightFace, YOLO, and webcam capture.

## 2. Third-party services
- **Google reCAPTCHA** — bot protection on registration and login.
- **Browser MediaDevices (webcam) API** — captures face images on the client for enrolment
  and gate scanning.

## 3. Generative / AI services
- **InsightFace** (Python, in `ai-service`) — generates 512-dimension face embeddings and
  performs recognition by cosine similarity against registered users.
- **Ultralytics YOLO** — object/person detection (teammate's module; runs as a separate
  service). Listed here as part of the integrated system.

## 4. Cloud services (deployment)
- **Vercel** — hosts the React frontend (auto-deploys on push to `main`).
- **Render** — hosts the Node.js backend and the Python AI service; stores environment variables.
- **Neon / Render PostgreSQL** — managed PostgreSQL with the `pgvector` extension for
  storing face embeddings.
- **Cloudinary** — image storage (used only if uploaded photos are persisted; optional for PoC).

All secrets (DB credentials, JWT secret, reCAPTCHA key) are supplied via environment
variables; see each tier's `.env.example`.