# AI Log — Camera Performance and AI-Service Debugging
**Date:** 2026-06-16
**Branch:** Not recorded
**Tool:** Codex (gpt-5.5)
**Project:** FlowGuard
**Source session:** `019ecc16-f841-7f70-9923-433e822a4b31`

**Archive note:** User-authored prompts are reproduced verbatim except that credential-like values are replaced with `[REDACTED]`. Internal auto-review, subagent, command, and tool-notification records are omitted.

---

## Task 1 — ok so right now this folder right i think cause we are using yolo and insights models t…

**Prompt date/time:** 2026-06-16 00:23:27 SGT

**Prompt (verbatim):**

> ok so right now this folder right i think cause we are using yolo and insights models then very laggy then also the camera quality enough bad on laptop already is there any way that can reduce the lagness of both camera and the lag on the laptop

**Response summary:** The archived final response for this task stated:

> Done. I made the camera/AI path lighter across the project.
>
> Changed:
> - [ai-service/main.py](C:/Users/felth/Downloads/FlowGuard/ai-service/main.py): reduced camera stream to `640x360`, capped YOLO to ~8 FPS, lowered YOLO inference size, filtered YOLO to only useful classes, lowered JPEG stream quality, and stopped running InsightFace on every person every frame.
> - [client/src/pages/GateScanner.jsx](C:/Users/felth/Downloads/FlowGuard/client/src/pages/GateScanner.jsx): lower webcam resolution/FPS, smaller image upload to AI, slower scan interval, and prevents overlapping AI requests.
> - [client/src/pages/VPatrol.jsx](C:/Users/felth/Downloads/FlowGuard/client/src/pages/VPatrol.jsx): same lighter webcam settings and smaller scan images.
> - [client/src/pages/FaceEnrollment.jsx](C:/Users/felth/Downloads/FlowGuard/client/src/pages/FaceEnrollment.jsx): captures smaller JPEGs so enrollment doesn’t send huge images.
> - Fixed test scripts to use the actual `yolov8n.pt` model and lighter settings.
>
> You can tune further in `ai-service/.env` if still laggy:
>
> ```env
> YOLO_FPS=5
> STREAM_FPS=8
> YOLO_IMG_SIZE=320
> FACE_RECOG_EVERY_N_FRAMES=8
> ```
>
> Verification:
> - Frontend build passes: `npm.cmd run build`
> - Python syntax check passes using bundled Python
> - `npm lint` still fails, but because of many existing unrelated lint errors across the React app.

**Outcome:** A final response was recorded in the source session.

---

## Task 2 — ## Screenshot 2026-06-16 003428.png: C:/Users/felth/OneDrive/Pictures/Laptop Screenshot…

**Prompt date/time:** 2026-06-16 00:36:34 SGT

**Prompt (verbatim):**

