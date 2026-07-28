# Felicia rubric evidence map

This document maps current evidence; it does not award a grade.

| Criterion | Current evidence | Missing evidence | Action required |
|---|---|---|---|
| A1 roles/use cases | `design/Tan Xiu Li, Felicia/use-cases.md` covers FM/Tenant/Staff/Driver/service actors, preconditions, success, fallback, edge cases, postconditions, and privacy for facial access and Smart Logistics. | Tutor/client sign-off on scope is not present. | Obtain dated review/sign-off; keep advanced requests as future scope. |
| A1 API docs | Owned account/enrolment, facial, attendance/security, booking, QR, and gate-verification endpoints have auth, roles, parameters, examples, statuses, side effects, AI/privacy notes. | OpenAPI for Felicia endpoints is not present; legacy route `/gate-scan` and canonical `/gate-verification` coexist. | Optionally add validated OpenAPI and clearly deprecate legacy route in a future code task. |
| A1 database | User facial fields, EvaluationParticipant, SecurityLog, Attendance, Booking, GateAccessLog, constraints, indexes, soft references, status values, retention and no-image policy documented from models. | Deployed Cloud SQL schema/export evidence absent. | Capture sanitised schema/index evidence from deployed database. |
| A1 architecture | Canonical architecture shows browser/Pi sources, Cloud Run client/Node/private AI, Cloud SQL, QR path, credentials, WhatsApp, and SecurePi. Mermaid architecture/ER PNGs were regenerated and visually checked on 28 July 2026. | Live cloud resource/IAM evidence remains absent. | Capture sanitised deployed architecture and IAM evidence. |
| A2 React/Node/PostgreSQL/FastAPI | FaceEnrollment, GateScanner, VPatrol, FacialEvaluation, Attendance, Logistics, DriverPass, GateVerification -> Node routes/models -> private FastAPI as applicable. | Deployed end-to-end evidence for each flow absent. | Capture successful and denied deployed journeys plus DB/audit result. |
| A2 CRUD/enhancement | User/access lifecycle and booking CRUD; audited gate verification, QR fallbacks, OCR correction, SG time, WhatsApp and next-driver enhancements. | OCR is PoC only; barrier is simulated; no certified liveness. | Use bounded demo wording and document production validation roadmap. |
| A2 RBAC/security | FM-only scanner/gate pages, scoped Tenant/Staff behavior, DB-authoritative JWT, token revocation, off-boarding transaction, private AI credentials, CORS/rate limits. | Live IAM and Secret Manager bindings not captured; MemoryStore per-instance limitation. | Add sanitised cloud evidence and production distributed-limit plan. |
| A2 usability/performance | Pi/webcam/upload/manual fallbacks, large QR/ref, accessible `YOU` marker, safe messages, AI timeouts, split tracking/recognition, and shared 512 px/JPEG 0.74 recognition defaults with bounded deployment overrides. | No measured warm/cold deployed latency dataset; main client chunk remains large. | Record QR/face latency and plan focused route-level code splitting. |
| A2 Git evidence | Current branch `feature/facial-smart-logistics`; recent merge/security commits exist. | No concise PR/commit-to-rubric table. | Add PR/commit links or screenshots for Felicia-owned work. |
| A3 tests | Felicia client subset 501/501; the nine previously failing/camera-lifecycle files passed 79/79 in three consecutive runs. Full server is 501/501 across three final runs and contains 25 Felicia files/315 assertions; the complete 16-test rate-limit file passed three consecutive focused runs. | Direct large Jest combinations can still trigger a Windows Node native exit; hardware/private-image suites were not run; Jest prints the force-exit advisory. | Use the bounded full runner in Windows CI and run hardware tests in a controlled environment. |
| A3 deployment | Cloud Run/Cloud SQL design and verified client URL; private AI auth code and Dockerfiles. | Direct server URL, Cloud SQL instance, IAM, trigger/build/revision and rollback evidence missing. | Capture current Google Cloud evidence without secrets. |
| B1 interim review | Working PoC, client feedback table, explicit limitations/future plan. | Dated feedback/minutes and interim demonstration artefact. | Attach client/tutor evidence. |
| B2 final review | Facial access -> attendance/security and booking -> Driver Pass -> gate decision -> audit/notification journeys are documented and green in deterministic automated coverage. | Live deployed demo evidence remains absent. | Rehearse and capture truthful deployed edge cases. |
| C1 AI workflow | Existing separate AI package and `ai-usage-summary.md`. | Student must verify coverage across design, coding, testing, deployment. | Submit AI logs separately; do not add logs to main repo. |
| C2 AI reflection | `flowguard-ai/Tan Xiu Li, Felicia/ai-reflection.md` exists. | Reflection quality is outside this audit. | Felicia reviews/submits it in her own words; do not have AI rewrite it. |

## CRUD and automatic evidence

- Facial/access create/update/delete: `/user/manual-create`, `/user/enroll-face`, `/user/suspend/:id`, SecurityLog review, and transactional `/user/:id` off-boarding.
- Facial/access reads: users, attendance, SecurityLog, evaluation participants.
- Automatic: transient tracking, recognition with PostgreSQL status, Gate Scanner attendance, V-Patrol security audit, denied-event handling, stable evaluation labels/cache refresh.
- Logistics create/read/update/logical delete: booking create/list/public pass/edit/status/cancel.
- Enhanced automatic: SG time conversion, same-bay conflict 409, QR local/cloud/manual fallbacks, PoC OCR/manual correction, FM-authoritative audited decisions, idempotency, WhatsApp real/mock-safe, and next-driver notification.
