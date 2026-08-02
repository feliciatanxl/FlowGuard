# AI Log — Facial Recognition Evaluation Hardening
**Date:** 2026-07-11
**Branch:** Not recorded
**Tool:** Codex (gpt-5.6-sol)
**Project:** FlowGuard
**Source session:** `019f4f97-c082-7202-a4cb-3382329a37a2`

**Archive note:** User-authored prompts are reproduced verbatim except that credential-like values are replaced with `[REDACTED]`. Internal auto-review, subagent, command, and tool-notification records are omitted.

---

## Task 1 — ## You are working inside the FlowGuard repository on branch: feature/smart-logist…: C:…

**Prompt date/time:** 2026-07-11 13:13:07 SGT

**Prompt (verbatim):**

> # Files mentioned by the user:
>
> ## You are working inside the FlowGuard repository on branch: feature/smart-logist…: C:\Users\felth\.codex/attachments/75f4bea8-cd5d-4b3b-a154-e3c930a30482/pasted-text.txt
>
> The attached pasted text file(s) contain the user's request. Read and act on that content.
>
> ## My request for Codex:
>
> [Attached text: pasted-text.txt]
>
> You are working inside the FlowGuard repository on branch:
>
> feature/smart-logistics-whatsapp
>
> This is an urgent real-world improvement pass before an interim review.
>
> First run:
>
> git status
> git branch --show-current
>
> Do not stage, commit, push, stash, reset, delete or overwrite unrelated work.
>
> Inspect the actual current implementation before editing. Do not rely on old summaries.
>
> Important current facts verified from the repository:
>
> - GateScanner.jsx and VPatrol.jsx already render LiveConfusionMatrixPanel on the same page.
> - Both currently use manual EvaluationRecorderModal after a recognition.
> - LiveConfusionMatrixPanel defaults to collapsed.
> - /api/facial-recognition/evaluate already exists and is FM-only and side-effect-free.
> - /api/facial-recognition/recognize may create SecurityLogs for unknown/suspended detections.
> - Gate Scanner operational mode writes Attendance.
> - V-Patrol operational mode writes an access-event but never Attendance.
> - evaluation records currently use localStorage.
> - actual labels currently sometimes default to P01, which must be removed.
> - Simulated CRUD scenarios are currently hardcoded and do not run uploaded photos through the real AI.
> - SafeMuiIcon and iconInterop already exist and must be preserved.
> - Current MUI icon interop fixes must not be reverted.
>
> ==================================================
> PRIORITY 1 — SAME-PAGE AUTOMATIC LIVE EVALUATION MODE
> ==================================================
>
> Files likely involved:
>
> client/src/pages/GateScanner.jsx
> client/src/pages/VPatrol.jsx
> client/src/components/LiveConfusionMatrixPanel.jsx
> client/src/components/EvaluationRecorderModal.jsx
> client/src/constants/evaluation.js
> client/src/css/VPatrol.css
> relevant tests
>
> Add a clear mode selector to both Gate Scanner and V-Patrol:
>
> [ Operational Mode ] [ Live Evaluation Mode ]
>
> Use state plus refs because the scan interval is created once and must always read
> the latest mode/configuration without stale closure bugs.
>
> Recommended state:
>
> scanMode: "operational" | "evaluation"
>
> evaluationConfig:
> - actualLabel: ""
> - condition: "Front"
> - autoRecord: true
>
> Use refs such as:
>
> scanModeRef
> evaluationConfigRef
> lastRecordedScanRef
>
> Keep state and refs synchronised.
>
> --------------------------------------
> A. Operational Mode
> --------------------------------------
>
> Gate Scanner must preserve:
>
> camera
> → /api/facial-recognition/recognize
> → identity/liveness
> → /api/attendance/scan
> → attendance result
>
> V-Patrol must preserve:
>
> camera
> → /api/facial-recognition/recognize
> → identity/liveness
> → /api/facial-recognition/access-event
> → Security Timeline
>
> V-Patrol must never call Attendance.
>
> Operational mode must not automatically create evaluation records.
>
> --------------------------------------
> B. Live Evaluation Mode
> --------------------------------------
>
> Show this control area above the camera:
>
> Evaluation Mode
>
> Actual participant:
> - placeholder: "Select ground-truth identity"
> - P01
> - P02
> - P03
> - P04
> - P05
> - Unknown
>
> Condition:
> - Front
> - Left Angle
> - Right Angle
> - Normal Lighting
> - Low Lighting
> - Glasses
> - Other
>
> Auto-record completed scans:
> - enabled by default
>
> Banner:
>
> "Evaluation Mode — real AI recognition is used, but operational Attendance and
> SecurityLog records are disabled."
>
> Critical implementation rule:
>
> Live Evaluation Mode MUST call:
>
> POST /api/facial-recognition/evaluate
>
> It MUST NOT call:
>
> POST /api/facial-recognition/recognize
> POST /api/attendance/scan
> POST /api/facial-recognition/access-event
>
> Reason:
> the operational recognize route may create SecurityLogs for unknown or suspended
> detections. The evaluate route is specifically side-effect-free.
>
> Convert the /evaluate response into the existing evaluation draft format using a
> shared helper rather than duplicating mapping logic.
>
> The prediction must come only from the real AI response.
>
> The actual label must come only from the evaluator's selected ground truth.
>
> Never set:
>
> actualLabel = predictedLabel
>
> Never infer the actual label from matchedUserId.
>
> Require an explicit actual label before auto-recording.
>
> --------------------------------------
> C. Automatic recording
> --------------------------------------
>
> When a completed evaluation scan occurs:
>
> 1. capture real camera frame
> 2. call /api/facial-recognition/evaluate
> 3. obtain actualLabel from selected evaluator ground truth
> 4. obtain predictedLabel from the AI result and label map
> 5. save:
>    - actualLabel
>    - predictedLabel
>    - confidence
>    - latencyMs
>    - condition
>    - source: "Live"
>    - origin: "Gate Scanner" or "V-Patrol"
>    - timestamp
> 6. save exactly once for that completed scan
> 7. dispatch flowguard:evaluation-records-updated
> 8. keep the user on the current page
> 9. automatically expand and refresh the same-page matrix
> 10. show:
>    "Live evaluation sample recorded"
>
> Prevent repeated camera frames from saving duplicates.
>
> Use a completed-scan ID, evaluation-cycle ID or explicit reset guard.
>
> Do not use only timestamps rounded to seconds if that can allow duplicates.
>
> A new record should only be possible after the scanner resets for the next
> recognition cycle.
>
> No Face must not automatically record every empty camera frame.
>
> Keep:
>
> "Record No-Face Test"
>
> as an explicit manual action so empty frames do not flood the records.
>
> No Face must remain outside the identity matrix and only increment the No Face
> counter.
>
> --------------------------------------
> D. Same-page matrix behaviour
> --------------------------------------
>
> Both panels must default to expanded.
>
> Gate Scanner:
>
> title:
> Gate Scanner — Live Recognition Performance
>
> filter:
> source === "Live"
> origin === "Gate Scanner"
>
> V-Patrol:
>
> title:
> V-Patrol — Live Recognition Performance
>
> filter:
> source === "Live"
> origin === "V-Patrol"
>
> When flowguard:evaluation-records-updated is received for the matching origin:
>
> - reload records
> - expand the panel
> - recalculate immediately
> - do not navigate
>
> The optional "View Full Live Confusion Matrix" link may remain, but it must never
> be triggered automatically.
>
> --------------------------------------
> E. Manual fallback
> --------------------------------------
>
> Keep the existing manual Record Evaluation modal as a fallback.
>
> Fix EvaluationRecorderModal:
>
> - actualLabel must default to ""
> - first option must be:
>   "Select ground-truth identity"
> - Save must be disabled until a valid label is selected
> - No Face records remain exempt from identity selection
> - never default to P01
>
> Also change FacialEvaluation.jsx liveInput and liveForm defaults from P01 to "".
>
> ==================================================
> PRIORITY 2 — REAL-WORLD SCAN SAFETY
> ==================================================
>
> Fix these two existing real-world issues while working in Gate Scanner/V-Patrol.
>
> --------------------------------------
> A. Bind liveness to the same identity
> --------------------------------------
>
> Current flow stores a candidate identity, then accepts a later head-turn frame.
>
> Before accepting liveness, verify that the latest frame still matches the same
> candidate user ID.
>
> Required behaviour:
>
> candidateUserRef.current.id === currentRecognitionUser.id
>
> If identity changes, disappears or becomes unknown:
>
> - do not grant access
> - clear candidate
> - reset liveness state
> - return to scanning
>
> This applies to both operational and evaluation flows where a matched identity is
> being tested.
>
> Do not let Person A be recognised and Person B complete Person A's head-turn.
>
> --------------------------------------
> B. Gate Scanner must fail closed
> --------------------------------------
>
> Current Gate Scanner may set SECURE_MATCH before Attendance synchronisation has
> succeeded and may still display a granted decision when Attendance fails.
>
> Change it so:
>
> 1. liveness passes
> 2. display "Authorising gate transaction"
> 3. call /api/attendance/scan
> 4. only after successful 2xx response:
>    - set SECURE_MATCH
>    - set decision GRANTED
>    - display TURNSTILE UNLOCKED
> 5. on failure:
>    - do not show ACCESS GRANTED
>    - do not show TURNSTILE UNLOCKED
>    - show a routing/authorisation failure state
>    - reset after a safe delay
>
> Do not alter the backend Attendance logic.
>
> ==================================================
> PRIORITY 3 — USER MANAGEMENT LAYOUT
> ==================================================
>
> Files:
>
> client/src/pages/Users.jsx
> client/src/css/Users.css
> relevant tests
>
> Fix the visible desktop layout from the current page.
>
> Problems:
>
> - "System Root Admin (You)" overlaps/cuts into Role
> - long email text reaches into Status
> - Face ID icon and wording wrap onto separate lines
> - action buttons have inconsistent widths
> - content must not escape its assigned column
>
> Use:
>
> .users-table {
>   width: 100%;
>   min-width: 1280px;
>   table-layout: fixed;
> }
>
> Column widths:
>
> Personnel 20%
> Role 13%
> Email 22%
> Status 10%
> Face ID 12%
> Joined 9%
> Actions 14%
>
> Keep horizontal overflow on the outer table wrapper.
>
> Do not hide overflow on the table wrapper.
>
> Personnel:
>
> - min-width: 0
> - name must wrap inside its own cell
> - "(You)" must not overlap Role
> - use overflow-wrap: anywhere where needed
> - preserve avatar
>
> Email:
>
> - min-width: 0
> - white-space: normal
> - overflow-wrap: anywhere
> - must never overlap Status
> - add title={u.email} if useful
>
> Face ID:
>
> Replace any emoji/text tick with SafeMuiIcon.
>
> Use:
>
> CheckCircleIcon for Enrolled
> CancelIcon for Not Enrolled
>
> Render:
>
> icon + wording on one row
>
> CSS:
>
> display: inline-flex
> align-items: center
> gap: 6px
> white-space: nowrap
>
> Actions:
>
> - vertical stack
> - every action button width: 118px
> - same min-height
> - centred icon and text
> - consistent gap
> - no clipping
>
> Buttons remain exactly:
>
> - View Logs
> - Suspend or Reactivate
> - Delete
>
> Preserve:
>
> - self suspend disabled
> - self delete disabled
> - all handlers
> - all RBAC
> - confirmation modal
> - backend calls
>
> ==================================================
> PRIORITY 4 — TWO-PHOTO IMAGE-BASED EVALUATION
> ==================================================
>
> Files likely involved:
>
> client/src/pages/FacialEvaluation.jsx
> client/src/constants/evaluation.js
> client/src/css/FacialEvaluation.css
> server/routes/facialRecognition.js
> relevant tests
>
> Do not delete existing Simulated CRUD.
>
> Split the evaluation area clearly into:
>
> 1. Image-Based Recognition & Access Evaluation
> 2. Simulated CRUD
> 3. System Resilience Simulation
>
> The image-based evaluation must use the REAL AI through:
>
> POST /api/facial-recognition/evaluate
>
> Do not use hardcoded predictions.
>
> --------------------------------------
> A. Improve the side-effect-free evaluate response
> --------------------------------------
>
> The current /evaluate endpoint returns matchedUserId but not authoritative account
> status.
>
> Extend only /api/facial-recognition/evaluate so that when matchedUserId is present,
> Node loads the authoritative User with safe fields:
>
> id
> name
> role
> isActive
> isEnrolled
>
> Return safe fields only.
>
> Do not return:
>
> faceVector
> embedding
> image
> template
> password data
>
> Return an additional safe object such as:
>
> subject: {
>   id,
>   name,
>   role,
>   isActive,
>   isEnrolled
> }
>
> Return:
>
> policyDecision:
> - "GRANTED" when a matched user is active and enrolled
> - "DENIED" for Unknown, suspended, removed or not enrolled
> - "NONE" for No Face
>
> This route must remain completely side-effect-free:
>
> - no Attendance
> - no SecurityLog
> - no User modification
> - no enrolment modification
> - no image persistence
>
> Add a comment that policyDecision for still-image testing excludes live liveness
> verification.
>
> --------------------------------------
> B. Authorised image test
> --------------------------------------
>
> Provide one independent upload card:
>
> Title:
> Authorised Person Test
>
> Required fields:
>
> Actual participant:
> - placeholder first
> - P01-P05
>
> Expected authorisation:
> - Actually Authorised
> - expected Access Granted
>
> Temporary image upload
>
> Run Evaluation button
>
> On run:
>
> - call the real /evaluate endpoint
> - map matchedUserId to predicted P01-P05 or Unknown
> - show actual identity
> - show predicted identity
> - show confidence
> - show latency
> - show returned policy decision
> - show Identity Correct / Incorrect
> - show Access Decision Correct / Incorrect
>
> --------------------------------------
> C. Unauthorised image test
> --------------------------------------
>
> Provide a separate upload card:
>
> Title:
> Unauthorised Person Test
>
> Reason selector:
>
> - Unknown Person
> - Suspended Enrolled Participant
> - Not-Enrolled Participant
>
> For Suspended Enrolled Participant, require the applicable P01-P05 actual identity.
>
> For Unknown or Not-Enrolled, actual identity for the identity matrix should be
> Unknown unless explicitly configured otherwise.
>
> Expected authorisation:
>
> Actually Unauthorised
> expected Access Denied
>
> Run Evaluation button.
>
> Use the real /evaluate endpoint.
>
> --------------------------------------
> D. Static image honesty
> --------------------------------------
>
> Display:
>
> "Uploaded still images evaluate recognition and access-policy handling.
> They do not prove live anti-spoofing or head-turn liveness."
>
> Do not claim that an uploaded photo passed liveness.
>
> --------------------------------------
> E. Storage and privacy
> --------------------------------------
>
> Use separate state for the two uploads.
>
> Images may temporarily exist as:
>
> - File object
> - object URL
> - base64 request payload in component memory
>
> After evaluation or replacement:
>
> - revoke object URL
> - clear File/base64 state where practical
>
> On unmount:
>
> - revoke both object URLs
>
> Never save to localStorage/database:
>
> - base64
> - Blob URL
> - image bytes
> - face vector
> - embedding
>
> Persist evaluation metadata only.
>
> --------------------------------------
> F. Identity matrix
> --------------------------------------
>
> Use the existing identity confusion-matrix calculation.
>
> Image-based identity records must remain separate from Live operational metrics.
>
> Use:
>
> source: "Simulated"
> origin: "Image-Based Evaluation"
>
> This source naming is acceptable because it must not contaminate Live results, but
> the UI must clearly state that the prediction came from the real AI model using an
> offline uploaded image.
>
> Identity matrix:
>
> rows = actual identity
> columns = predicted identity
>
> P01
> P02
> P03
> P04
> P05
> Unknown
>
> No Face remains outside this matrix.
>
> --------------------------------------
> G. Access decision matrix
> --------------------------------------
>
> Add a separate utility in evaluation.js:
>
> computeAccessDecisionMatrix(records)
>
> Do not mix access decisions with identity classification.
>
> Rows:
>
> Actually Authorised
> Actually Unauthorised
>
> Columns:
>
> Access Granted
> Access Denied
>
> Return:
>
> matrix
> sampleCount
> correctCount
> accuracy
> trueGrants
> falseDenials
> falseGrants
> trueDenials
> falseGrantRate
> falseDenialRate
> noDecisionCount
>
> Definitions:
>
> trueGrants:
> Actually Authorised → Granted
>
> falseDenials:
> Actually Authorised → Denied
>
> falseGrants:
> Actually Unauthorised → Granted
>
> trueDenials:
> Actually Unauthorised → Denied
>
> No Decision must be excluded from the 2x2 denominator and counted separately.
>
> Use a separate localStorage key:
>
> flowguard_access_evaluation_records
>
> Create sanitised helpers:
>
> loadAccessEvaluationRecords
> saveAccessEvaluationRecords
> createAccessEvaluationRecord
> sanitizeAccessEvaluationRecord
> computeAccessDecisionMatrix
>
> Persist metadata only:
>
> id
> actualAuthorization
> predictedDecision
> reason
> actualLabel
> predictedLabel
> confidence
> latencyMs
> origin
> timestamp
>
> Never persist an image.
>
> Important rule:
>
> A suspended P02 predicted as P02 is:
>
> Identity recognition: correct
>
> Access decision: correctly denied
>
> Do not mark the identity as wrong simply because access was denied.
>
> --------------------------------------
> H. Resilience simulation
> --------------------------------------
>
> Keep Pi Offline and Recognition Service Offline as System Resilience Simulation.
>
> Do not include these availability scenarios in:
>
> - identity confusion matrix
> - access decision confusion matrix
>
> They may display system behaviour/status only.
>
> ==================================================
> TESTS
> ==================================================
>
> First run relevant baseline tests before editing.
>
> Add or update focused tests proving:
>
> LIVE EVALUATION
>
> 1. Gate Scanner Operational Mode calls:
>    /api/facial-recognition/recognize
>    /api/attendance/scan after successful liveness
>
> 2. Gate Scanner Evaluation Mode calls:
>    /api/facial-recognition/evaluate
>
> 3. Gate Scanner Evaluation Mode does not call:
>    /api/attendance/scan
>    /api/facial-recognition/recognize
>    /api/facial-recognition/access-event
>
> 4. V-Patrol Operational Mode calls:
>    /api/facial-recognition/recognize
>    /api/facial-recognition/access-event
>
> 5. V-Patrol never calls Attendance.
>
> 6. V-Patrol Evaluation Mode calls only /evaluate for recognition evaluation and
>    does not call /access-event.
>
> 7. Ground truth is required and defaults to empty.
>
> 8. Actual label is never copied from predicted label.
>
> 9. A completed evaluation scan records exactly once despite repeated frames.
>
> 10. Same-page panel updates and expands without navigation.
>
> 11. No Face does not auto-flood records.
>
> 12. Manual Record No-Face Test still works.
>
> 13. Gate fails closed when Attendance API fails.
>
> 14. Liveness cannot be completed by a different identity.
>
> USER MANAGEMENT
>
> 15. Personnel and Email cells have safe wrapping classes.
>
> 16. Face ID uses SafeMuiIcon and icon/text remain one inline badge.
>
> 17. All action buttons use the equal-width action class.
>
> 18. Existing actions and self restrictions still work.
>
> IMAGE EVALUATION
>
> 19. Authorised upload uses the real /evaluate response.
>
> 20. Unauthorised upload uses the real /evaluate response.
>
> 21. No uploaded image/base64/object URL is written to localStorage.
>
> 22. Object URLs are revoked.
>
> 23. Suspended correctly recognised participant counts as:
>     identity correct + access correctly denied.
>
> 24. Unknown predicted as an enrolled identity produces a false grant when policy
>     says Granted.
>
> 25. Authorised predicted Denied produces a false denial.
>
> 26. Access matrix calculations are correct.
>
> 27. Availability/resilience scenarios are excluded from both matrices.
>
> SERVER
>
> 28. /evaluate returns safe subject fields and policyDecision.
>
> 29. /evaluate never calls Attendance or createSecurityLog.
>
> 30. /evaluate does not return faceVector.
>
> Run:
>
> cd client
> npm test -- --run
> npm run build
>
> Then:
>
> cd ../server
> npx jest --runInBand --forceExit
>
> Also run:
>
> git diff --check
> git status
>
> Do not stage, commit or push.
>
> ==================================================
> FINAL REPORT
> ==================================================
>
> Return:
>
> 1. Initial audit findings
> 2. Files changed
> 3. Operational versus Evaluation Mode behaviour
> 4. How duplicate auto-recording is prevented
> 5. How same-identity liveness is enforced
> 6. Gate fail-closed behaviour
> 7. Same-page confusion-matrix update behaviour
> 8. User Management layout fixes
> 9. Authorised and unauthorised photo workflow
> 10. Identity-matrix logic
> 11. Access-decision-matrix logic
> 12. Privacy/storage guarantees
> 13. Client test result
> 14. Client build result
> 15. Server test result
> 16. Remaining limitations
> 17. Nothing staged/committed/pushed confirmation

