## **🏭 FlowGuard: Harrison Food Factory Monitoring System 🚀**

FlowGuard is an enterprise-grade AI facility management platform and Command Center designed for the upcoming Harrison Food Factory (TOL 2027). This system automates security, compliance, and logistics monitoring. By integrating machine learning models with existing CCTV networks, the platform transforms passive surveillance into proactive facility management, which is projected to **reduce manual security man-hours by 50%**. 📉✨

For the current proof of concept, the team’s primary implementation focus is on the **CCTV + AI monitoring pipeline**. This includes:

* **Facial Recognition** for identifying registered personnel and flagging unrecognized individuals
* **Object / Person Detection** for detecting people, unattended items, and occupancy activity
* **People Counting & Density Monitoring** for basic zone-based safety awareness and occupancy tracking

This CCTV-first approach allows the project to validate the most technically critical part of the system before expanding further into the broader smart factory ecosystem.

---

## **🛠️ Technical Stack**

* 🔹 **Frontend:** React.js (Vite + JavaScript + SWC)
* 🔹 **Styling:** Custom Enterprise Dark Mode CSS (Flexbox & Grid layouts) 🎨
* 🔹 **Backend:** Node.js + Express (JavaScript) ⚙️
* 🔹 **AI Service:** Python + FastAPI 🧠
* 🔹 **Computer Vision Models:** InsightFace + Ultralytics YOLO 👁️
* 🔹 **Database:** PostgreSQL (Hosted on Render) 🗄️
* 🔹 **ORM:** Sequelize
* 🔹 **Validation:** Yup & Formik ✅

---

## **🚀 Key Modules**

* 🖥️ **Command Center Dashboard:** Centralized UI hub for high-level facility metrics, recent AI activity, and visual data charts.
* 👁️ **CCTV AI Monitoring Engine:** Automated surveillance analysis for facial recognition, object/person detection, and occupancy monitoring.
* 🤖 **FlowGuard AI Concierge:** An interactive, floating chat assistant designed to quickly query facility protocols and system statuses.
* 🔐 **User Access Management:** Dynamic, mobile-responsive data tables handling role-based access control for security personnel.
* ⚙️ **System Configuration:** Advanced settings panel to adjust AI detection strictness thresholds, auto-record triggers, and camera feed quality.
* 🚚 **Smart Loading Bay & Environment:** License plate recognition, traffic management, and real-time temperature tracking for cold-chain safety.

---

## **💻 Setup Instructions for the Team**

### **1. Install Frontend and Backend Dependencies 📦**

You **must** run `npm install` in both folders to sync the `package.json` blueprints.

**Client:**

Bash

```css
cd client
npm install
```

**Server:**

Bash

```css
cd ../server
npm install
```

---

### **2. Set Up the AI Service (Python + CCTV Models) 🧠**

The AI microservice is kept in the `ai-service` folder and handles CCTV-related computer vision tasks separately from the main full-stack app.

#### **Step 1: Navigate into the AI service folder**

Bash

```css
cd ../ai-service
```

#### **Step 2: Create a Python virtual environment**

Bash

```css
python -m venv .venv
```

#### **Step 3: Activate the virtual environment**

**Windows PowerShell:**

Bash

```css
.venv\Scripts\Activate.ps1
```

**Windows CMD:**

Bash

```css
.venv\Scripts\activate
```

**macOS / Linux:**

Bash

```css
source .venv/bin/activate
```

Once activated, your terminal should display `(.venv)`.

#### **Step 4: Install AI / API dependencies**

Bash

```css
pip install fastapi uvicorn python-multipart
pip install ultralytics insightface onnxruntime opencv-python numpy
```

These packages support:

* **InsightFace** → facial recognition
* **Ultralytics YOLO** → object/person detection
* **FastAPI** → AI microservice API layer
* **OpenCV** → webcam / image / frame processing

---

### **3. Environment Configuration 🔐**

Create a `.env` file in the `/server` directory to store your database credentials. **Never commit this file to GitHub.**

Bash

```css
DB_URL=postgres://your_render_url_here
```

If the AI service later requires environment variables, place them in a separate `.env` file inside `ai-service/` and do not commit them.

---

### **4. Starting the App 🏃‍♂️**

#### **Run Backend**

Bash

```css
cd server
npm start
```

#### **Run Frontend**

Bash

```css
cd client
npm run dev
```

#### **Run AI Service**

From the `ai-service` folder with the virtual environment activated:

Bash

```css
uvicorn main:app --reload
```

This will usually start the local AI service at:

```css
http://127.0.0.1:8000
```

Swagger API docs can be accessed at:

```css
http://127.0.0.1:8000/docs
```

---

## **👁️ CCTV AI Scope (Current PoC Focus)**

The current AI proof of concept focuses specifically on CCTV-based monitoring. The implementation is designed around two main pretrained model families:

### **InsightFace**

Used for:

* detecting faces from CCTV frames
* extracting face embeddings
* comparing live faces against registered personnel
* flagging unknown or unauthorized individuals

### **Ultralytics YOLO**

Used for:

* person detection
* unattended object detection
* occupancy / people counting logic
* future CCTV-based anomaly monitoring

This separation allows the project to keep the main React + Node.js system lightweight while offloading heavy computer vision processing into a dedicated Python AI service.

---

## **🛡️ Team Protocols**

* 🔄 **Syncing:** Always pull the latest `Main` branch before starting a new feature to avoid merge conflicts.
* 📦 **Package Management:** If you install a new library (e.g. `npm i axios` or a new Python package), you **must** update the relevant dependency file so the team stays in sync.
* 🗄️ **Database:** We use a shared PostgreSQL instance. Coordinate with the team before running scripts that might drop or alter shared tables.
* 🧠 **AI Service:** Always activate the Python virtual environment before running InsightFace, YOLO, or FastAPI scripts.
* 🔐 **Security:** Never commit `.env`, `.venv`, model artifacts, or private test images to GitHub.