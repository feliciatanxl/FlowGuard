# Use Cases — Facial Recognition & Access Management (Felicia)

## UC-1: Enrol a face (auto scan + manual upload)
- **Actor:** New user (Tenant/Staff), guided by the system after first login.
- **Trigger:** User has `isEnrolled = false` and is routed to the enrolment screen.
- **Main flow (auto):**
  1. System opens the webcam and prompts for front, left, right angles.
  2. User captures each angle; client encodes images as base64.
  3. Backend forwards images to the AI service (`/api/encode-faces`).
  4. AI returns a 512-d vector; backend stores it and sets `isEnrolled = true`.
  5. User is admitted to the dashboard.
- **Alternative flow (manual upload):** If the scan repeatedly fails (no face detected,
  poor lighting, camera denied), the user switches to "upload a photo" and selects an
  image file; the same encode/store path runs on the uploaded photo.
- **Edge cases:** no face detected → 400 + retry prompt; multiple faces → rejected;
  camera permission denied → fall back to manual upload.

## UC-2: Recognise a person at the gate
- **Actor:** Person approaching the gate terminal; observed by FM/security.
- **Trigger:** A live frame is sent to `/user/recognize`.
- **Main flow:** AI compares the live embedding to enrolled vectors → returns name,
  status, confidence, bounding box, and liveness ratio; an "Access Granted" event is
  logged and an IN/OUT attendance record is created.
- **Alternative flow:** No match above threshold → status `DENIED`, an
  "Intrusion/Tailgating" security log is created and surfaced on the V-Patrol dashboard.
- **Edge cases:** invalid image data → error; low confidence near threshold → flagged.

## UC-3: Monitor access on the V-Patrol dashboard
- **Actor:** Facilities Manager.
- **Trigger:** FM opens the dashboard.
- **Main flow:** System queries `security_logs` to show a daily timeline of access events
  alongside active intrusion/tailgating alerts; FM can filter by personnel or user.

## UC-4: Manage access permissions
- **Actor:** Facilities Manager.
- **Trigger:** FM needs to change a user's access.
- **Main flow:** FM updates a user's role/permission, suspends a user (`/user/suspend/:id`),
  or re-enrols a clearer face vector if recognition struggles.
- **Edge cases:** suspending self / last FM should be prevented.

## UC-5: Off-board a tenant (PDPA delete)
- **Actor:** Facilities Manager.
- **Trigger:** A lease ends.
- **Main flow:** FM deletes the user (`DELETE /user/:id`), removing profile, access
  history, and biometric vector to ensure PDPA compliance.
- **Edge cases:** confirmation required; cascading deletes for related attendance records.

## UC-6: Onboard a tenant via invitation code
- **Actor:** Facilities Manager (issues), Tenant (redeems).
- **Main flow:** FM generates an invite/registration code (`/user/invite-tenant`,
  `/user/generate-code`); tenant registers with it before it expires (48h) or hits max usage.
- **Edge cases:** expired or over-used code → rejected.