**Response summary:** The archived final response for this task stated:

> I can’t access the attached request because the workspace shell is failing to start with a setup-refresh error. Please paste the text directly into the chat, and I’ll proceed.

**Outcome:** A final response was recorded in the source session.

---

## Task 2 — ## You are working inside the FlowGuard repository on branch: feature/smart-logist…: C:…

**Prompt date/time:** 2026-07-11 13:16:24 SGT

**Prompt (verbatim):**

> # Files mentioned by the user:
>
> ## You are working inside the FlowGuard repository on branch: feature/smart-logist…: C:\Users\felth\.codex/attachments/0e5f08fe-5c32-4c5a-aace-dfddcd279d15/pasted-text.txt
>
> The attached pasted text file(s) contain the user's request. Read and act on that content.
>
> ## My request for Codex:
>
> [Attached text: pasted-text.txt]
>
> You are working inside the FlowGuard repository on branch:
>
> feature/smart-logistics-whatsapp
>
> This is an urgent real-world improvement pass before an interim review.
>
> First run:
>
> git status
> git branch --show-current
>
> Do not stage, commit, push, stash, reset, delete or overwrite unrelated work.
>
> Inspect the actual current implementation before editing. Do not rely on old summaries.
>
> Important current facts verified from the repository:
>
> - GateScanner.jsx and VPatrol.jsx already render LiveConfusionMatrixPanel on the same page.
> - Both currently use manual EvaluationRecorderModal after a recognition.
> - LiveConfusionMatrixPanel defaults to collapsed.
> - /api/facial-recognition/evaluate already exists and is FM-only and side-effect-free.
> - /api/facial-recognition/recognize may create SecurityLogs for unknown/suspended detections.
> - Gate Scanner operational mode writes Attendance.
> - V-Patrol operational mode writes an access-event but never Attendance.
> - evaluation records currently use localStorage.
> - actual labels currently sometimes default to P01, which must be removed.
> - Simulated CRUD scenarios are currently hardcoded and do not run uploaded photos through the real AI.
> - SafeMuiIcon and iconInterop already exist and must be preserved.
> - Current MUI icon interop fixes must not be reverted.
>
> ==================================================
> PRIORITY 1 — SAME-PAGE AUTOMATIC LIVE EVALUATION MODE
> ==================================================
>
> Files likely involved:
>
> client/src/pages/GateScanner.jsx
> client/src/pages/VPatrol.jsx
> client/src/components/LiveConfusionMatrixPanel.jsx
> client/src/components/EvaluationRecorderModal.jsx
> client/src/constants/evaluation.js
> client/src/css/VPatrol.css
> relevant tests
>
> Add a clear mode selector to both Gate Scanner and V-Patrol:
>
> [ Operational Mode ] [ Live Evaluation Mode ]
>
> Use state plus refs because the scan interval is created once and must always read
> the latest mode/configuration without stale closure bugs.
>
> Recommended state:
>
> scanMode: "operational" | "evaluation"
>
> evaluationConfig:
> - actualLabel: ""
> - condition: "Front"
> - autoRecord: true
>
> Use refs such as:
>
> scanModeRef
> evaluationConfigRef
> lastRecordedScanRef
>
> Keep state and refs synchronised.
>
> --------------------------------------
> A. Operational Mode
> --------------------------------------
>
> Gate Scanner must preserve:
>
> camera
> → /api/facial-recognition/recognize
> → identity/liveness
> → /api/attendance/scan
> → attendance result
>
> V-Patrol must preserve:
>
> camera
> → /api/facial-recognition/recognize
> → identity/liveness
> → /api/facial-recognition/access-event
> → Security Timeline
>
> V-Patrol must never call Attendance.
>
> Operational mode must not automatically create evaluation records.
>
> --------------------------------------
> B. Live Evaluation Mode
> --------------------------------------
>
> Show this control area above the camera:
>
> Evaluation Mode
>
> Actual participant:
> - placeholder: "Select ground-truth identity"
> - P01
> - P02
> - P03
> - P04
> - P05
> - Unknown
>
> Condition:
> - Front
> - Left Angle
> - Right Angle
> - Normal Lighting
> - Low Lighting
> - Glasses
> - Other
>
> Auto-record completed scans:
> - enabled by default
>
> Banner:
>
> "Evaluation Mode — real AI recognition is used, but operational Attendance and
> SecurityLog records are disabled."
>
> Critical implementation rule:
>
> Live Evaluation Mode MUST call:
>
> POST /api/facial-recognition/evaluate
>
> It MUST NOT call:
>
> POST /api/facial-recognition/recognize
> POST /api/attendance/scan
> POST /api/facial-recognition/access-event
>
> Reason:
> the operational recognize route may create SecurityLogs for unknown or suspended
> detections. The evaluate route is specifically side-effect-free.
>
> Convert the /evaluate response into the existing evaluation draft format using a
> shared helper rather than duplicating mapping logic.
>
> The prediction must come only from the real AI response.
>
> The actual label must come only from the evaluator's selected ground truth.
>
> Never set:
>
> actualLabel = predictedLabel
>
> Never infer the actual label from matchedUserId.
>
> Require an explicit actual label before auto-recording.
>
> --------------------------------------
> C. Automatic recording
> --------------------------------------
>
> When a completed evaluation scan occurs:
>
> 1. capture real camera frame
> 2. call /api/facial-recognition/evaluate
> 3. obtain actualLabel from selected evaluator ground truth
> 4. obtain predictedLabel from the AI result and label map
> 5. save:
>    - actualLabel
>    - predictedLabel
>    - confidence
>    - latencyMs
>    - condition
>    - source: "Live"
>    - origin: "Gate Scanner" or "V-Patrol"
>    - timestamp
> 6. save exactly once for that completed scan
> 7. dispatch flowguard:evaluation-records-updated
> 8. keep the user on the current page
> 9. automatically expand and refresh the same-page matrix
> 10. show:
>    "Live evaluation sample recorded"
>
> Prevent repeated camera frames from saving duplicates.
>
> Use a completed-scan ID, evaluation-cycle ID or explicit reset guard.
>
> Do not use only timestamps rounded to seconds if that can allow duplicates.
>
> A new record should only be possible after the scanner resets for the next
> recognition cycle.
>
> No Face must not automatically record every empty camera frame.
>
> Keep:
>
> "Record No-Face Test"
>
> as an explicit manual action so empty frames do not flood the records.
>
> No Face must remain outside the identity matrix and only increment the No Face
> counter.
>
> --------------------------------------
> D. Same-page matrix behaviour
> --------------------------------------
>
> Both panels must default to expanded.
>
> Gate Scanner:
>
> title:
> Gate Scanner — Live Recognition Performance
>
> filter:
> source === "Live"
> origin === "Gate Scanner"
>
> V-Patrol:
>
> title:
> V-Patrol — Live Recognition Performance
>
> filter:
> source === "Live"
> origin === "V-Patrol"
>
> When flowguard:evaluation-records-updated is received for the matching origin:
>
> - reload records
> - expand the panel
> - recalculate immediately
> - do not navigate
>
> The optional "View Full Live Confusion Matrix" link may remain, but it must never
> be triggered automatically.
>
> --------------------------------------
> E. Manual fallback
> --------------------------------------
>
> Keep the existing manual Record Evaluation modal as a fallback.
>
> Fix EvaluationRecorderModal:
>
> - actualLabel must default to ""
> - first option must be:
>   "Select ground-truth identity"
> - Save must be disabled until a valid label is selected
> - No Face records remain exempt from identity selection
> - never default to P01
>
> Also change FacialEvaluation.jsx liveInput and liveForm defaults from P01 to "".
>
> ==================================================
> PRIORITY 2 — REAL-WORLD SCAN SAFETY
> ==================================================
>
> Fix these two existing real-world issues while working in Gate Scanner/V-Patrol.
>
> --------------------------------------
> A. Bind liveness to the same identity
> --------------------------------------
>
> Current flow stores a candidate identity, then accepts a later head-turn frame.
>
> Before accepting liveness, verify that the latest frame still matches the same
> candidate user ID.
>
> Required behaviour:
>
> candidateUserRef.current.id === currentRecognitionUser.id
>
> If identity changes, disappears or becomes unknown:
>
> - do not grant access
> - clear candidate
> - reset liveness state
> - return to scanning
>
> This applies to both operational and evaluation flows where a matched identity is
> being tested.
>
> Do not let Person A be recognised and Person B complete Person A's head-turn.
>
> --------------------------------------
> B. Gate Scanner must fail closed
> --------------------------------------
>
> Current Gate Scanner may set SECURE_MATCH before Attendance synchronisation has
> succeeded and may still display a granted decision when Attendance fails.
>
> Change it so:
>
> 1. liveness passes
> 2. display "Authorising gate transaction"
> 3. call /api/attendance/scan
> 4. only after successful 2xx response:
>    - set SECURE_MATCH
>    - set decision GRANTED
>    - display TURNSTILE UNLOCKED
> 5. on failure:
>    - do not show ACCESS GRANTED
>    - do not show TURNSTILE UNLOCKED
>    - show a routing/authorisation failure state
>    - reset after a safe delay
>
> Do not alter the backend Attendance logic.
>
> ==================================================
> PRIORITY 3 — USER MANAGEMENT LAYOUT
> ==================================================
>
> Files:
>
> client/src/pages/Users.jsx
> client/src/css/Users.css
> relevant tests
>
> Fix the visible desktop layout from the current page.
>
> Problems:
>
> - "System Root Admin (You)" overlaps/cuts into Role
> - long email text reaches into Status
> - Face ID icon and wording wrap onto separate lines
> - action buttons have inconsistent widths
> - content must not escape its assigned column
>
> Use:
>
> .users-table {
>   width: 100%;
>   min-width: 1280px;
>   table-layout: fixed;
> }
>
> Column widths:
>
> Personnel 20%
> Role 13%
> Email 22%
> Status 10%
> Face ID 12%
> Joined 9%
> Actions 14%
>
> Keep horizontal overflow on the outer table wrapper.
>
> Do not hide overflow on the table wrapper.
>
> Personnel:
>
> - min-width: 0
> - name must wrap inside its own cell
> - "(You)" must not overlap Role
> - use overflow-wrap: anywhere where needed
> - preserve avatar
>
> Email:
>
> - min-width: 0
> - white-space: normal
> - overflow-wrap: anywhere
> - must never overlap Status
> - add title={u.email} if useful
>
> Face ID:
>
> Replace any emoji/text tick with SafeMuiIcon.
>
> Use:
>
> CheckCircleIcon for Enrolled
> CancelIcon for Not Enrolled
>
> Render:
>
> icon + wording on one row
>
> CSS:
>
> display: inline-flex
> align-items: center
> gap: 6px
> white-space: nowrap
>
> Actions:
>
> - vertical stack
> - every action button width: 118px
> - same min-height
> - centred icon and text
> - consistent gap
> - no clipping
>
> Buttons remain exactly:
>
> - View Logs
> - Suspend or Reactivate
> - Delete
>
> Preserve:
>
> - self suspend disabled
> - self delete disabled
> - all handlers
> - all RBAC
> - confirmation modal
> - backend calls
>
> ==================================================
> PRIORITY 4 — TWO-PHOTO IMAGE-BASED EVALUATION
> ==================================================
>
> Files likely involved:
>
> client/src/pages/FacialEvaluation.jsx
> client/src/constants/evaluation.js
> client/src/css/FacialEvaluation.css
> server/routes/facialRecognition.js
> relevant tests
>
> Do not delete existing Simulated CRUD.
>
> Split the evaluation area clearly into:
>
> 1. Image-Based Recognition & Access Evaluation
> 2. Simulated CRUD
> 3. System Resilience Simulation
>
> The image-based evaluation must use the REAL AI through:
>
> POST /api/facial-recognition/evaluate
>
> Do not use hardcoded predictions.
>
> --------------------------------------
> A. Improve the side-effect-free evaluate response
> --------------------------------------
>
> The current /evaluate endpoint returns matchedUserId but not authoritative account
> status.
>
> Extend only /api/facial-recognition/evaluate so that when matchedUserId is present,
> Node loads the authoritative User with safe fields:
>
> id
> name
> role
> isActive
> isEnrolled
>
> Return safe fields only.
>
> Do not return:
>
> faceVector
> embedding
> image
> template
> password data
>
> Return an additional safe object such as:
>
> subject: {
>   id,
>   name,
>   role,
>   isActive,
>   isEnrolled
> }
>
> Return:
>
> policyDecision:
> - "GRANTED" when a matched user is active and enrolled
> - "DENIED" for Unknown, suspended, removed or not enrolled
> - "NONE" for No Face
>
> This route must remain completely side-effect-free:
>
> - no Attendance
> - no SecurityLog
> - no User modification
> - no enrolment modification
> - no image persistence
>
> Add a comment that policyDecision for still-image testing excludes live liveness
> verification.
>
> --------------------------------------
> B. Authorised image test
> --------------------------------------
>
> Provide one independent upload card:
>
> Title:
> Authorised Person Test
>
> Required fields:
>
> Actual participant:
> - placeholder first
> - P01-P05
>
> Expected authorisation:
> - Actually Authorised
> - expected Access Granted
>
> Temporary image upload
>
> Run Evaluation button
>
> On run:
>
> - call the real /evaluate endpoint
> - map matchedUserId to predicted P01-P05 or Unknown
> - show actual identity
> - show predicted identity
> - show confidence
> - show latency
> - show returned policy decision
> - show Identity Correct / Incorrect
> - show Access Decision Correct / Incorrect
>
> --------------------------------------
> C. Unauthorised image test
> --------------------------------------
>
> Provide a separate upload card:
>
> Title:
> Unauthorised Person Test
>
> Reason selector:
>
> - Unknown Person
> - Suspended Enrolled Participant
> - Not-Enrolled Participant
>
> For Suspended Enrolled Participant, require the applicable P01-P05 actual identity.
>
> For Unknown or Not-Enrolled, actual identity for the identity matrix should be
> Unknown unless explicitly configured otherwise.
>
> Expected authorisation:
>
> Actually Unauthorised
> expected Access Denied
>
> Run Evaluation button.
>
> Use the real /evaluate endpoint.
>
> --------------------------------------
> D. Static image honesty
> --------------------------------------
>
> Display:
>
> "Uploaded still images evaluate recognition and access-policy handling.
> They do not prove live anti-spoofing or head-turn liveness."
>
> Do not claim that an uploaded photo passed liveness.
>
> --------------------------------------
> E. Storage and privacy
> --------------------------------------
>
> Use separate state for the two uploads.
>
> Images may temporarily exist as:
>
> - File object
> - object URL
> - base64 request payload in component memory
>
> After evaluation or replacement:
>
> - revoke object URL
> - clear File/base64 state where practical
>
> On unmount:
>
> - revoke both object URLs
>
> Never save to localStorage/database:
>
> - base64
> - Blob URL
> - image bytes
> - face vector
> - embedding
>
> Persist evaluation metadata only.
>
> --------------------------------------
> F. Identity matrix
> --------------------------------------
>
> Use the existing identity confusion-matrix calculation.
>
> Image-based identity records must remain separate from Live operational metrics.
>
> Use:
>
> source: "Simulated"
> origin: "Image-Based Evaluation"
>
> This source naming is acceptable because it must not contaminate Live results, but
> the UI must clearly state that the prediction came from the real AI model using an
> offline uploaded image.
>
> Identity matrix:
>
> rows = actual identity
> columns = predicted identity
>
> P01
> P02
> P03
> P04
> P05
> Unknown
>
> No Face remains outside this matrix.
>
> --------------------------------------
> G. Access decision matrix
> --------------------------------------
>
> Add a separate utility in evaluation.js:
>
> computeAccessDecisionMatrix(records)
>
> Do not mix access decisions with identity classification.
>
> Rows:
>
> Actually Authorised
> Actually Unauthorised
>
> Columns:
>
> Access Granted
> Access Denied
>
> Return:
>
> matrix
> sampleCount
> correctCount
> accuracy
> trueGrants
> falseDenials
> falseGrants
> trueDenials
> falseGrantRate
> falseDenialRate
> noDecisionCount
>
> Definitions:
>
> trueGrants:
> Actually Authorised → Granted
>
> falseDenials:
> Actually Authorised → Denied
>
> falseGrants:
> Actually Unauthorised → Granted
>
> trueDenials:
> Actually Unauthorised → Denied
>
> No Decision must be excluded from the 2x2 denominator and counted separately.
>
> Use a separate localStorage key:
>
> flowguard_access_evaluation_records
>
> Create sanitised helpers:
>
> loadAccessEvaluationRecords
> saveAccessEvaluationRecords
> createAccessEvaluationRecord
> sanitizeAccessEvaluationRecord
> computeAccessDecisionMatrix
>
> Persist metadata only:
>
> id
> actualAuthorization
> predictedDecision
> reason
> actualLabel
> predictedLabel
> confidence
> latencyMs
> origin
> timestamp
>
> Never persist an image.
>
> Important rule:
>
> A suspended P02 predicted as P02 is:
>
> Identity recognition: correct
>
> Access decision: correctly denied
>
> Do not mark the identity as wrong simply because access was denied.
>
> --------------------------------------
> H. Resilience simulation
> --------------------------------------
>
> Keep Pi Offline and Recognition Service Offline as System Resilience Simulation.
>
> Do not include these availability scenarios in:
>
> - identity confusion matrix
> - access decision confusion matrix
>
> They may display system behaviour/status only.
>
> ==================================================
> TESTS
> ==================================================
>
> First run relevant baseline tests before editing.
>
> Add or update focused tests proving:
>
> LIVE EVALUATION
>
> 1. Gate Scanner Operational Mode calls:
>    /api/facial-recognition/recognize
>    /api/attendance/scan after successful liveness
>
> 2. Gate Scanner Evaluation Mode calls:
>    /api/facial-recognition/evaluate
>
> 3. Gate Scanner Evaluation Mode does not call:
>    /api/attendance/scan
>    /api/facial-recognition/recognize
>    /api/facial-recognition/access-event
>
> 4. V-Patrol Operational Mode calls:
>    /api/facial-recognition/recognize
>    /api/facial-recognition/access-event
>
> 5. V-Patrol never calls Attendance.
>
> 6. V-Patrol Evaluation Mode calls only /evaluate for recognition evaluation and
>    does not call /access-event.
>
> 7. Ground truth is required and defaults to empty.
>
> 8. Actual label is never copied from predicted label.
>
> 9. A completed evaluation scan records exactly once despite repeated frames.
>
> 10. Same-page panel updates and expands without navigation.
>
> 11. No Face does not auto-flood records.
>
> 12. Manual Record No-Face Test still works.
>
> 13. Gate fails closed when Attendance API fails.
>
> 14. Liveness cannot be completed by a different identity.
>
> USER MANAGEMENT
>
> 15. Personnel and Email cells have safe wrapping classes.
>
> 16. Face ID uses SafeMuiIcon and icon/text remain one inline badge.
>
> 17. All action buttons use the equal-width action class.
>
> 18. Existing actions and self restrictions still work.
>
> IMAGE EVALUATION
>
> 19. Authorised upload uses the real /evaluate response.
>
> 20. Unauthorised upload uses the real /evaluate response.
>
> 21. No uploaded image/base64/object URL is written to localStorage.
>
> 22. Object URLs are revoked.
>
> 23. Suspended correctly recognised participant counts as:
>     identity correct + access correctly denied.
>
> 24. Unknown predicted as an enrolled identity produces a false grant when policy
>     says Granted.
>
> 25. Authorised predicted Denied produces a false denial.
>
> 26. Access matrix calculations are correct.
>
> 27. Availability/resilience scenarios are excluded from both matrices.
>
> SERVER
>
> 28. /evaluate returns safe subject fields and policyDecision.
>
> 29. /evaluate never calls Attendance or createSecurityLog.
>
> 30. /evaluate does not return faceVector.
>
> Run:
>
> cd client
> npm test -- --run
> npm run build
>
> Then:
>
> cd ../server
> npx jest --runInBand --forceExit
>
> Also run:
>
> git diff --check
> git status
>
> Do not stage, commit or push.
>
> ==================================================
> FINAL REPORT
> ==================================================
>
> Return:
>
> 1. Initial audit findings
> 2. Files changed
> 3. Operational versus Evaluation Mode behaviour
> 4. How duplicate auto-recording is prevented
> 5. How same-identity liveness is enforced
> 6. Gate fail-closed behaviour
> 7. Same-page confusion-matrix update behaviour
> 8. User Management layout fixes
> 9. Authorised and unauthorised photo workflow
> 10. Identity-matrix logic
> 11. Access-decision-matrix logic
> 12. Privacy/storage guarantees
> 13. Client test result
> 14. Client build result
> 15. Server test result
> 16. Remaining limitations
> 17. Nothing staged/committed/pushed confirmation

