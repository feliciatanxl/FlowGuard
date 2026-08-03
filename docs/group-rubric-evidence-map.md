# Group rubric evidence map

This is an evidence map, not a grade claim. “Current evidence” means code, tests, or current documentation inspected in the repository. Missing evidence must be supplied rather than inferred.

## Official ownership

| Module | Owner | Assessed feature |
|---|---|---|
| 1 | Felicia | Facial Recognition & Access Management; enhanced capability: Smart Logistics/loading-bay verification |
| 2 | Charlisa | Object Detection & Space Management |
| 3 | Lucas | AI Helpdesk & Facility Support |
| 4 | Gladwin | Incident Tracking & Resolution |
| Shared | Team | Accounts/authentication/RBAC infrastructure; not a main assigned feature |

## Current implementation evidence

- Felicia: User/Attendance/SecurityLog/EvaluationParticipant/Booking/GateAccessLog routes, pages, models, and tests. Smart Logistics is Felicia's extension, not Module 4.
- Charlisa: Camera/MonitoringZone/DetectionAlert CRUD, browser/upload/SecurePi sources, people/unattended rules, edge ingest, and tests.
- Lucas: KnowledgeBase-grounded Gemini chat replies (deterministic keyword-match fallback if the API is unavailable), ChatTranscript persistence, automatic SupportTicket escalation (deterministic — trigger phrases/message count, not AI-decided), linked transcript reads, status/resolution updates, ticket+transcript delete, KnowledgeBase CRUD.
- Gladwin: automatic linked incidents from both alert-ingest routes, manual incident CRUD/search, resolution/notes/severity/person updates, and bidirectional linked soft deletion/synchronisation through `DetectionAlert.incident_log_id`.

## Rubric traceability

| Criterion | Current evidence | Missing evidence | Action required |
|---|---|---|---|
| A1 System Design - roles/use cases/edge cases | Canonical `design/problem-statement.md`, architecture, client feedback; Felicia and Charlisa use-case files; React + Node RBAC. | No individual design folder was found for Lucas or Gladwin. Charlisa filenames use a different uppercase convention. | Lucas and Gladwin must supply their own role-based use cases with alternate/error flows; preserve teammate authorship. |
| A1 - API documentation | Felicia API document covers owned current endpoints/examples/errors/side effects; Charlisa API document exists; object OpenAPI exists. | No Lucas/Gladwin individual API documents found. Some teammate API narrative still needs owner review after linked-incident architecture changes. | Each owner verifies every endpoint against current route code and records auth, examples, error codes, and data effects. |
| A1 - database schema/relationships | Canonical ER covers all current models; Felicia DB schema covers owned entities; Charlisa DB document exists. `DetectionAlert.incident_log_id -> IncidentLog.id` and GateAccessLog are documented. | Cloud SQL live schema/migration proof and Lucas/Gladwin individual schema documents absent. | Export/inspect deployed schema without secrets and add owner-authored schema evidence. |
| A1 - architecture | Canonical architecture and Mermaid diagram show Cloud Run client/Node/private AI, Cloud SQL, camera sources, Node credential boundary, QR paths, WhatsApp and SecurePi. Architecture and ER PNGs were regenerated from Mermaid and visually checked on 28 July 2026. | Live resource/IAM evidence absent. | Add sanitised Google Cloud resource and IAM evidence. |
| A2 Code and Integration - full stack | React pages -> Node routes -> Sequelize/PostgreSQL, plus private FastAPI inference. Helpdesk and incident workflows persist current models. | No end-to-end deployed transaction evidence captured in repository for every module. | Record one deployed full-stack journey per owner with request/DB/UI evidence. |
| A2 - RBAC/security | `ProtectedRoute`, DB-authoritative JWT middleware, role checks (including camera/zone router-wide JWT verification), CORS fail-closed, rate limits, password/session controls, private AI design. | Distributed rate limiting is not implemented; live IAM policy was not captured in this repository-only audit. | Capture IAM/CORS evidence and consider a shared rate-limit store for multi-instance deployment. |
| A2 - UX improvements | Camera fallbacks, manual modes, readable Driver Pass, error states, responsive reports/pages. | No consolidated moderated usability study or accessibility audit. | Add participant/task evidence, issues found, changes, and retest results. |
| A2 - performance controls | Recognition defaults are 512 px/JPEG 0.74 with one bounded resolver (512-640/0.74-0.85); tracking uses smaller frames; QR cadence, request locks, limits/timeouts, and build output are tested. | No deployed warm/cold latency or sustained-load dataset; the main client chunk remains 730.53 kB minified. | Record Cloud Run latency/load evidence and plan focused route-level code splitting. |
| A2 - Git branch/merge evidence | Commit/merge history exists; current branch and recent merges were inspected. | Owner-to-module branch/PR/merge matrix and review links not consolidated. | Add repository/PR references or screenshots mapped to each owner. |
| A3 Testing | Current test-case documents and final run: client 552/552, server 501/501, safe AI/edge 29/29 three times, Felicia client 501/501, Charlisa client 38/38 three times, Charlisa server 143/143, Pi cache 9/9. | Physical/private-image tests were not executed; direct large Jest combinations can trigger a Windows Node native exit, so the full command uses six bounded processes and retains every suite. | Run optional hardware/private-dataset procedures in a controlled environment and investigate Jest/Node open handles separately. |
| A3 Deployment | Cloud Run Dockerfiles/configuration, private AI invocation code, Cloud SQL target, Secret Manager names, verified public client URL. | Direct server URL, Cloud SQL instance/database, AI IAM policy, Cloud Build/Developer Connect trigger/build/revision evidence not verified. | Capture actual console/CLI exports and smoke tests; never invent URLs. |
| A3 privacy/storage | Code comments/routes/models show facial/QR/plate frames transient; embeddings and audit metadata persist; models baked into image. | Retention policy evidence beyond transcript cleanup and user off-boarding; SecurePi local snapshot governance. | Add retention/access-control table and operational deletion test. |
| B1 Interim Review | Working module code, current PoC scope, known limitations, and client feedback traceability. | Dated interim review artefacts and client acknowledgement are not present in the audited design/docs set. | Attach dated minutes/screenshots/feedback and realistic completion plan. |
| B2 Final Review | Integrated user journeys/error states are documented and covered by deterministic component, route, transaction, RBAC, and edge tests; security/performance/usability boundaries and future scope are explicit. | Live deployed demo evidence and hardware execution remain absent. | Rehearse and capture deployed end-to-end role journeys; state hardware limits honestly. |
| C1 AI Workflow | `docs/Tan Xiu Li, Felicia/ai-usage-summary.md` points to a separate AI package; separate `flowguard-ai/` package contains existing logs. | Completeness across design, coding, testing, deployment is an individual submission responsibility. | Submit AI logs separately. Do not add/regenerate logs in the main documentation task. |
| C2 AI Reflection | Reflection files were found for Felicia, Charlisa, and Gladwin. | No Lucas reflection file was located in `flowguard-ai/` during this audit. Content quality was not edited or graded. | Lucas supplies a reflection in their own words. Do not use AI to rewrite any student's reflection. |

## Client-request status

Implemented in the current PoC: supported unattended-item detection and linked incident workflow. Partially supported: generic forgotten belongings, generic alert time/location/snapshot infrastructure, and enrolled identity recognised again at checkpoints. Future deployment/research: temporal object actions, suspicious-item/explosive classification, scheduled after-hours rules, animal/pest/rat detection, rat evidence and re-identification, pest hotspot analytics, and continuous cross-camera re-identification. See `design/client-feedback-traceability.md`.
