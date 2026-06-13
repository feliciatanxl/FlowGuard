# 🏭 FlowGuard: Harrison Food Factory Monitoring System 🚀

FlowGuard is an enterprise-grade AI facility management platform and Command Center
designed for the upcoming **Harrison Food Factory (TOL 2027)**. It automates security,
compliance, and logistics monitoring by integrating machine-learning models with existing
CCTV networks — turning passive surveillance into proactive facility management, with a
target of **reducing manual security man-hours by 50%**. 📉✨

**SCCCI AI Challenge — Problem Statement 5B (Asset & Manpower Monitoring)**
**Team:** IT2115-03, Group 11

---

## 📌 The Problem & How FlowGuard Solves It

Harrison Food Factory has 10–30 entry points, multiple tenants, and 2 loading bays, all
currently monitored **manually** by facility-management and security staff. This is
labour-intensive and error-prone: there is no integrated, predictive system, so staff
rely on human observation to catch unauthorised access, unattended assets, and incidents.

FlowGuard addresses this with a full-stack web app backed by a Python AI service that
**automates detection, tracking, and alerting** across four integrated modules. Each
module is a complete CRUD application, so FM staff can configure rules, monitor live
activity, and resolve incidents from one Command Center — cutting routine monitoring
workload and freeing staff for higher-value work.

> **PoC scope:** This proof of concept focuses on the **CCTV + AI monitoring and
> operations layer**. Environmental sensors (temperature/humidity) and pest detection
> require IoT hardware beyond a web app and are documented as **future scope**.

---

## 👥 Task Allocation

Each member owns one full-stack module (Create, Read, Update, Delete + enhancements).
User accounts/authentication are a shared feature across the team.

| Module | Owner | Responsibility |
|--------|-------|----------------|
| **Facial Recognition & Access Management** | **Felicia (Tan Xiu Li)** | Biometric enrolment (auto webcam scan + manual photo upload), live gate recognition, access-permission management, PDPA-compliant off-boarding, security logs |
| **Object Detection & Space Management** | **Charlisa** | Monitoring zones & AI rules, unattended-item detection, people-counting/density analytics, alert lifecycle, log purging |
| **AI Helpdesk & Facility Support** | **Lucas** | AI support chatbot, chat-transcript logging, FM ticketing & escalation, knowledge-base updates |
| **Incident Tracking & Resolution** | **Gladwin** | Centralised incident dashboard, automatic + manual incident creation, resolution pipeline, archiving |
| **User Accounts & Auth (shared)** | All | Registration, login, JWT auth, role-based protected routes |

---

## 🛠️ Technical Stack

- **Frontend:** React.js (Vite + JavaScript + SWC)
- **Styling:** Custom enterprise dark-mode CSS (Flexbox & Grid) 🎨
- **Backend:** Node.js + Express ⚙️
- **AI Service:** Python + FastAPI 🧠
- **Computer-Vision Models:** InsightFace (faces) + Ultralytics YOLO (objects/people) 👁️
- **Database:** PostgreSQL (with `pgvector` for face embeddings) 🗄️
- **ORM:** Sequelize
- **Validation:** Yup & Formik ✅

---

## 💻 Running the Project Locally

### 1. Install frontend & backend dependencies 📦

```bash
cd client
npm install

cd ../server
npm install
```

### 2. Set up the Python AI service 🧠

```bash
cd ../ai-service
python -m venv .venv
# Windows PowerShell:  .venv\Scripts\Activate.ps1
# Windows CMD:         .venv\Scripts\activate
# macOS / Linux:       source .venv/bin/activate
pip install -r requirements.txt
```

The AI service uses **InsightFace** (facial recognition), **Ultralytics YOLO**
(object/person detection), **FastAPI**, **OpenCV**, and **ONNX Runtime / NumPy**.
If you add a package, refresh the lock file: `pip freeze > requirements.txt`.

### 3. Environment configuration 🔐

Copy each `.env.example` to a real `.env` and fill in your own values.
**Never commit a real `.env`.**

```bash
# server/.env
DB_HOST=your-host
DB_NAME=your-db
DB_USER=your-user
DB_PWD=your-password
JWT_SECRET=your-secret
FRONTEND_URL=http://localhost:5173
AI_SERVICE_URL=http://127.0.0.1:8500

# client/.env
VITE_API_URL=http://localhost:3000
```

### 4. Start the services 🏃‍♂️ (one terminal each)

```bash
# Terminal 1 — Frontend (React/Vite). --host exposes it on your local network,
# handy for testing webcam enrolment from a phone.
cd client && npm run dev -- --host

# Terminal 2 — Backend (Node/Express)
cd server && node index.js

# Terminal 3 — Facial-recognition AI (InsightFace) — MUST be port 8500
cd ai-service && uvicorn main:app --host 0.0.0.0 --port 8500 --reload

# Terminal 4 — Object-detection AI (YOLO)   ← confirm exact command + port
python main.py
```

> ⚠️ **The face AI must run on port 8500.** The backend calls
> `http://127.0.0.1:8500/api/encode-faces` directly, so starting it on the default
> port (8000) silently breaks face enrolment. Swagger docs: `http://127.0.0.1:8500/docs`.

**Seed a demo login:** run `node seed.js` once inside `server/` to create the FM admin
account → `admin@harrison.com` / `Admin123!`. Change the password after first login.

---

## 🛡️ Team Protocols

- 🔄 **Syncing:** Always pull the latest `main` before starting a feature to avoid conflicts.
- 📦 **Dependencies:** Update `package.json` / `requirements.txt` whenever you add a library.
- 🗄️ **Database:** Shared PostgreSQL instance — coordinate before running scripts that drop or alter shared tables.
- 🧠 **AI Service:** Always activate the `.venv` before running InsightFace/YOLO/FastAPI.
- 🔐 **Security:** Never commit `.env`, `.venv`, model artifacts, or private test images.