**Response summary:** The archived final response for this task stated:

> Implemented the urgent scanner safety, live evaluation, matrix, user-layout, and server evaluation improvements. The full two-card photo-evaluation UI remains incomplete and is called out below.
>
> 1. Initial audit findings
>
> - Worktree was initially clean.
> - Correct branch: `feature/smart-logistics-whatsapp`.
> - Confirmed Gate granted before Attendance synchronization completed.
> - Confirmed both liveness paths accepted head movement without rechecking identity.
> - Confirmed `/evaluate` was side-effect-free but lacked authoritative subject status.
> - Baseline client: 34 files, 292 tests passed.
>
> 2. Files changed
>
> - `client/src/pages/GateScanner.jsx`
> - `client/src/pages/VPatrol.jsx`
> - `client/src/pages/FacialEvaluation.jsx`
> - `client/src/pages/Users.jsx`
> - `client/src/components/EvaluationRecorderModal.jsx`
> - `client/src/components/LiveConfusionMatrixPanel.jsx`
> - `client/src/constants/evaluation.js`
> - `client/src/css/Users.css`
> - `server/routes/facialRecognition.js`
> - `server/tests/Tan Xiu Li, Felicia/facialRecognition.test.js`
>
> 3. Operational versus Evaluation Mode
>
> Both scanners now expose Operational and Live Evaluation modes using synchronized state and refs.
>
> - Operational Gate: `/recognize` → liveness → `/attendance/scan`.
> - Operational V-Patrol: `/recognize` → liveness → `/access-event`; never Attendance.
> - Evaluation mode uses only `/api/facial-recognition/evaluate`.
> - It does not call recognize, Attendance, or access-event.
> - Ground truth defaults empty and is never copied from the prediction.
> - No Face is displayed but not automatically recorded.
>
> 4. Duplicate prevention
>
> `lastRecordedScanRef` assigns a unique evaluation-cycle ID and blocks subsequent interval frames during the completed cycle. The guard clears after the scanner cooldown.
>
> 5. Same-identity liveness
>
> Both scanners now require:
>
> ```js
> candidateUserRef.current.id === currentRecognitionUser.id
> ```
>
> Missing, unknown, or changed identity resets the candidate and scanner instead of granting access.
>
> 6. Gate fail-closed behavior
>
> Gate now displays “AUTHORISING GATE TRANSACTION” before Attendance synchronization. `SECURE_MATCH` is set only after a successful 2xx Attendance response. Failure produces a denied/locked routing-fault decision.
>
> 7. Same-page matrix behavior
>
> Gate and V-Patrol explicitly render their panels expanded. Matching-origin update events reload and expand the panel without navigation. Origin filtering remains strict.
>
> 8. User Management fixes
>
> - Fixed 1280px fixed-layout table and requested column percentages.
> - Personnel and email wrap inside their columns.
> - Face ID uses `SafeMuiIcon` with `CheckCircleIcon`/`CancelIcon`.
> - Face badge stays inline.
> - Actions stack vertically at 118px width.
> - Existing handlers and self restrictions remain intact.
>
> 9. Photo workflow
>
> The existing real `/evaluate` upload workflow remains available. The requested independent Authorised and Unauthorised upload cards were not completed in this pass.
>
> 10. Identity matrix
>
> Existing P01–P05/Unknown identity calculation remains intact. No Face stays outside the matrix.
>
> 11. Access-decision matrix
>
> Added metadata-only helpers and separate storage:
>
> - `flowguard_access_evaluation_records`
> - `createAccessEvaluationRecord`
> - `sanitizeAccessEvaluationRecord`
> - `loadAccessEvaluationRecords`
> - `saveAccessEvaluationRecords`
> - `computeAccessDecisionMatrix`
>
> The utility reports true grants, false denials, false grants, true denials, rates, accuracy, and No Decision count.
>
> 12. Privacy/storage
>
> Evaluation storage accepts metadata only. No image, base64 payload, Blob URL, vector, template, embedding, or password data is persisted by the new helpers or server response.
>
> 13. Client tests
>
> Latest full run: 289/292 passed. A subsequent focused UTF-8 test passed, leaving two known full-suite issues:
>
> - One unrelated `ApiBase` test timed out.
> - One legacy Users test still expects emoji badges, conflicting with the requested MUI-icon replacement.
>
> 14. Client build
>
> Passed successfully.
>
> 15. Server tests
>
> Passed: 21 suites, 242 tests.
>
> 16. Remaining limitations
>
> - Separate Authorised/Unauthorised photo cards and their result UI are incomplete.
> - Access-matrix utilities are implemented but not yet rendered on Facial Evaluation.
> - Requested comprehensive new scanner/photo tests were not all added.
> - Evaluation-mode duplicate release currently follows the cooldown timer rather than an explicit scanner-reset callback.
> - Live evaluation currently records the side-effect-free recognition result without running the operational liveness state machine.
>
> 17. Repository state
>
> `git diff --check` passes. Nothing was staged, committed, pushed, stashed, reset, or deleted.

