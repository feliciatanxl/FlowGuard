# FlowGuard — AI Usage Summary (Felicia)

An honest summary of how AI assistants were used while building my modules
(Facial Recognition & Access Management + Smart Logistics & Loading Bay).

## What AI helped with
- **Planning & design:** shaping RBAC rules (FM/Tenant/Staff/Public), the booking/gate-scan flow,
  and the facial enrolment → recognition → review pipeline.
- **Coding assistance:** scaffolding React pages/components, Express routes, Sequelize model fields,
  the WhatsApp service, the Driver Pass QR page, and the gate-scan endpoint.
- **Debugging:** fixing the Driver Pass route/param mismatch, the `react-qr-code` CJS/ESM interop
  crash, the dark date-picker icon, and CSS class mismatches.
- **Testing:** drafting Jest/Vitest tests for RBAC, face enrol, bookings, gate scan, WhatsApp mock,
  and role-aware UI.
- **Documentation:** these Mermaid diagrams, API/schema docs, use cases, and rubric evidence.

## What I did (human review)
- Reviewed, edited, and accepted/rejected each suggestion; adjusted RBAC decisions (e.g. Staff = a
  factory worker, so Staff are blocked from AI/security pages and gate control, but may create
  bookings for their unit).
- Ran the app locally, tested flows by hand (enrol, recognise, book, gate scan, driver pass), and
  ran the automated suites before committing.
- Verified security choices: bcrypt hashing, JWT/RBAC, PDPA off-boarding, ownership checks, and that
  WhatsApp/DB credentials come from environment variables only.
- Made the final Git commits with meaningful messages.

## Later-stage work (3–4 August 2026)

Near submission I used AI mainly for integration, deployment and documentation accuracy rather than new features:

- **Staging readiness & deployment:** diagnosed the Cloud Run `DetectionAlert` schema-sync failure (read-only migration guidance), documented the staging client URL and test-account matrix in `deployment.md`, removed a hardcoded FM seed password, and documented the Gemini Cloud Run runtime settings — without committing, deploying, running migrations, or revealing any secret.
- **Independent Pi 4 vs Pi 5 handling:** kept the Raspberry Pi 4 Camera Module 3 as the facial-recognition node and integrated the Raspberry Pi 5 + Sony IMX500 SecurePi stream through Camera Inventory as a separate source, so one Pi being unreachable never marks the whole app offline and each falls back to the laptop webcam independently.
- **SecurePi contract compatibility:** matched the real minimal SecurePi service contract (`status:"online"` + `latest_frame_age_seconds`, optional `/people-count` and `/snapshot`, MJPEG first frame as final confirmation) and fixed the client so a post-health `/people-count` CORS/404 failure is treated as an unsupported optional capability rather than the service being unreachable.
- **Role-based attendance & RBAC:** the V-Patrol Patrol-only / Check In / Check Out control and server-authoritative `POST /api/attendance/action` (bounded `cycleId` idempotency, no new schema column), plus backend-enforced FM / Tenant / Staff attendance visibility, Activity Log date/time in Asia/Singapore, and `tenantId`-scoped booking privacy.
- **Documentation & design synchronisation:** group docs, diagrams and rubric evidence kept consistent with the real code, and stale automated-test evidence corrected.

The canonical external SecurePi runtime — the Raspberry Pi 5 + Sony IMX500 build physically used with this FlowGuard integration — is
[charlisaa/updated_securePi_FlowGuard](https://github.com/charlisaa/updated_securePi_FlowGuard). FlowGuard stores/configures its stream URL and consumes its local service and edge alerts; it does not own or deploy that runtime. AI did not independently validate physical hardware — the connection, health response and MJPEG stream were confirmed by manual testing on the device.

## Secrets & safety
- **No secrets committed.** All credentials are placeholders in `.env.example`; real values live in
  gitignored `.env` files. WhatsApp real-send is env-gated and off by default; tokens/phones are
  masked in logs.

## References
- Raw AI conversation logs: `flowguard-ai/Tan Xiu Li, Felicia/ai-logs/` (`.jsonl` files + `logs_link.md`).
- Detailed reflection: `flowguard-ai/Tan Xiu Li, Felicia/ai-reflection.md`.
- Per-change reports: `docs/Tan Xiu Li, Felicia/*.md` (each feature/fix documents what AI helped with,
  what I reviewed, and how I verified it).
