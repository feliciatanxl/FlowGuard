# FlowGuard Week 17 Final Review Run Sheet

Use the deployed staging application as the primary demonstration. Keep passwords off-screen, use only prepared non-personal data, and describe a fallback as a fallback—not as a successful external service or hardware result.

## Before the lesson

- [ ] Record the verified direct server URL, then check `/health/live` and `/health/ready` (the client URL does not proxy these paths).
- [ ] Confirm current Cloud Run client/server/AI revisions are healthy and the AI service remains private.
- [ ] Verify the existing `FM`, demo `Tenant`, and linked demo `Staff` accounts in separate browser profiles/Incognito sessions.
- [ ] Confirm the required three-angle Face ID enrolment is complete for demo accounts.
- [ ] Confirm prepared attendance, camera, zone, alert, linked incident, security review, support ticket, Knowledge Base entries, and analytics data remain available after refresh.
- [ ] Confirm one prepared `Confirmed` booking, Driver Pass/QR/reference, non-personal plate, slot, and bay.
- [ ] Grant camera/local-network permission in the browser profile used for the demo.
- [ ] Start the Camera Module 3 service on the trusted lesson hotspot/LAN and verify Pi `/health`, `/video_feed`, and `/snapshot`.
- [ ] Save/test the current Pi base URL in **Settings -> Raspberry Pi Camera**, then verify **Laptop Webcam** fallback.
- [ ] If SecurePi is demonstrated, verify exactly one Pi 5/IMX500 camera owner, the intended model/runtime, local evidence, and authenticated edge path. Do not claim unvalidated pest/model or snapshot-upload results.
- [ ] Confirm whether Gemini is configured. Prepare one question with a known Knowledge Base answer and a deliberate, clearly described deterministic-fallback explanation.
- [ ] Confirm whether WhatsApp is real, simulated, skipped, or unavailable; show the stored status honestly.
- [ ] Keep approved screenshots/video and existing prepared records available as fallbacks.
- [ ] Assign every `<PRESENTER: ...>` and `<NEXT PRESENTER>` placeholder and rehearse transitions.

## Expected accounts and data

| Demonstration area | Account | Prepared evidence/data |
|---|---|---|
| Public introduction and Driver Pass | None | Staging URL; valid prepared pass/reference plus known-invalid reference |
| Dashboard, access, gate, detection, incidents, support, knowledge, analytics | `FM` | Enrolled FM; current dashboard records; camera/zone; alert/incident; support/KB; analytics dataset |
| Tenant journey | Demo `Tenant` | Linked demo Staff, own attendance, own booking |
| Staff journey | Demo `Staff` | Own attendance and linked-unit logistics |
| Camera fallback | `FM` | Pi base URL, trusted network, granted permissions, Laptop Webcam |
| Chatbot | Public or authenticated session | Known KB question; persistent session ID; prepared escalation wording/message sequence |

## 25-minute sequence

| Time | Presenter | Account | Demonstration and expected result | Honest fallback | Transition |
|---|---|---|---|---|---|
| 0-2 min | `<PRESENTER: OPENING>` | Public | State the Harrison Food Factory problem, target roles, staging URL, and Browser -> Nginx -> Node -> Cloud SQL/private AI architecture. Mention local Pi and outbound SecurePi as distinct paths. | Use the rendered architecture PNG if connectivity drops. | “`<NEXT PRESENTER>` will show the facility-wide operational picture.” |
| 2-5 min | `<PRESENTER: DASHBOARD>` | `FM` | Sign in and show current people/attendance, bookings/vehicles, alert/incident/support counts, seven-day alert trend, and top zones. Refresh once to show persistence. | Use a saved result and label it as prepared evidence if live data is unavailable. | “The dashboard identifies priorities; `<NEXT PRESENTER>` will show how identity and roles control action.” |
| 5-8 min | `<PRESENTER: ACCESS>` | `FM`; demo Tenant ready | Show role/Face ID state, three-angle enrolment flow, Gate Scanner/V-Patrol distinction, liveness/fail-closed states, attendance, and a denied FM-only route for the prepared Tenant if time permits. Do not enrol a personal face live. | Use approved enrolment/decision screenshots and existing audit/attendance records. | “With access and attendance controlled, `<NEXT PRESENTER>` will follow a delivery to the gate.” |
| 8-12 min | `<PRESENTER: LOGISTICS AND GATE>` | Demo `Tenant`, public pass, `FM` | Show the prepared booking and scoped Tenant list, public Driver Pass/QR, then FM Gate Verification using Pi or Laptop Webcam, QR/reference, plate candidate/correction, final decision, and GateAccessLog. | Pi -> Laptop Webcam; QR -> manual reference; OCR -> manual corrected plate; use prepared booking rather than creating one live. | “The delivery is verified and audited; `<NEXT PRESENTER>` will show visual monitoring and edge input.” |
| 12-15 min | `<PRESENTER: DETECTION>` | `FM` | Show Camera Inventory/Detection Settings, source modes, current Camera Module 3/webcam fallback, prepared object alert, source attribution, WhatsApp state, and linked incident. If SecurePi is available, distinguish browser stream from authenticated outbound edge event. | Use prepared alert/incident and local evidence; label simulated WhatsApp and unvalidated hardware clearly. | “The alert is now an operational case; `<NEXT PRESENTER>` will resolve and measure it.” |
| 15-19 min | `<PRESENTER: INCIDENTS>` | `FM` | Search/read the linked incident, show status/notes/severity/source and security review, then open **Incident Deep Analytics** for MTTR, confidence buckets, AI accuracy, and resolution funnel. Explain that missing `resolvedAt` records are excluded from MTTR. | Use a prepared incident set with known values. If analytics is unavailable in the deployed revision, show the saved expected calculations and label them as prepared evidence. | “FlowGuard tracks resolution as well as detection; `<NEXT PRESENTER>` will show the support and knowledge loop.” |
| 19-22 min | `<PRESENTER: SUPPORT>` | Public chat, then `FM` | Ask a known facility question, refresh/restore chat, explain Gemini-grounded response versus deterministic fallback, demonstrate fixed escalation or a prepared ticket, then show transcript, category/status/archive, and Knowledge Base CRUD/search for the permitted role. | If Gemini is unconfigured/unavailable, demonstrate and label the deterministic response. Use a prepared ticket/KB entry if writes are not authorised during review. | “Support is answered or escalated without losing the record; `<NEXT PRESENTER>` will confirm scoped Tenant and Staff operations.” |
| 22-24 min | `<PRESENTER: TENANT AND STAFF>` | Demo `Tenant`, then demo `Staff` | Tenant: own Staff, attendance, booking. Staff: own attendance/permitted logistics. Show one FM-only denial and confirm each view reloads. | Use separate pre-authenticated profiles or approved role-view screenshots; never display passwords. | “These views complete the role journey; `<NEXT PRESENTER>` will summarise the integrated value.” |
| 24-25 min | `<PRESENTER: CONCLUSION>` | Public/`FM` | Recap RBAC, facial access, Smart Logistics, Pi/webcam, SecurePi edge alerts, linked incidents/analytics, chatbot/Knowledge Base/support, database persistence, and cloud deployment. State current limitations. | Use one prepared summary visual. | “That completes FlowGuard’s end-to-end facility operations journey. We are ready for questions.” |