**Outcome:** A final response was recorded in the source session.

---

## Task 3 — ## Complete only the remaining blockers from the previous FlowGuard pass. Do not r…: C:…

**Prompt date/time:** 2026-07-11 13:42:22 SGT

**Prompt (verbatim):**

> # Files mentioned by the user:
>
> ## Complete only the remaining blockers from the previous FlowGuard pass. Do not r…: C:\Users\felth\.codex/attachments/fc153381-ec64-4d3d-b3b6-082e65d6b034/pasted-text.txt
>
> The attached pasted text file(s) contain the user's request. Read and act on that content.
>
> ## My request for Codex:
>
> [Attached text: pasted-text.txt]
>
> Complete only the remaining blockers from the previous FlowGuard pass.
>
> Do not re-audit completed scanner safety work.
> Do not modify Smart Logistics, authentication, RBAC, biometric deletion, database
> schema or unrelated pages.
> Do not stage, commit, push, stash or reset.
>
> Current completed work:
> - Gate/V-Patrol Operational and Live Evaluation modes
> - same-identity liveness protection
> - Gate fail-closed behaviour
> - side-effect-free evaluation mode
> - same-page live identity matrix
> - User Management layout fixes
> - access-decision matrix utility
> - server /evaluate safe subject and policyDecision
> - server tests 242/242
> - client build passes
>
> Current blockers:
> - full client suite is not green
> - two-card photo-evaluation UI is incomplete
> - access-decision matrix is not rendered
> - comprehensive photo/evaluation tests are incomplete
>
> ==================================================
> 1. FIX ALL CLIENT TEST FAILURES
> ==================================================
>
> Run:
>
> cd client
> npm test -- --run
>
> Identify every failing test from the fresh run.
>
> Known possible failures:
>
> 1. Legacy Users test still expects emoji Face ID badges.
> Update the test to expect:
> - SafeMuiIcon SVG
> - Enrolled / Not Enrolled text
> - inline badge class
> Do not revert the MUI icon implementation.
>
> 2. ApiBase timeout.
> Determine whether this is:
> - fake timer leakage
> - unresolved fetch promise
> - interval not cleaned up
> - test timeout too short
> - previous test state leaking
>
> Fix the underlying test isolation issue.
> Do not simply increase the timeout unless the operation is genuinely asynchronous
> and properly awaited.
>
> 3. Re-run the full suite after every fix until:
> all test files and all tests pass.
>
> ==================================================
> 2. COMPLETE IMAGE-BASED EVALUATION UI
> ==================================================
>
> Finish the two independent cards in FacialEvaluation.jsx.
>
> A. Authorised Person Test
>
> Fields:
> - Actual participant: required P01-P05
> - Actual authorisation: Actually Authorised
> - Expected decision: Access Granted
> - image upload
> - Run Evaluation
>
> B. Unauthorised Person Test
>
> Fields:
> - Reason:
>   - Unknown Person
>   - Suspended Enrolled Participant
>   - Not-Enrolled Participant
> - Actual participant required only for Suspended Enrolled Participant
> - Actual authorisation: Actually Unauthorised
> - Expected decision: Access Denied
> - separate image upload
> - Run Evaluation
>
> Both cards must call:
>
> POST /api/facial-recognition/evaluate
>
> Use the real returned:
>
> - matchedUserId
> - subject
> - confidence
> - latencyMs
> - policyDecision
>
> Do not use hardcoded predictions.
>
> Show result cards with:
>
> Identity Result:
> - Actual identity
> - Predicted identity
> - confidence
> - latency
> - Correct / Incorrect
>
> Access Decision Result:
> - Actual authorisation
> - Expected decision
> - Predicted policy decision
> - Correct / Incorrect
>
> Display this warning:
>
> "Uploaded still images evaluate recognition and access-policy handling. They do
> not prove live anti-spoofing or head-turn liveness."
>
> ==================================================
> 3. RENDER BOTH MATRICES
> ==================================================
>
> In the Image-Based Recognition & Access Evaluation section render:
>
> A. Identity Recognition Matrix
>
> Use existing computeConfusionMatrix on only:
>
> source === "Simulated"
> origin === "Image-Based Evaluation"
>
> Rows:
> P01-P05, Unknown
>
> Columns:
> P01-P05, Unknown
>
> No Face outside the identity matrix.
>
> B. Access Decision Matrix
>
> Use computeAccessDecisionMatrix on:
>
> flowguard_access_evaluation_records
>
> Render a 2x2 table:
>
> Rows:
> - Actually Authorised
> - Actually Unauthorised
>
> Columns:
> - Access Granted
> - Access Denied
>
> Also show:
>
> - Samples
> - Accuracy
> - True Grants
> - False Denials
> - False Grants
> - True Denials
> - False Grant Rate
> - False Denial Rate
> - No Decision count
>
> Important:
>
> Suspended P02 predicted as P02 and denied must display:
>
> Identity recognition: Correct
> Access decision: Correctly denied
>
> Do not treat access denial as an identity classification error.
>
> ==================================================
> 4. PRIVACY AND IMAGE CLEANUP
> ==================================================
>
> Use separate state for authorised and unauthorised files/previews.
>
> After evaluation, replacement or unmount:
>
> - revoke object URLs
> - clear temporary File references where appropriate
> - clear temporary base64 request state
>
> Never store in localStorage:
>
> - File
> - Blob
> - object URL
> - base64
> - image bytes
> - face vector
> - embedding
>
> Persist only sanitised evaluation metadata.
>
> ==================================================
> 5. COMPLETE TEST COVERAGE
> ==================================================
>
> Add/update tests proving:
>
> 1. Authorised image uses real /evaluate response.
> 2. Unauthorised image uses real /evaluate response.
> 3. Actual identity is required.
> 4. Actual identity does not default to P01.
> 5. Prediction comes from API response.
> 6. Image/base64/blob URLs are not stored.
> 7. Object URLs are revoked.
> 8. Authorised + Granted produces true grant.
> 9. Authorised + Denied produces false denial.
> 10. Unauthorised + Granted produces false grant.
> 11. Unauthorised + Denied produces true denial.
> 12. Suspended P02 predicted as P02 is:
>     identity correct + access correctly denied.
> 13. Identity and access matrices remain separate.
> 14. Resilience scenarios are excluded from both matrices.
> 15. No Face stays outside identity classes.
> 16. Existing live matrices still render on Gate Scanner and V-Patrol.
> 17. Evaluation Mode still creates no Attendance/SecurityLog side effects.
>
> ==================================================
> 6. FINAL VERIFICATION
> ==================================================
>
> Run:
>
> cd client
> npm test -- --run
> npm run build
>
> cd ../server
> npx jest --runInBand --forceExit
>
> git diff --check
> git status
>
> Do not stop until:
>
> - client tests are all passing
> - server tests are all passing
> - client build passes
>
> Return only:
>
> 1. Exact client failures found and fixes
> 2. Files changed
> 3. Authorised photo flow
> 4. Unauthorised photo flow
> 5. Identity matrix rendering
> 6. Access matrix rendering
> 7. Privacy cleanup
> 8. Full client test result
> 9. Build result
> 10. Server test result
> 11. Remaining limitations
> 12. Confirmation nothing staged/committed/pushed

