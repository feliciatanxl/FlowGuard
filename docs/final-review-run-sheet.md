# FlowGuard Week 17 Final Review Run Sheet

Use the cloud-hosted staging application as the primary demonstration. Keep this run sheet open on a separate device or browser window and complete every unchecked prerequisite before the lesson.

## Before the lesson

- [ ] Open the deployed client and verify the direct server `/health/live` and `/health/ready` endpoints.
- [ ] Verify the `FM`, demo `Tenant`, and demo `Staff` accounts in separate Incognito sessions.
- [ ] Confirm first-login Face ID enrolment is complete for every account used in the demo.
- [ ] Confirm the prepared camera, zone, active alert, linked incident, support ticket, attendance record, confirmed booking, Driver Pass, QR, and demonstration plate still load after refresh.
- [ ] Grant camera and local-network permissions in the browser profile used for the demonstration.
- [ ] Start the Raspberry Pi Camera Module 3 service; connect the Pi and laptop to the same hotspot; verify `/health`, `/snapshot`, and `/video_feed`.
- [ ] Configure and test the current Pi base URL in **Settings → Raspberry Pi Camera**.
- [ ] Verify the Laptop Webcam fallback in the same browser profile.
- [ ] Keep the prepared alert, confirmed booking, Driver Pass, screenshots, and a short video available as fallbacks.
- [ ] If practical, use one laptop/browser profile per role to avoid session and local-storage crossover.
- [ ] Assign every `<PRESENTER: ...>` placeholder and rehearse each transition line.

## Suggested 25-minute sequence

| Time | Presenter/owner | Account required | Demonstration and expected test data | Fallback plan | Transition line |
|---|---|---|---|---|---|
| 0–2 min | `<PRESENTER: OPENING>` | Public page; `FM` ready to sign in | State the facility problem, FlowGuard solution, Google Cloud staging URL, and integrated client/Node/AI/database flow. Show the cloud-hosted page with no localhost references. | Use a preloaded cloud page or approved screenshot only if connectivity drops. | “Now that the operational problem and deployed solution are clear, `<NEXT PRESENTER>` will show the Facilities Manager's live overview.” |
| 2–6 min | `<PRESENTER: FM DASHBOARD>` | `FM` | Log in and show **Operations Dashboard**, camera status, people on site, today's bookings, active vehicles, open incidents/tickets, and a prepared High/Critical alert. | Refresh once; if live alert data is unavailable, use the prepared alert record and saved dashboard result. | “The dashboard shows what needs attention; `<NEXT PRESENTER>` will show how FlowGuard controls who can act on it.” |
| 6–10 min | `<PRESENTER: ACCESS MANAGEMENT>` | `FM`; demo `Tenant` credentials prepared | Show **User Management**, the demo Tenant row, role/Face ID status, **Tenant Onboarding** invite-code alternative, route denial expectations, and the three-angle face-enrolment enhancement. Do not create another account live unless specifically requested. | Use the already-created demo Tenant and prepared enrolment screenshots; never expose passwords on screen. | “With the Tenant securely onboarded, `<NEXT PRESENTER>` will follow the delivery journey from booking to gate.” |
| 10–14 min | `<PRESENTER: LOGISTICS>` | `Tenant` for booking; public Driver Pass; `FM` for status if needed | Show the prepared confirmed booking in **Loading Bay Logistics**, its `FG-XXXXXX` reference, date/time, bay, demonstration plate, public Driver Pass, and QR. Explain unit isolation and no Driver login. | If booking creation fails, use the prepared confirmed booking and verified Driver Pass URL. | “The booking is ready at the gate; `<NEXT PRESENTER>` will verify the driver and vehicle using the available cameras.” |
| 14–18 min | `<PRESENTER: GATE VERIFICATION>` | `FM` | Open **Gate Verification**; scan the prepared QR/reference, capture or enter the demonstration plate, and explain the decision/audit result. Show Raspberry Pi Camera Module 3, Laptop Webcam, and automatic/manual fallback behaviour. | Pi unavailable → Laptop Webcam. Permission failure → pre-approved browser/profile. If scanning fails, use manual booking reference and plate entry. | “The gate event is verified and audited; `<NEXT PRESENTER>` will show how FlowGuard turns visual risks into managed incidents.” |
| 18–22 min | `<PRESENTER: DETECTION AND INCIDENTS>` | `FM` | Show a configured camera and monitoring zone, object detection, prepared detection alert, alert acknowledgement/investigation, linked incident, **Security Review**, and prepared Support Ticket. | Live alert unavailable → prepared alert data. AI delay → saved operational result while explaining the live Node-to-private-AI flow. | “The facility-level response is complete; `<NEXT PRESENTER>` will close the loop from the Tenant and Staff perspectives.” |
| 22–24 min | `<PRESENTER: TENANT AND STAFF>` | Demo `Tenant`, then demo `Staff` | Tenant: **Tenant Dashboard**, **My Staff**, own-unit attendance/bookings, and Staff Face ID status. Staff: **Staff Dashboard**, own attendance, permitted unit logistics, Settings, and denial of FM/Tenant administration routes. | Use separate pre-authenticated browser profiles; if session switching fails, use approved screenshots of the already-verified role views. | “These restricted views show the integrated journey across every user role; `<NEXT PRESENTER>` will summarise the value and enhancements.” |
| 24–25 min | `<PRESENTER: CONCLUSION>` | Public/`FM` summary | Recap cloud deployment, role isolation, face enrolment, Driver Pass/QR/plate verification, Pi/webcam fallback, object detection, alert-to-incident flow, auditability, and business value. | Use one prepared summary slide or screenshot while keeping the cloud application as the stated primary demonstration. | “That completes FlowGuard's end-to-end facility operations journey. We are ready for questions.” |

## Demo fallback plan

- Raspberry Pi unavailable → use **Laptop Webcam**.
- Camera permission failure → use the pre-approved browser/profile with permission already granted.
- Live alert unavailable → use prepared alert data and show its linked incident.
- Booking creation failure → use the prepared confirmed booking and verified Driver Pass.
- AI service delay → demonstrate the saved operational result and explain the normal live flow through Node to the private AI service.
- Internet issue → retain approved screenshots/video only as backup, while stating that the required main demonstration is the cloud-hosted application.
- QR scan delay → use the booking-reference manual fallback, then continue plate verification.
- Role-switch/session issue → use separate pre-authenticated browser profiles or Incognito windows; never share a displayed password.

## Final handoff check

- [ ] Every presenter knows their account and page starting point.
- [ ] Every next presenter has the correct browser window open before the transition.
- [ ] Password managers, notifications, personal tabs, and personal data are hidden.
- [ ] The final presenter has the one-minute enhanced-features summary ready.
- [ ] The team knows which person will answer deployment, security/privacy, AI, logistics, and business-value questions.