## Lucas deployed-feature checklist

- [ ] Chat sends a message and returns a response without exposing prompt/configuration secrets.
- [ ] Refresh restores the same session transcript.
- [ ] A known Knowledge Base question grounds the answer; response is identified as Gemini-backed only if staging configuration/behaviour is actually verified.
- [ ] Missing/failing Gemini produces the deterministic fallback without breaking the chat.
- [ ] Trigger/message-count escalation creates or retrieves one linked ticket, not duplicates.
- [ ] FM can open transcript, search/filter, change category/status/notes, archive/restore, and view counts.
- [ ] FM Knowledge Base create/edit/search/delete works with an approved temporary entry; Tenant/Staff cannot administer it.
- [ ] Non-escalated transcript retention and deletion policy is described from code, not claimed from an unobserved cron run.

## Gladwin deployed-feature checklist

- [ ] A prepared detection alert links to the expected incident and displays the correct source/severity/person metadata.
- [ ] Incident search and single-record read load deployed data.
- [ ] Resolution/notes/severity/person updates persist after refresh and synchronise to the linked alert where implemented.
- [ ] Terminal resolution stamps `resolvedAt`; reopening clears it.
- [ ] Soft delete/linked lifecycle is demonstrated only on approved disposable data, otherwise explained using existing evidence.
- [ ] Incident Deep Analytics loads the same deployed incident list and expected MTTR/confidence/accuracy/funnel values.
- [ ] Incidents missing `resolvedAt` are excluded from MTTR rather than assigned an estimated time.
- [ ] FM-only access is enforced for incident list, detail, updates, analytics, and escalation-to-support entry point.

## Fallback and failure wording

- Pi unavailable -> “FlowGuard is using the implemented Laptop Webcam fallback.”
- QR/plate assistance fails -> “The FM uses the manual reference/correction path; the server still makes and audits the final decision.”
- AI service unavailable -> “The workflow failed safely; no inference result is treated as permission.”
- Gemini unavailable -> “The chatbot used its deterministic Knowledge Base/fixed fallback; this is not a Gemini success.”
- WhatsApp simulated/failed -> “The record committed and shows the stored delivery state; this is not a real delivered message.”
- SecurePi/backend unavailable -> show local evidence/outbox only if the chosen SecurePi variant actually provides it.
- Live alert/incident/support data unavailable -> use prepared records/screenshots and say they are prepared fallback evidence.
- Internet issue -> use approved screenshots/video while stating that the staging application is the primary demonstration.
- Role session crossover -> use separate profiles/Incognito; never copy tokens or show passwords.

## Final handoff check

- [ ] Every presenter knows their account, starting page, target time, and transition.
- [ ] Every browser profile and prepared record is open before the handoff.
- [ ] Password managers, notifications, personal tabs, API keys, phone numbers, and personal data are hidden.
- [ ] The team can state automated results accurately: client lint passed; client 655, server 686, safe AI 35, and Pi 19 tests passed; the client build passed with an approximately 801.50 kB main-bundle advisory.
- [ ] The team can distinguish implemented, automated-tested, publicly smoke-tested, manually verified, and still awaiting verification.
- [ ] The final presenter has a one-minute summary plus current limitations ready.