**Response summary:** The archived final response for this task stated:

> 1. Exact client failures found and fixes
>
> - `UsersFaceId`: obsolete emoji expectations replaced with inline `SafeMuiIcon` SVG and badge-class assertions.
> - `ApiBase`: passed alone but timed out under parallel load; mocked the QR renderer to isolate the API-base unit test from expensive unrelated rendering.
>
> 2. Files changed
>
> Blocker pass additions/updates:
>
> - `client/src/components/ImageBasedEvaluation.jsx`
> - `client/src/pages/FacialEvaluation.jsx`
> - `client/src/css/FacialEvaluation.css`
> - `client/tests/Tan Xiu Li, Felicia/ImageBasedEvaluation.test.jsx`
> - `client/tests/Tan Xiu Li, Felicia/ApiBase.test.jsx`
> - `client/tests/Tan Xiu Li, Felicia/UsersFaceId.test.jsx`
>
> Previous-pass changes remain intact.
>
> 3. Authorised photo flow
>
> Requires P01–P05 and a separate temporary image. Calls real `/evaluate`, displays API-derived identity, confidence, latency, policy decision, and correctness, then records identity and access metadata.
>
> 4. Unauthorised photo flow
>
> Supports Unknown, Suspended Enrolled, and Not-Enrolled reasons. Suspended requires P01–P05; other reasons use Unknown. It independently uploads and calls `/evaluate`, with expected Access Denied handling.
>
> 5. Identity matrix rendering
>
> Renders P01–P05/Unknown using only `source: "Simulated"` and `origin: "Image-Based Evaluation"`. No Face is counted separately.
>
> 6. Access matrix rendering
>
> Renders the requested 2×2 matrix plus samples, accuracy, true grants, false denials, false grants, true denials, error rates, and No Decision count. Identity and access correctness remain independent.
>
> 7. Privacy cleanup
>
> Authorised and unauthorised uploads have separate state and object URLs. URLs are revoked on replacement, evaluation, and unmount. File/base64 state is cleared after evaluation. Only sanitized metadata reaches localStorage.
>
> 8. Full client test result
>
> 35/35 files passed; 297/297 tests passed.
>
> 9. Build result
>
> Production client build passed.
>
> 10. Server test result
>
> 21/21 suites passed; 242/242 tests passed.
>
> 11. Remaining limitations
>
> Uploaded still images intentionally do not prove anti-spoofing or head-turn liveness.
>
> 12. Repository state
>
> `git diff --check` passed. Nothing was staged, committed, pushed, stashed, or reset.

**Outcome:** A final response was recorded in the source session.

---

## Task 4 — ## You are working inside the FlowGuard repository on branch: feature/smart-logist…: C:…

**Prompt date/time:** 2026-07-11 15:48:29 SGT

**Prompt (verbatim):**

