# 🏭 FlowGuard: Harrison Food Factory Monitoring System

**Project Type:** Full-Stack AI Proof of Concept (PoC)

**Problem Statement:** 5B - Asset & Manpower Monitoring

**Industry Sector:** Manufacturing

## 📋 Project Overview

FlowGuard is an integrated facility management platform designed for the upcoming **Harrison Food Factory** (TOL 2027). This system automates security, compliance, and logistics monitoring to reduce manual manpower requirements by **40–50%**.

---

## 🛠 Technical Stack

* **Frontend:** React.js (Vite + JavaScript + SWC) with Material UI (MUI)
* **Backend:** Node.js + Express (JavaScript)
* **Database:** PostgreSQL (Hosted on Render)
* **ORM:** Sequelize
* **Validation:** Yup & Formik

---

## 🌿 Branching Strategy (1 Feature, 1 Person)

To maintain a stable codebase, we follow a feature-branching workflow. **Do not commit directly to&#x20;**`Main`**.**

### **1. Create a Feature Branch**

Before starting your assigned module, sync your local repo and create a new branch:

Bash

```css
git checkout Main
git pull origin Main
git checkout -b feature/[your-feature-name]
```

_Example:&#x20;_`feature/ppe-detection`_&#x20;or&#x20;_`feature/temp-monitoring`

### **2. Development & Syncing**

* Commit your changes frequently with descriptive messages.
* Push your branch to GitHub: `git push origin feature/[your-feature-name]`.

### **3. Merging to Main**

1. Open a **Pull Request (PR)** on GitHub once the feature is tested.
2. Assign a teammate (Charlisa, Yan Qing, or Iden) to review your code.
3. Merge into `Main` only after approval.

---

## 🚀 Setup Instructions for the Team

### 1. Install Dependencies

You **must** run `npm install` in both folders to sync the `package.json` blueprints:

**Client (Frontend):**

Bash

```css
cd client
npm install
```

**Server (Backend):**

Bash

```css
cd ../server
npm install
```

### 2. Environment Configuration

Create a `.env` file in the `/server` directory to store your database credentials. **Never commit this file to GitHub.**

Code snippet

```css
DB_URL=postgres://your_render_url_here
```

### 3. Starting the App

**Run Backend:**

Bash

```css
# Inside /server
npm start
```

**Run Frontend:**

Bash

```css
# Inside /client
npm run dev
```

---

## 🏗 Key Modules

* **AI CCTV Analytics:** Monitoring for unauthorized access and PPE compliance.
* **Environmental Monitoring:** Real-time temperature/humidity tracking for cold-chain safety.
* **Smart Loading Bay:** License plate recognition and traffic management.
* **AI Dashboard:** Centralized UI using **MUI Components** for incident tracking.

---

## 🛡 Team Protocols

* **Syncing:** Always pull the latest `Main` before starting a new feature.
* **Package Management:** If you install a new library (e.g., `npm i axios`), you **must** commit the updated `package.json` so the team stays in sync.
* **Database:** We use a shared PostgreSQL instance. Coordinate with Felicia before running scripts that might drop or alter shared tables.