> # Files mentioned by the user:
>
> ## Screenshot 2026-06-16 003428.png: C:/Users/felth/OneDrive/Pictures/Laptop Screenshots/Screenshot 2026-06-16 003428.png
>
> ## My request for Codex:
> AggregateError [ECONNREFUSED]:
>     at internalConnectMultiple (node:net:1193:18)
>     at afterConnectMultiple (node:net:1783:7)
> 12:32:35 am [vite] http proxy error: /api/yolo/people-count
> AggregateError [ECONNREFUSED]:
>     at internalConnectMultiple (node:net:1193:18)
>     at afterConnectMultiple (node:net:1783:7)
> 12:32:40 am [vite] http proxy error: /user/recognize
> AggregateError [ECONNREFUSED]:
>     at internalConnectMultiple (node:net:1193:18)
>     at afterConnectMultiple (node:net:1783:7)
> 12:32:41 am [vite] http proxy error: /user/recognize
> AggregateError [ECONNREFUSED]:
>     at internalConnectMultiple (node:net:1193:18)
>     at afterConnectMultiple (node:net:1783:7) (x2)
> 12:32:42 am [vite] http proxy error: /user/recognize
> AggregateError [ECONNREFUSED]:
>     at internalConnectMultiple (node:net:1193:18)
>     at afterConnectMultiple (node:net:1783:7) (x3)
> 12:32:43 am [vite] http proxy error: /api/yolo/stream
> AggregateError [ECONNREFUSED]:
>     at internalConnectMultiple (node:net:1193:18)
>     at afterConnectMultiple (node:net:1783:7)
> 12:32:43 am [vite] http proxy error: /api/yolo/people-count
> AggregateError [ECONNREFUSED]:
>     at internalConnectMultiple (node:net:1193:18)
>     at afterConnectMultiple (node:net:1783:7)
> 12:32:48 am [vite] http proxy error: /api/yolo/people-count
> AggregateError [ECONNREFUSED]:
>     at internalConnectMultiple (node:net:1193:18) its supposed to show my face and like if im registered in the system it should show my name or else as suspicious person or smth [16/6/2026 12:36 am] fel:): Hi Ms. Vera,
> I am writing to share our team's finalized feature distribution for the FlowGuard project, addressing Problem Statement 5B (Asset & Manpower Monitoring).
> To ensure we meet the project rubrics, we have structured our system into four distinct, full-stack CRUD applications. Charlisa and I are handling the core AI data management, while Lucas and Gladwin are building the operational support infrastructure around it.
> Here is our team's detailed CRUD breakdown:
> Module 1: Facial Recognition & Access Management (Felicia)
> Focus: Managing biometric identities, unit-level access control, and security logs.
> Create (C): A UI to register new tenants. The React frontend captures the facial image via webcam, the Python AI generates the vector matrix, and the Node.js backend saves the data into our PostgreSQL database utilizing the pgvector extension.
> Read (R): A real-time V-Patrol dashboard that queries the database to display a daily timeline of "Access Granted" events alongside critical "Intrusion/Tailgating Alerts."
> Update (U): A profile management interface for Facilities Management (FM) to update access permissions (e.g., upgrading to VIP) or overwrite an existing facial vector with a newer scan if recognition struggles.
> Delete (D): An off-boarding function that completely deletes a tenant’s profile, access history, and biometric vectors when a lease ends, ensuring PDPA compliance.
> Module 2: Object Detection & Space Management (Charlisa)
> Focus: Processing spatial data to monitor unattended assets, building density, and zone rules.
> Create (C): A UI for FM to create new "Monitoring Zones" (e.g., Corridor A) and establish AI rules (e.g., a 2-minute limit for unattended items). The AI also automatically creates an incident log when an unattended pallet is detected.
> Read (R): A spatial analytics dashboard displaying live people-counting metrics alongside a real-time feed of active "Unattended Item" alerts.
> Update (U): An interface to update zone rules (e.g., extending the timer to 5 minutes) and update an active alert’s status to "Cleared" once a staff member removes the obstruction.
> Delete (D): Functions to delete temporary monitoring zones and an automated backend script to purge routine object detection logs after 30 days to optimize storage.
> Module 3: AI Helpdesk & Facility Support (Lucas)
> Focus: Managing an AI chatbot interface for tenant inquiries and an FM ticketing system for unresolved FR/OD escalations.
> Create (C): Tenants interact with an AI support bot. Interactions are logged into a Chat_Transcripts table. If unresolved, the backend automatically generates a high-priority row in the Support_Tickets table for the FM team.
> Read (R): A secure dashboard querying the database to display escalated manual tickets, alongside linked AI chat transcripts so staff can read previous troubleshooting steps.
> Update (U): FM staff can update a ticket's status from "Pending" to "Resolved" after physical intervention. FM can also update the chatbot's vector knowledge base (e.g., adding a new FAQ) to improve future responses.
> Delete (D): Functions to archive or hard-delete closed/spam support tickets, plus a Cron job that deletes routine, unescalated transcripts after 90 days for data retention compliance.
> Module 4: Incident Tracking & Resolution (Gladwin)
> Focus: Centralized management and resolution tracking for security breaches and spatial anomalies.
> Create (C): The backend automatically creates a tracked incident report whenever the AI triggers a critical alert. FM can also manually create a new incident record if they spot a hazard on the CCTV feed.
> Read (R): A centralized "Security Command Center" dashboard featuring a sortable, filterable table of all active incidents categorized by severity, location, and AI source.
> Update (U): FM staff can update an incident's status through the resolution pipeline (e.g., "Investigating" to "Cleared") and append manual resolution notes to the automated log.
> [16/6/2026 12:36 am] fel:): Delete (D): FM can permanently delete false-positive incidents generated by the AI to keep analytics accurate, alongside an archiving function for resolved incidents at the end of each month.
> Please let us know if this architecture aligns well with the module's grading rubrics or if you have any feedback on our structural mapping!
> Best regards,
> Felicia Tan
> IT2115-03 Group 11 Leader object detection ah
>
> <image name=[Image #1] path="C:\Users\felth\OneDrive\Pictures\Laptop Screenshots\Screenshot 2026-06-16 003428.png">
> </image>

**Response summary:** The archived final response for this task stated:

> Fixed the object detection side so it behaves better for your demo.
>
> What was happening:
> `ECONNREFUSED` means Vite is trying to call the Python AI service on port `8500`, but Python is not running or crashed. The black stream means Python opened the camera but got no usable image, often because another page/app is already using the webcam.
>
> I changed:
> - [ai-service/main.py](C:/Users/felth/Downloads/FlowGuard/ai-service/main.py): camera now tries multiple camera backends/indexes, detects black frames, and shows an on-stream message like `Camera unavailable` instead of a silent black feed.
> - [ai-service/main.py](C:/Users/felth/Downloads/FlowGuard/ai-service/main.py): unknown detected people now show `SUSPICIOUS PERSON`; registered users still show their saved name if their face vector exists in the DB.
> - [client/src/pages/ObjectDetection.jsx](C:/Users/felth/Downloads/FlowGuard/client/src/pages/ObjectDetection.jsx): added camera status display and stream recovery when AI comes back online.
> - Removed `--reload` from the recommended AI command because reload can spawn another process and fight for the webcam.
>
> Run AI like this from `ai-service`:
>
> ```powershell
> uvicorn main:app --host 0.0.0.0 --port 8500
> ```
>
> Important for demo: close `V-Patrol`, `GateScanner`, Teams/Zoom/Camera app before opening Object Detection, because laptop webcams usually only allow one owner. If it still says wrong/black camera, try:
>
> ```powershell
> $env:CAMERA_INDEX="1"
> uvicorn main:app --host 0.0.0.0 --port 8500
> ```
>
> Verified:
> - Python syntax check passed.
> - React production build passed.

**Outcome:** A final response was recorded in the source session.

---

## Task 3 — this object changes never affect the facial reco part right technically i just need the…

**Prompt date/time:** 2026-06-16 00:58:49 SGT

**Prompt (verbatim):**

> this object changes never affect the facial reco part right technically i just need the object and facial camera quality dont lag and also doesnt make the whole website lag all too

**Response summary:** The archived final response for this task stated:

> Correct, the object detection changes should not break the main facial recognition flow.
>
> They share the same Python AI service and InsightFace model, but I only made the camera/inference lighter:
> - Object Detection YOLO stream: lower FPS/resolution, better camera fallback, black-frame status.
> - Face pages: lower browser camera resolution and smaller uploaded JPEGs.
> - Facial recognition logic itself: still compares your face vector against registered DB vectors the same way.
> - Enrollment still sends front/left/right photos, just compressed so laptop doesn’t suffer.
>
> The main thing to remember: laptop webcam can usually only be used by one feature at a time. So don’t open Object Detection and V-Patrol/GateScanner together during demo. If both are open, one may show black or lag.
>
> For least lag during demo:
> 1. Start Node server.
> 2. Start Python AI without reload:
>    ```powershell
>    uvicorn main:app --host 0.0.0.0 --port 8500
>    ```
> 3. Open only the page you are demoing.
> 4. Close Teams/Zoom/Windows Camera.
>
> So yes: the goal is exactly what you said: object camera and facial camera should be less laggy, and the whole website should stay smoother.

**Outcome:** A final response was recorded in the source session.

---

## Task 4 — ## Screenshot 2026-06-16 010252.png: C:/Users/felth/OneDrive/Pictures/Laptop Screenshot…

**Prompt date/time:** 2026-06-16 01:03:11 SGT

**Prompt (verbatim):**

> # Files mentioned by the user:
>
> ## Screenshot 2026-06-16 010252.png: C:/Users/felth/OneDrive/Pictures/Laptop Screenshots/Screenshot 2026-06-16 010252.png
>
> ## My request for Codex:
> why the other pages camera can work but object cannot work whats going on
>
> <image name=[Image #1] path="C:\Users\felth\OneDrive\Pictures\Laptop Screenshots\Screenshot 2026-06-16 010252.png">
> </image>

**Response summary:** The archived final response for this task stated:

> Because the other pages use the browser camera, but Object Detection was using Python/OpenCV to open the webcam separately.
>
> So the situation was:
>
> - `V-Patrol`, `GateScanner`, enrollment: Chrome opens camera with `navigator.mediaDevices.getUserMedia(...)`
> - Object Detection: Python tries `cv2.VideoCapture(0)` on the backend
>
> That means Chrome can work while Python cannot. Windows laptop webcams are fussy like that, especially if another tab/page already touched the camera.
>
> I changed Object Detection to use the same style as the other pages now:
> - Browser owns the webcam.
> - React captures small frames.
> - Python only receives each frame and runs YOLO/face matching.
> - Python no longer auto-grabs the webcam on startup unless `USE_SERVER_CAMERA=true`.
>
> So after this, Object Detection should not show `CAMERA_UNAVAILABLE` because Python is not opening the camera anymore.
>
> You need to restart both:
> ```powershell
> # ai-service folder
> uvicorn main:app --host 0.0.0.0 --port 8500
> ```
>
> And restart Vite too:
> ```powershell
> # client folder
> npm run dev
> ```
>
> Then refresh Object Detection and allow camera permission. It should show browser camera frames with YOLO boxes, registered names if found, otherwise `SUSPICIOUS PERSON`.
>
> Verified:
> - Python syntax check passed.
> - React build passed.

**Outcome:** A final response was recorded in the source session.

---

## Task 5 — INFO: Started server process [16700] INFO: Waiting for application startup. ❌ DB Load E…

**Prompt date/time:** 2026-06-16 01:15:05 SGT

**Prompt (verbatim):**

> INFO:     Started server process [16700]
> INFO:     Waiting for application startup.
> ❌ DB Load Error: the JSON object must be str, bytes or bytearray, not list
> Server camera stream disabled; using browser-captured frames for YOLO.
> INFO:     Application startup complete.
> ERROR:    [Errno 10048] error while attempting to bind on address ('0.0.0.0', 8500): [winerror 10048] only one usage of each socket address (protocol/network address/port) is normally permitted
> INFO:     Waiting for application shutdown.
> INFO:     Application shutdown complete. and also why the object page camera it works but super laggy its not like the vpatrol etc the lower quality works smoothly

**Response summary:** The archived final response for this task stated:

> Yes, now I see exactly why.
>
> The other camera pages worked because they use the **browser camera**. Object Detection was different: Python tried to open the webcam separately with OpenCV. So your browser could access the camera, but Python could fail or fight with the browser.
>
> I changed Object Detection again so it now works like V-Patrol:
> - Browser shows the live camera smoothly.
> - React sends small frames to Python every ~1.4s.
> - Python returns only detection boxes/labels as JSON.
> - The page draws YOLO boxes on top of the smooth live video.
> - No more Python-owned webcam for Object Detection by default.
>
> Also fixed this:
> ```text
> DB Load Error: the JSON object must be str, bytes or bytearray, not list
> ```
> Your DB `faceVector` was already a list, so Python shouldn’t `json.loads()` it. Fixed.
>
> The port error:
> ```text
> [WinError 10048] ... port 8500
> ```
> means another AI service was already running on `8500`. Close the old AI terminal first, or find it with:
>
> ```powershell
> netstat -ano | findstr :8500
> ```
>
> Then kill that PID if needed:
>
> ```powershell
> taskkill /PID <PID_NUMBER> /F
> ```
>
> Then restart:
>
> ```powershell
> # ai-service
> uvicorn main:app --host 0.0.0.0 --port 8500
>
> # client
> npm run dev
> ```
>
> Verified:
> - Python syntax check passed.
> - React build passed.

**Outcome:** A final response was recorded in the source session.

---

## Task 6 — ## Screenshot 2026-06-16 012514.png: C:/Users/felth/OneDrive/Pictures/Laptop Screenshot…

**Prompt date/time:** 2026-06-16 01:25:47 SGT

**Prompt (verbatim):**

> # Files mentioned by the user:
>
> ## Screenshot 2026-06-16 012514.png: C:/Users/felth/OneDrive/Pictures/Laptop Screenshots/Screenshot 2026-06-16 012514.png
>
> ## Screenshot 2026-06-16 012520.png: C:/Users/felth/OneDrive/Pictures/Laptop Screenshots/Screenshot 2026-06-16 012520.png
>
> ## Screenshot 2026-06-16 012523.png: C:/Users/felth/OneDrive/Pictures/Laptop Screenshots/Screenshot 2026-06-16 012523.png
>
> ## My request for Codex:
> INFO:     Started server process [5468]
> INFO:     Waiting for application startup.
> ✅ Security Scan Ready: 1 enrolled members loaded.
> Server camera stream disabled; using browser-captured frames for YOLO.
> INFO:     Application startup complete.
> ERROR:    [Errno 10048] error while attempting to bind on address ('0.0.0.0', 8500): [winerror 10048] only one usage of each socket address (protocol/network address/port) is normally permitted
> INFO:     Waiting for application shutdown.
> INFO:     Application shutdown complete. bro where is the cam now
>
> <image name=[Image #1] path="C:\Users\felth\OneDrive\Pictures\Laptop Screenshots\Screenshot 2026-06-16 012514.png">
> </image>
> <image name=[Image #2] path="C:\Users\felth\OneDrive\Pictures\Laptop Screenshots\Screenshot 2026-06-16 012520.png">
> </image>
> <image name=[Image #3] path="C:\Users\felth\OneDrive\Pictures\Laptop Screenshots\Screenshot 2026-06-16 012523.png">
> </image>

**Response summary:** The archived final response for this task stated:

> The cam is not gone. Two things were making it look gone:
>
> 1. Your AI service restart failed because port `8500` is already used:
>    ```text
>    WinError 10048 ... port 8500
>    ```
>    That means an old Python AI service is already running. Starting another one fails immediately.
>
> 2. The browser camera was attaching, but Chrome can sit on a black video frame unless we explicitly call `video.play()` after metadata loads. I patched Object Detection, V-Patrol, and GateScanner to force-play the webcam stream.
>
> I also stopped Object Detection’s old backend poll from overwriting the camera label back to `CAMERA: STARTING`.
>
> Do this now:
>
> ```powershell
> netstat -ano | findstr :8500
> ```
>
> Find the PID at the far right, then:
>
> ```powershell
> taskkill /PID <PID_NUMBER> /F
> ```
>
> Then restart only one AI server:
>
> ```powershell
> cd C:\Users\felth\Downloads\FlowGuard\ai-service
> uvicorn main:app --host 0.0.0.0 --port 8500
> ```
>
> Also restart Vite so the new camera fix loads:
>
> ```powershell
> cd C:\Users\felth\Downloads\FlowGuard\client
> npm run dev
> ```
>
> Then refresh the page and allow camera permission. Object Detection should show live camera video first, with YOLO boxes updating on top. Verified build passes.

**Outcome:** A final response was recorded in the source session.