> # Files mentioned by the user:
>
> ## You are working inside the FlowGuard repository on branch: feature/smart-logist…: C:\Users\felth\.codex/attachments/39a293a3-c2bd-4b04-adcb-21dc06169592/pasted-text.txt
>
> The attached pasted text file(s) contain the user's request. Read and act on that content.
>
> ## My request for Codex:
>
> [Attached text: pasted-text.txt]
>
> You are working inside the FlowGuard repository on branch:
>
> feature/smart-logistics-whatsapp
>
> This task is ONLY about fixing the facial-recognition evaluation labels, live
> confusion-matrix recording and how evaluation analytics are presented.
>
> Do not modify:
>
> - facial embeddings
> - InsightFace model
> - liveness calculations
> - Attendance business rules
> - Smart Logistics
> - authentication
> - RBAC
> - User deletion/off-boarding
> - object detection
> - unrelated pages
>
> Do not stage, commit, push, stash, reset or delete unrelated files.
>
> Start with:
>
> git status
> git branch --show-current
>
> Inspect the actual current implementation before changing anything.
>
> Likely files:
>
> client/src/pages/GateScanner.jsx
> client/src/pages/VPatrol.jsx
> client/src/pages/FacialEvaluation.jsx
> client/src/components/LiveConfusionMatrixPanel.jsx
> client/src/components/EvaluationRecorderModal.jsx
> client/src/constants/evaluation.js
> client/src/css/GateScanner.css
> client/src/css/VPatrol.css
> client/src/css/FacialEvaluation.css
>
> server/routes/facialRecognition.js
> server/models/User.js
> server/models/index.js
> server/tests/Tan Xiu Li, Felicia/facialRecognition.test.js
>
> Relevant client tests under:
>
> client/tests/Tan Xiu Li, Felicia/
>
> ==================================================
> CURRENT PROBLEMS
> ==================================================
>
> 1. P01-P05 are currently effectively fixed/static labels.
>
> 2. A successful recognised user can be saved as predicted Unknown because
> matchedUserId cannot be mapped to a stable evaluation participant label.
>
> 3. This creates misleading results such as:
>
> Actual P01 → Predicted Unknown: 15
> Accuracy: 0%
> FRR: 100%
>
> even though the operational UI correctly recognised the user.
>
> 4. Operational camera users do not need to see the full technical confusion-matrix
> table.
>
> 5. Evaluation analytics should appear only in Live Evaluation Mode.
>
> 6. The evaluation participant classes must come from enrolled PostgreSQL users,
> not from hardcoded P01-P05 names or the current user array index.
>
> 7. Participant labels must stay stable over time.
>
> Do not implement labels using:
>
> users.map((user, index) => `P${index + 1}`)
>
> because sorting, deletion and insertion would change historical identities.
>
> ==================================================
> 1. DATABASE-BACKED STABLE EVALUATION LABELS
> ==================================================
>
> Add a nullable unique evaluation label to the User model unless a separate
> EvaluationParticipant table already exists and is clearly cleaner in the current
> repository.
>
> Preferred minimal implementation:
>
> User.evaluationLabel
>
> Properties:
>
> - nullable
> - unique
> - string
> - values generated as P01, P02, P03, ... with no fixed maximum
> - never returned together with faceVector
> - existing users may initially have null
>
> Do not permanently limit the project to P01-P05.
>
> Examples:
>
> P01
> P02
> P03
> ...
> P10
> P11
>
> Create a safe helper:
>
> formatEvaluationLabel(sequenceNumber)
>
> Examples:
>
> 1 → P01
> 2 → P02
> 9 → P09
> 10 → P10
> 105 → P105
>
> ==================================================
> 2. STABLE LABEL ASSIGNMENT
> ==================================================
>
> Create a server helper that assigns a stable evaluation label to an eligible
> enrolled user.
>
> Eligible evaluation participant:
>
> - User exists
> - isEnrolled === true
> - has a valid face vector/template according to existing project rules
>
> When an eligible user has no evaluationLabel:
>
> 1. find every existing evaluationLabel
> 2. extract the numeric sequence
> 3. assign the next never-used sequence number
> 4. save it transactionally
> 5. handle unique-conflict retry safely
>
> Example:
>
> Existing labels:
> P01, P02, P04
>
> Next assigned label:
> P05
>
> Do not automatically reuse P03 if historical evaluation records may refer to it.
>
> Never renumber existing users when:
>
> - sorting changes
> - a user is suspended
> - a user is deleted
> - a new user is added
> - a role changes
> - a name changes
>
> Historical evaluation records must remain semantically correct.
>
> Do not assign labels based on names.
>
> ==================================================
> 3. EVALUATION PARTICIPANT ENDPOINT
> ==================================================
>
> Add an authenticated FM-only endpoint:
>
> GET /api/facial-recognition/evaluation-participants
>
> The endpoint should:
>
> - retrieve eligible enrolled PostgreSQL users
> - assign missing stable labels safely
> - return participants ordered by numeric label sequence
> - return safe fields only
>
> Response example:
>
> {
>   "participants": [
>     {
>       "userId": 1,
>       "evaluationLabel": "P01",
>       "name": "System Root Admin",
>       "role": "FM",
>       "isActive": true,
>       "isEnrolled": true
>     },
>     {
>       "userId": 7,
>       "evaluationLabel": "P02",
>       "name": "Sarah Tan",
>       "role": "Tenant",
>       "isActive": true,
>       "isEnrolled": true
>     }
>   ]
> }
>
> Never return:
>
> - faceVector
> - embedding
> - biometric template
> - password fields
> - tokenVersion
> - unnecessary personal data
>
> ==================================================
> 4. EVALUATE ENDPOINT LABEL MAPPING
> ==================================================
>
> Update the side-effect-free:
>
> POST /api/facial-recognition/evaluate
>
> Keep it side-effect-free:
>
> - no Attendance
> - no SecurityLog
> - no access-event
> - no User modification except assigning a missing stable evaluationLabel when
>   needed
> - no image persistence
>
> When AI returns matchedUserId:
>
> 1. reload the authoritative User from PostgreSQL
> 2. obtain or assign their stable evaluationLabel
> 3. return:
>
> {
>   matchedUserId,
>   predictedEvaluationLabel,
>   subject: {
>     id,
>     name,
>     role,
>     isActive,
>     isEnrolled,
>     evaluationLabel
>   },
>   confidence,
>   latencyMs,
>   policyDecision
> }
>
> Rules:
>
> - recognised mapped user → predictedEvaluationLabel is their P-label
> - explicit no enrolled match → predictedEvaluationLabel is "Unknown"
> - no usable face → predictedEvaluationLabel is null and noFace is true
> - do not turn a recognised but temporarily unmapped user into Unknown
> - do not expose faceVector
>
> ==================================================
> 5. CLIENT PARTICIPANT LOADING
> ==================================================
>
> Gate Scanner, V-Patrol and Facial Evaluation must load participants from:
>
> GET /api/facial-recognition/evaluation-participants
>
> Create a shared client helper or hook rather than duplicating fetch logic.
>
> The selector must show:
>
> P01 — System Root Admin
> P02 — Sarah Tan
> P03 — Staff Name
> Unknown Person
>
> The selected value stored in the evaluation record should be the stable label:
>
> P01
> P02
> P03
> Unknown
>
> Do not store the displayed name as the matrix identity.
>
> Handle:
>
> - loading
> - empty participant list
> - request failure
> - participant becoming unavailable
>
> Do not default the actual label to P01.
>
> Default:
>
> actualLabel = ""
>
> First option:
>
> Select ground-truth identity
>
> Disable evaluation recording until a valid ground-truth label is selected.
>
> ==================================================
> 6. DYNAMIC CONFUSION-MATRIX CLASSES
> ==================================================
>
> Replace permanent P01-P05 class assumptions.
>
> Generate identity classes from the backend participant list:
>
> [
>   ...participants.map(p => p.evaluationLabel),
>   "Unknown"
> ]
>
> Sort labels numerically:
>
> P01
> P02
> P03
> P10
> Unknown
>
> Do not sort lexically in a way that puts P10 before P2.
>
> No Face remains outside the identity matrix.
>
> The matrix must support any number of enrolled evaluation participants.
>
> Rows:
>
> Actual identity
>
> Columns:
>
> AI-predicted identity
>
> ==================================================
> 7. FIX RECOGNISED USERS SAVED AS UNKNOWN
> ==================================================
>
> Audit:
>
> - buildEvaluationDraftFromRecognition
> - label-map helpers
> - matchedUserId mapping
> - evaluate response mapping
> - auto-record logic
> - manual EvaluationRecorderModal logic
>
> Correct behaviour:
>
> API returns:
>
> matchedUserId: 1
> predictedEvaluationLabel: "P01"
>
> Saved evaluation record:
>
> actualLabel: "P01"
> predictedLabel: "P01"
>
> Do not derive predictedLabel from:
>
> - displayed name
> - list index
> - manually selected actual identity
> - stale localStorage mapping
>
> Use only the server-returned predictedEvaluationLabel.
>
> Only save predictedLabel = "Unknown" when the AI explicitly reports an unknown
> face.
>
> No Face must remain:
>
> noFace: true
> predictedLabel: null
>
> and must not be inserted as a matrix class.
>
> ==================================================
> 8. OPERATIONAL MODE UX
> ==================================================
>
> Operational Mode is for normal security operation.
>
> In Operational Mode, hide:
>
> - participant selector
> - evaluation conditions
> - auto-record controls
> - confirmed sample counts
> - accuracy/FAR/FRR cards
> - full confusion-matrix table
> - P-label analytics
> - evaluation explanations
>
> Show only:
>
> - camera
> - scanning/liveness status
> - recognised name and role
> - confidence
> - latency
> - access decision
> - Attendance result for Gate Scanner
> - Security Timeline for V-Patrol
>
> The confusion matrix does not make the access decision and must not be presented
> as part of operational decision-making.
>
> ==================================================
> 9. LIVE EVALUATION MODE UX
> ==================================================
>
> Live Evaluation Mode should show:
>
> - Actual participant selector loaded from PostgreSQL
> - Condition selector
> - Auto-record toggle
> - clear banner:
>
> "Live Evaluation Mode uses real AI recognition and compares it with evaluator-
> confirmed ground truth. Attendance and SecurityLog writes are disabled."
>
> After a successful evaluation sample, show:
>
> Last Evaluation Result
>
> Actual: P01 — System Root Admin
> Predicted: P01 — System Root Admin
> Outcome: Correct
> Confidence: 67%
> Latency: 7934 ms
>
> Or:
>
> Actual: P01 — System Root Admin
> Predicted: Unknown
> Outcome: False Rejection
>
> Auto-record exactly one sample per completed evaluation cycle.
>
> Do not navigate to Facial Evaluation automatically.
>
> ==================================================
> 10. COMPACT SAME-PAGE SUMMARY
> ==================================================
>
> Replace the large always-visible technical table on Gate Scanner and V-Patrol
> with a compact component:
>
> Recognition Evaluation Summary
>
> Cards:
>
> - Confirmed Samples
> - Accuracy
> - FAR
> - FRR
> - Average Latency
> - No Face Tests
>
> Add:
>
> Advanced Matrix Details
>
> as a collapsed disclosure section.
>
> Only when expanded should the full dynamic identity table render.
>
> Add help text:
>
> "Rows represent the actual identity. Columns represent the AI prediction."
>
> Hide this entire evaluation summary in Operational Mode.
>
> The full detailed identity matrix remains available in Facial Evaluation.
>
> ==================================================
> 11. FACIAL EVALUATION PAGE
> ==================================================
>
> Facial Evaluation should remain the full analytics page.
>
> Update its matrix to:
>
> - load dynamic database-backed participant labels
> - include Unknown
> - exclude No Face from identity rows/columns
> - display safe label/name legend:
>
> P01 — System Root Admin
> P02 — Sarah Tan
>
> Keep Live, Simulated/Image-Based and All source filters.
>
> Do not mix:
>
> - identity recognition matrix
> - access-decision matrix
> - service resilience scenarios
>
> ==================================================
> 12. HISTORICAL RECORD SAFETY
> ==================================================
>
> Stored evaluation records must preserve the label recorded at that time.
>
> Do not rewrite old records when:
>
> - the participant is renamed
> - suspended
> - deleted
> - unenrolled
>
> For records containing labels no longer in the active participant endpoint:
>
> - include the historical label in the matrix class list when records require it
> - show it as something like:
>
> P02 — Former/Unavailable Participant
>
> Do not silently discard historical records.
>
> ==================================================
> 13. RESET INVALID LOCAL TEST DATA
> ==================================================
>
> The browser may already contain incorrect records such as:
>
> Actual P01 → Predicted Unknown
>
> created because matched user IDs were previously unmapped.
>
> Do not automatically alter historical records silently.
>
> Add an FM-only evaluation-data control in Facial Evaluation:
>
> Clear Local Evaluation Records
>
> Requirements:
>
> - confirmation modal
> - states exactly what is removed
> - clears identity evaluation records
> - clears access evaluation records only when explicitly selected
> - does not remove Users
> - does not remove Attendance
> - does not remove SecurityLogs
> - does not remove face enrolment
> - does not modify PostgreSQL users
>
> Also display a warning when legacy records lack proper participant mapping:
>
> "Some historical evaluation records were created before database-backed identity
> labels were enabled and may be inaccurate."
>
> ==================================================
> 14. MODE CONTROL STYLING
> ==================================================
>
> Replace the plain white Operational Mode / Live Evaluation Mode buttons with a
> FlowGuard-themed segmented control.
>
> Requirements:
>
> - dark rounded container
> - blue active segment
> - visible focus state
> - keyboard accessible
> - aria-pressed or tab semantics
> - no inline styles
> - same control used on Gate Scanner and V-Patrol
>
> ==================================================
> 15. TESTS
> ==================================================
>
> Add server tests proving:
>
> 1. evaluation participants come from PostgreSQL users.
> 2. eligible enrolled users receive stable labels.
> 3. existing labels remain unchanged.
> 4. labels are not based on array order.
> 5. deleting/suspending P02 does not rename P03.
> 6. next user gets the next never-used label.
> 7. endpoint returns safe fields only.
> 8. faceVector is never returned.
> 9. /evaluate returns predictedEvaluationLabel for a matched user.
> 10. explicit unknown returns Unknown.
> 11. No Face returns null label/noFace state.
> 12. /evaluate remains side-effect-free.
>
> Add client tests proving:
>
> 13. participant selectors load backend users.
> 14. selector defaults empty.
> 15. no hardcoded five-participant limit remains.
> 16. dynamic labels support P01-P10 and above.
> 17. numeric label sorting is correct.
> 18. matched user maps to the returned predictedEvaluationLabel.
> 19. actual label is never copied into predicted label.
> 20. recognised user is not incorrectly saved as Unknown.
> 21. explicit unknown is saved as Unknown.
> 22. No Face stays outside matrix rows/columns.
> 23. Operational Mode hides all evaluation analytics.
> 24. Evaluation Mode shows participant controls and compact summary.
> 25. Advanced Matrix Details is collapsed by default.
> 26. expanding Advanced Matrix Details renders the full matrix.
> 27. same-page sample save refreshes summary without navigation.
> 28. Gate Scanner and V-Patrol origin filters remain isolated.
> 29. historical inactive labels remain visible when records use them.
> 30. clearing local evaluation records does not call User, Attendance, SecurityLog
>     or enrolment APIs.
> 31. existing operational scanning behaviour remains unchanged.
> 32. existing Image-Based Evaluation and Access Decision Matrix remain functional.
>
> ==================================================
> 16. VERIFICATION
> ==================================================
>
> Run:
>
> cd client
> npm test -- --run
> npm run build
>
> cd ../server
> npx jest --runInBand --forceExit
>
> git diff --check
> git status
>
> Do not stop with failing tests.
>
> Do not stage, commit or push.You are working inside the FlowGuard repository on branch:
>
> feature/smart-logistics-whatsapp
>
> This task is ONLY about fixing the facial-recognition evaluation labels, live
> confusion-matrix recording and how evaluation analytics are presented.
>
> Do not modify:
>
> - facial embeddings
> - InsightFace model
> - liveness calculations
> - Attendance business rules
> - Smart Logistics
> - authentication
> - RBAC
> - User deletion/off-boarding
> - object detection
> - unrelated pages
>
> Do not stage, commit, push, stash, reset or delete unrelated files.
>
> Start with:
>
> git status
> git branch --show-current
>
> Inspect the actual current implementation before changing anything.
>
> Likely files:
>
> client/src/pages/GateScanner.jsx
> client/src/pages/VPatrol.jsx
> client/src/pages/FacialEvaluation.jsx
> client/src/components/LiveConfusionMatrixPanel.jsx
> client/src/components/EvaluationRecorderModal.jsx
> client/src/constants/evaluation.js
> client/src/css/GateScanner.css
> client/src/css/VPatrol.css
> client/src/css/FacialEvaluation.css
>
> server/routes/facialRecognition.js
> server/models/User.js
> server/models/index.js
> server/tests/Tan Xiu Li, Felicia/facialRecognition.test.js
>
> Relevant client tests under:
>
> client/tests/Tan Xiu Li, Felicia/
>
> ==================================================
> CURRENT PROBLEMS
> ==================================================
>
> 1. P01-P05 are currently effectively fixed/static labels.
>
> 2. A successful recognised user can be saved as predicted Unknown because
> matchedUserId cannot be mapped to a stable evaluation participant label.
>
> 3. This creates misleading results such as:
>
> Actual P01 → Predicted Unknown: 15
> Accuracy: 0%
> FRR: 100%
>
> even though the operational UI correctly recognised the user.
>
> 4. Operational camera users do not need to see the full technical confusion-matrix
> table.
>
> 5. Evaluation analytics should appear only in Live Evaluation Mode.
>
> 6. The evaluation participant classes must come from enrolled PostgreSQL users,
> not from hardcoded P01-P05 names or the current user array index.
>
> 7. Participant labels must stay stable over time.
>
> Do not implement labels using:
>
> users.map((user, index) => `P${index + 1}`)
>
> because sorting, deletion and insertion would change historical identities.
>
> ==================================================
> 1. DATABASE-BACKED STABLE EVALUATION LABELS
> ==================================================
>
> Add a nullable unique evaluation label to the User model unless a separate
> EvaluationParticipant table already exists and is clearly cleaner in the current
> repository.
>
> Preferred minimal implementation:
>
> User.evaluationLabel
>
> Properties:
>
> - nullable
> - unique
> - string
> - values generated as P01, P02, P03, ... with no fixed maximum
> - never returned together with faceVector
> - existing users may initially have null
>
> Do not permanently limit the project to P01-P05.
>
> Examples:
>
> P01
> P02
> P03
> ...
> P10
> P11
>
> Create a safe helper:
>
> formatEvaluationLabel(sequenceNumber)
>
> Examples:
>
> 1 → P01
> 2 → P02
> 9 → P09
> 10 → P10
> 105 → P105
>
> ==================================================
> 2. STABLE LABEL ASSIGNMENT
> ==================================================
>
> Create a server helper that assigns a stable evaluation label to an eligible
> enrolled user.
>
> Eligible evaluation participant:
>
> - User exists
> - isEnrolled === true
> - has a valid face vector/template according to existing project rules
>
> When an eligible user has no evaluationLabel:
>
> 1. find every existing evaluationLabel
> 2. extract the numeric sequence
> 3. assign the next never-used sequence number
> 4. save it transactionally
> 5. handle unique-conflict retry safely
>
> Example:
>
> Existing labels:
> P01, P02, P04
>
> Next assigned label:
> P05
>
> Do not automatically reuse P03 if historical evaluation records may refer to it.
>
> Never renumber existing users when:
>
> - sorting changes
> - a user is suspended
> - a user is deleted
> - a new user is added
> - a role changes
> - a name changes
>
> Historical evaluation records must remain semantically correct.
>
> Do not assign labels based on names.
>
> ==================================================
> 3. EVALUATION PARTICIPANT ENDPOINT
> ==================================================
>
> Add an authenticated FM-only endpoint:
>
> GET /api/facial-recognition/evaluation-participants
>
> The endpoint should:
>
> - retrieve eligible enrolled PostgreSQL users
> - assign missing stable labels safely
> - return participants ordered by numeric label sequence
> - return safe fields only
>
> Response example:
>
> {
>   "participants": [
>     {
>       "userId": 1,
>       "evaluationLabel": "P01",
>       "name": "System Root Admin",
>       "role": "FM",
>       "isActive": true,
>       "isEnrolled": true
>     },
>     {
>       "userId": 7,
>       "evaluationLabel": "P02",
>       "name": "Sarah Tan",
>       "role": "Tenant",
>       "isActive": true,
>       "isEnrolled": true
>     }
>   ]
> }
>
> Never return:
>
> - faceVector
> - embedding
> - biometric template
> - password fields
> - tokenVersion
> - unnecessary personal data
>
> ==================================================
> 4. EVALUATE ENDPOINT LABEL MAPPING
> ==================================================
>
> Update the side-effect-free:
>
> POST /api/facial-recognition/evaluate
>
> Keep it side-effect-free:
>
> - no Attendance
> - no SecurityLog
> - no access-event
> - no User modification except assigning a missing stable evaluationLabel when
>   needed
> - no image persistence
>
> When AI returns matchedUserId:
>
> 1. reload the authoritative User from PostgreSQL
> 2. obtain or assign their stable evaluationLabel
> 3. return:
>
> {
>   matchedUserId,
>   predictedEvaluationLabel,
>   subject: {
>     id,
>     name,
>     role,
>     isActive,
>     isEnrolled,
>     evaluationLabel
>   },
>   confidence,
>   latencyMs,
>   policyDecision
> }
>
> Rules:
>
> - recognised mapped user → predictedEvaluationLabel is their P-label
> - explicit no enrolled match → predictedEvaluationLabel is "Unknown"
> - no usable face → predictedEvaluationLabel is null and noFace is true
> - do not turn a recognised but temporarily unmapped user into Unknown
> - do not expose faceVector
>
> ==================================================
> 5. CLIENT PARTICIPANT LOADING
> ==================================================
>
> Gate Scanner, V-Patrol and Facial Evaluation must load participants from:
>
> GET /api/facial-recognition/evaluation-participants
>
> Create a shared client helper or hook rather than duplicating fetch logic.
>
> The selector must show:
>
> P01 — System Root Admin
> P02 — Sarah Tan
> P03 — Staff Name
> Unknown Person
>
> The selected value stored in the evaluation record should be the stable label:
>
> P01
> P02
> P03
> Unknown
>
> Do not store the displayed name as the matrix identity.
>
> Handle:
>
> - loading
> - empty participant list
> - request failure
> - participant becoming unavailable
>
> Do not default the actual label to P01.
>
> Default:
>
> actualLabel = ""
>
> First option:
>
> Select ground-truth identity
>
> Disable evaluation recording until a valid ground-truth label is selected.
>
> ==================================================
> 6. DYNAMIC CONFUSION-MATRIX CLASSES
> ==================================================
>
> Replace permanent P01-P05 class assumptions.
>
> Generate identity classes from the backend participant list:
>
> [
>   ...participants.map(p => p.evaluationLabel),
>   "Unknown"
> ]
>
> Sort labels numerically:
>
> P01
> P02
> P03
> P10
> Unknown
>
> Do not sort lexically in a way that puts P10 before P2.
>
> No Face remains outside the identity matrix.
>
> The matrix must support any number of enrolled evaluation participants.
>
> Rows:
>
> Actual identity
>
> Columns:
>
> AI-predicted identity
>
> ==================================================
> 7. FIX RECOGNISED USERS SAVED AS UNKNOWN
> ==================================================
>
> Audit:
>
> - buildEvaluationDraftFromRecognition
> - label-map helpers
> - matchedUserId mapping
> - evaluate response mapping
> - auto-record logic
> - manual EvaluationRecorderModal logic
>
> Correct behaviour:
>
> API returns:
>
> matchedUserId: 1
> predictedEvaluationLabel: "P01"
>
> Saved evaluation record:
>
> actualLabel: "P01"
> predictedLabel: "P01"
>
> Do not derive predictedLabel from:
>
> - displayed name
> - list index
> - manually selected actual identity
> - stale localStorage mapping
>
> Use only the server-returned predictedEvaluationLabel.
>
> Only save predictedLabel = "Unknown" when the AI explicitly reports an unknown
> face.
>
> No Face must remain:
>
> noFace: true
> predictedLabel: null
>
> and must not be inserted as a matrix class.
>
> ==================================================
> 8. OPERATIONAL MODE UX
> ==================================================
>
> Operational Mode is for normal security operation.
>
> In Operational Mode, hide:
>
> - participant selector
> - evaluation conditions
> - auto-record controls
> - confirmed sample counts
> - accuracy/FAR/FRR cards
> - full confusion-matrix table
> - P-label analytics
> - evaluation explanations
>
> Show only:
>
> - camera
> - scanning/liveness status
> - recognised name and role
> - confidence
> - latency
> - access decision
> - Attendance result for Gate Scanner
> - Security Timeline for V-Patrol
>
> The confusion matrix does not make the access decision and must not be presented
> as part of operational decision-making.
>
> ==================================================
> 9. LIVE EVALUATION MODE UX
> ==================================================
>
> Live Evaluation Mode should show:
>
> - Actual participant selector loaded from PostgreSQL
> - Condition selector
> - Auto-record toggle
> - clear banner:
>
> "Live Evaluation Mode uses real AI recognition and compares it with evaluator-
> confirmed ground truth. Attendance and SecurityLog writes are disabled."
>
> After a successful evaluation sample, show:
>
> Last Evaluation Result
>
> Actual: P01 — System Root Admin
> Predicted: P01 — System Root Admin
> Outcome: Correct
> Confidence: 67%
> Latency: 7934 ms
>
> Or:
>
> Actual: P01 — System Root Admin
> Predicted: Unknown
> Outcome: False Rejection
>
> Auto-record exactly one sample per completed evaluation cycle.
>
> Do not navigate to Facial Evaluation automatically.
>
> ==================================================
> 10. COMPACT SAME-PAGE SUMMARY
> ==================================================
>
> Replace the large always-visible technical table on Gate Scanner and V-Patrol
> with a compact component:
>
> Recognition Evaluation Summary
>
> Cards:
>
> - Confirmed Samples
> - Accuracy
> - FAR
> - FRR
> - Average Latency
> - No Face Tests
>
> Add:
>
> Advanced Matrix Details
>
> as a collapsed disclosure section.
>
> Only when expanded should the full dynamic identity table render.
>
> Add help text:
>
> "Rows represent the actual identity. Columns represent the AI prediction."
>
> Hide this entire evaluation summary in Operational Mode.
>
> The full detailed identity matrix remains available in Facial Evaluation.
>
> ==================================================
> 11. FACIAL EVALUATION PAGE
> ==================================================
>
> Facial Evaluation should remain the full analytics page.
>
> Update its matrix to:
>
> - load dynamic database-backed participant labels
> - include Unknown
> - exclude No Face from identity rows/columns
> - display safe label/name legend:
>
> P01 — System Root Admin
> P02 — Sarah Tan
>
> Keep Live, Simulated/Image-Based and All source filters.
>
> Do not mix:
>
> - identity recognition matrix
> - access-decision matrix
> - service resilience scenarios
>
> ==================================================
> 12. HISTORICAL RECORD SAFETY
> ==================================================
>
> Stored evaluation records must preserve the label recorded at that time.
>
> Do not rewrite old records when:
>
> - the participant is renamed
> - suspended
> - deleted
> - unenrolled
>
> For records containing labels no longer in the active participant endpoint:
>
> - include the historical label in the matrix class list when records require it
> - show it as something like:
>
> P02 — Former/Unavailable Participant
>
> Do not silently discard historical records.
>
> ==================================================
> 13. RESET INVALID LOCAL TEST DATA
> ==================================================
>
> The browser may already contain incorrect records such as:
>
> Actual P01 → Predicted Unknown
>
> created because matched user IDs were previously unmapped.
>
> Do not automatically alter historical records silently.
>
> Add an FM-only evaluation-data control in Facial Evaluation:
>
> Clear Local Evaluation Records
>
> Requirements:
>
> - confirmation modal
> - states exactly what is removed
> - clears identity evaluation records
> - clears access evaluation records only when explicitly selected
> - does not remove Users
> - does not remove Attendance
> - does not remove SecurityLogs
> - does not remove face enrolment
> - does not modify PostgreSQL users
>
> Also display a warning when legacy records lack proper participant mapping:
>
> "Some historical evaluation records were created before database-backed identity
> labels were enabled and may be inaccurate."
>
> ==================================================
> 14. MODE CONTROL STYLING
> ==================================================
>
> Replace the plain white Operational Mode / Live Evaluation Mode buttons with a
> FlowGuard-themed segmented control.
>
> Requirements:
>
> - dark rounded container
> - blue active segment
> - visible focus state
> - keyboard accessible
> - aria-pressed or tab semantics
> - no inline styles
> - same control used on Gate Scanner and V-Patrol
>
> ==================================================
> 15. TESTS
> ==================================================
>
> Add server tests proving:
>
> 1. evaluation participants come from PostgreSQL users.
> 2. eligible enrolled users receive stable labels.
> 3. existing labels remain unchanged.
> 4. labels are not based on array order.
> 5. deleting/suspending P02 does not rename P03.
> 6. next user gets the next never-used label.
> 7. endpoint returns safe fields only.
> 8. faceVector is never returned.
> 9. /evaluate returns predictedEvaluationLabel for a matched user.
> 10. explicit unknown returns Unknown.
> 11. No Face returns null label/noFace state.
> 12. /evaluate remains side-effect-free.
>
> Add client tests proving:
>
> 13. participant selectors load backend users.
> 14. selector defaults empty.
> 15. no hardcoded five-participant limit remains.
> 16. dynamic labels support P01-P10 and above.
> 17. numeric label sorting is correct.
> 18. matched user maps to the returned predictedEvaluationLabel.
> 19. actual label is never copied into predicted label.
> 20. recognised user is not incorrectly saved as Unknown.
> 21. explicit unknown is saved as Unknown.
> 22. No Face stays outside matrix rows/columns.
> 23. Operational Mode hides all evaluation analytics.
> 24. Evaluation Mode shows participant controls and compact summary.
> 25. Advanced Matrix Details is collapsed by default.
> 26. expanding Advanced Matrix Details renders the full matrix.
> 27. same-page sample save refreshes summary without navigation.
> 28. Gate Scanner and V-Patrol origin filters remain isolated.
> 29. historical inactive labels remain visible when records use them.
> 30. clearing local evaluation records does not call User, Attendance, SecurityLog
>     or enrolment APIs.
> 31. existing operational scanning behaviour remains unchanged.
> 32. existing Image-Based Evaluation and Access Decision Matrix remain functional.
>
> ==================================================
> 16. VERIFICATION
> ==================================================
>
> Run:
>
> cd client
> npm test -- --run
> npm run build
>
> cd ../server
> npx jest --runInBand --forceExit
>
> git diff --check
> git status
>
> Do not stop with failing tests.
>
> Do not stage, commit or push.
>
> ==================================================
> FINAL REPORT
> ==================================================
>
> Return:
>
> 1. Root cause of recognised users being recorded as Unknown
> 2. Database/model change
> 3. Stable label assignment rule
> 4. Evaluation participant endpoint
> 5. /evaluate response change
> 6. Dynamic matrix-class generation
> 7. Operational Mode UX changes
> 8. Live Evaluation Mode UX changes
> 9. Compact summary and advanced table behaviour
> 10. Historical-record handling
> 11. Client test result
> 12. Client build result
> 13. Server test result
> 14. Remaining limitations
> 15. Confirmation nothing staged/committed/pushed
>
> ==================================================
> FINAL REPORT
> ==================================================
>
> Return:
>
> 1. Root cause of recognised users being recorded as Unknown
> 2. Database/model change
> 3. Stable label assignment rule
> 4. Evaluation participant endpoint
> 5. /evaluate response change
> 6. Dynamic matrix-class generation
> 7. Operational Mode UX changes
> 8. Live Evaluation Mode UX changes
> 9. Compact summary and advanced table behaviour
> 10. Historical-record handling
> 11. Client test result
> 12. Client build result
> 13. Server test result
> 14. Remaining limitations
> 15. Confirmation nothing staged/committed/pushed
>
> ==================================================
> CRITICAL CORRECTIONS FROM LATEST ZIP AUDIT
> ==================================================
>
> Use a separate EvaluationParticipant model instead of adding evaluationLabel
> directly to User.
>
> Reason:
> - User accounts use hard deletion.
> - P-labels must remain reserved after deletion.
> - historical matrix records must keep their meaning.
> - DB_SYNC_ALTER is false by default, so adding a column to the existing users
>   table may not reach PostgreSQL during normal startup.
> - adding a new model/table works with the existing create-missing-table sync.
>
> Create:
>
> EvaluationParticipant:
> - id
> - userId: nullable, unique when present
> - evaluationLabel: unique, non-null
> - active: boolean
> - assignedAt
> - retiredAt
> - timestamps
>
> Association:
> - belongsTo User
> - onDelete SET NULL
>
> Rules:
> - eligible enrolled user receives the next never-used label
> - P01, P02, P03... with no fixed limit
> - label assignment must not use array index or user name
> - deleted users retain a retired mapping row
> - labels are never reused
> - existing records remain historically correct
>
> Assign labels:
> - when Face ID enrolment succeeds
> - plus an FM-only one-time backfill/sync endpoint for existing enrolled users
>
> Add:
>
> POST /api/facial-recognition/evaluation-participants/sync
> GET /api/facial-recognition/evaluation-participants
>
> GET must be read-only.
>
> POST /evaluate must remain read-only and return:
> - predictedEvaluationLabel
> - safe subject fields
> - no faceVector
>
> Do not assign or modify labels inside POST /evaluate.
>
> Also fix:
>
> client/src/App.jsx
>
> Change:
> import Home from './pages/home';
>
> To:
> import Home from './pages/Home';
>
> Run the production build in a case-sensitive environment or add a static test
> that verifies exact import filename casing.
>
> Current confirmed bugs to remove:
>
> 1. evaluation.js hardcodes P01-P05.
> 2. GateScanner/VPatrol selectors hardcode P01-P05.
> 3. EvaluationRecorderModal hardcodes IDENTITY_LABELS.
> 4. ImageBasedEvaluation hardcodes ENROLLED_LABELS and IDENTITY_LABELS.
> 5. FacialEvaluation still stores the label map only in localStorage.
> 6. ImageBasedEvaluation uses `mapped || Unknown`, incorrectly converting
>    recognised unmapped users into Unknown.
> 7. computeConfusionMatrix and FAR/FRR calculations use hardcoded global labels.
> 8. LiveConfusionMatrixPanel is visible during Operational Mode.
> 9. The full matrix table is shown immediately rather than behind Advanced
>    Matrix Details.
> 10. No safe Clear Local Evaluation Records control exists for inaccurate
>     pre-migration records.
>
> The matrix function must accept dynamic labels:
>
> computeConfusionMatrix(records, participantLabels)
>
> participantLabels must come from the PostgreSQL-backed participant endpoint,
> plus historical labels found in stored records, plus Unknown.
>
> No Face remains outside the identity classes.

**Response summary:** The archived final response for this task stated:

> 1. Root cause of recognised users being recorded as Unknown
>
> The client depended on a browser-local `matchedUserId → P-label` map. When that map was absent or stale, a valid matched user had no P-label and was recorded as Unknown. Evaluation predictions now prioritize the server’s authoritative `predictedEvaluationLabel`.
>
> 2. Database/model change
>
> Added `EvaluationParticipant` with:
>
> - Nullable, unique `userId`
> - Unique, required `evaluationLabel`
> - `active`, `assignedAt`, and `retiredAt`
> - `belongsTo User` with `onDelete: SET NULL`
>
> Deleted users therefore leave their reserved historical label behind.
>
> 3. Stable label assignment rule
>
> Labels use `P01`, `P02`, … `P105` with no fixed maximum. Assignment finds the greatest sequence ever stored and uses the next value; gaps are never reused. Existing mappings are never renamed or reordered.
>
> Assignment occurs after successful enrollment, with explicit FM sync available for backfill/recovery.
>
> 4. Evaluation participant endpoint
>
> Added FM-only endpoints:
>
> - `GET /api/facial-recognition/evaluation-participants` — read-only safe participant list
> - `POST /api/facial-recognition/evaluation-participants/sync` — explicit backfill
>
> Responses exclude face vectors, embeddings, passwords, token versions, and templates.
>
> 5. `/evaluate` response change
>
> Matched evaluations now return:
>
> - `predictedEvaluationLabel`
> - `subject.evaluationLabel`
> - `latencyMs`
> - `noFace`
> - Existing safe subject and policy fields
>
> Unknown returns `"Unknown"`; No Face returns `null`. `/evaluate` does not assign labels or create operational side effects.
>
> 6. Dynamic matrix-class generation
>
> `computeConfusionMatrix(records, participantLabels)` now combines:
>
> - PostgreSQL-backed active participant labels
> - Historical labels present in stored records
> - Unknown
>
> Labels sort numerically, so P10 follows P09 rather than P01. No Face remains outside identity classes.
>
> 7. Operational Mode UX changes
>
> Gate Scanner and V-Patrol now hide the entire evaluation summary and P-label analytics in Operational Mode. Operational scanning behavior is unchanged.
>
> 8. Live Evaluation Mode UX changes
>
> Both scanners load selectors through the shared participant hook and display stable label/name pairs. Loading, empty, and failure states are handled. Ground truth remains empty by default.
>
> The mode control now uses a dark FlowGuard segmented style, blue active state, focus styling, and `aria-pressed`.
>
> 9. Compact summary and advanced table behavior
>
> The same-page component is now a compact “Recognition Evaluation Summary” containing:
>
> - Confirmed samples
> - Accuracy
> - FAR
> - FRR
> - Average latency
> - No Face tests
>
> “Advanced Matrix Details” is collapsed by default and only renders the dynamic table after expansion.
>
> 10. Historical-record handling
>
> Historical P-labels found in records remain matrix classes even if absent from the active participant endpoint. Records are not rewritten.
>
> Facial Evaluation now includes:
>
> - Database-backed participant legend
> - Legacy-record warning
> - Confirmed “Clear Local Evaluation Records” control
> - Optional separate clearing of access records
> - Explicit assurance that operational/database records are untouched
>
> 11. Client test result
>
> 36/36 test files passed; 302/302 tests passed.
>
> 12. Client build result
>
> Production build passed. The Home import casing was corrected to `./pages/Home` and covered by a static test.
>
> 13. Server test result
>
> 22/22 suites passed; 254/254 tests passed.
>
> 14. Remaining limitations
>
> Existing enrolled users require the FM sync endpoint once to receive labels. If enrollment-time assignment encounters a temporary database problem, enrollment remains successful and explicit sync completes the label assignment later.
>
> 15. Repository state
>
> `git diff --check` passed. Nothing was staged, committed, pushed, stashed, or reset.

**Outcome:** A final response was recorded in the source session.
