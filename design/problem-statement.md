# FlowGuard problem statement

FlowGuard addresses SCCCI Problem Statement 5B, Asset & Manpower Monitoring for Harrison Food Factory. The current proof of concept brings access, attendance, loading-bay, monitoring, incident, support, and operational-knowledge workflows into one role-controlled application.

## Client context

Harrison Food Factory has multiple tenants, entry points, operating zones, cameras, and two loading bays. Facilities and security personnel need a consistent way to see what is happening, decide who may enter, coordinate deliveries, investigate alerts, and retain a searchable operational record. Tenants and Staff need narrower views of their own work, while drivers need a usable gate pass without an internal account.

## Target users

- **Facilities Manager (`FM`)** — facility-wide administration, monitoring, gate decisions, incidents, security review, support tickets, knowledge management, and analytics.
- **Tenant** — own Staff, attendance, and loading-bay bookings.
- **Staff** — own attendance and permitted operational/logistics views.
- **Security and operations personnel** — represented by the `Staff` role and FM-controlled monitoring/review workflows.
- **Driver** — public Driver Pass holder; no FlowGuard login is required.

## Business pain points

- Manual monitoring across many entry points and operational zones is difficult to coordinate and audit.
- Unattended objects and unauthorised access can be missed or handled outside a shared incident process.
- Access and attendance verification are slow when identity, liveness, and user status must be checked manually.
- Loading-bay scheduling, vehicle checks, and driver entry are inefficient when booking, QR, and plate information are fragmented.
- Alerts, security reviews, incidents, and notification outcomes need linked records rather than separate notes.
- Support requests and facility knowledge can be slow to retrieve or escalate.
- Pest or rodent activity is an operational concern, but reliable physical detection requires the separate SecurePi hardware/model validation described in the edge-AI documentation.

## FlowGuard response

| Pain point | Integrated response |
|---|---|
| Access and attendance | Three-angle facial enrolment, motion/head-turn liveness, fail-closed recognition decisions, attendance scans, and security audit records. |
| Loading-bay coordination | Booking CRUD, overlap checks, public Driver Pass, QR/reference and proof-of-concept plate verification, gate decision audit, and notification status. |
| Facility monitoring | Camera and zone management, browser/upload/SecurePi sources, people/object analysis, unattended-object thresholds, and source attribution. |
| Fragmented incident handling | Atomic alert-to-incident creation, linked status/severity updates, security review, resolution tracking, and incident analytics. |
| Slow operational support | Persistent helpdesk transcripts, Gemini-backed replies grounded in the Knowledge Base, deterministic fallback, automatic ticket escalation, and FM ticket lifecycle management. |
| Edge and local resilience | Camera Module 3 browser streaming with Laptop Webcam fallback, plus separate SecurePi/IMX500 authenticated edge events and local evidence/outbox support where that SecurePi variant provides it. |

## Enhanced features

- Facial recognition with front, left, and right enrolment captures.
- Motion/head-turn liveness, multiple-face rejection, current-account revalidation, and fail-closed error states.
- Smart Logistics bookings, public Driver Pass, QR/reference verification, and proof-of-concept plate OCR with FM correction.
- Laptop Webcam and Raspberry Pi Camera Module 3 source switching, with the current Pi base URL stored only in browser-local configuration.
- Object detection with browser, upload, and SecurePi sources; linked incidents retain alert source and lifecycle metadata.
- SecurePi on Raspberry Pi 5 with Sony IMX500 as a separate edge subsystem, with authenticated, idempotent event ingestion in FlowGuard.
- Persisted WhatsApp notification state; real delivery occurs only when the required service configuration is enabled.
- Gemini-backed helpdesk text generation, with deterministic Knowledge Base matching and fixed safe responses when Gemini is unavailable.
- Knowledge Base CRUD, support ticket categorisation/status/archive workflow, and restored chat history.
- Incident resolution timestamps and client-side MTTR, confidence, accuracy, and resolution-funnel analytics.
- JWT authentication, server-enforced RBAC, security/audit logs, rate limiting, CORS controls, and private AI-service invocation.
- Google Cloud deployment configuration, liveness/readiness checks, Cloud SQL persistence, Secret Manager, Artifact Registry, and Cloud Build workflow.

## Success criteria

- Role-restricted users can complete only their intended workflows and forbidden routes fail safely.
- Enrolled users can be checked at a supported checkpoint and current account state remains authoritative.
- Bookings can be created, reviewed through a public Driver Pass, and verified at the gate with an auditable decision.
- Camera workflows can use the configured Pi source and fall back to the Laptop Webcam when the Pi is unavailable.
- A supported alert can create a linked incident with source, severity, status, and notification metadata.
- Support questions can receive a grounded response or deterministic fallback, retain their transcript, and escalate to an FM ticket when the fixed rules require it.
- Database-backed records remain available after refresh, subject to the implemented retention and deletion lifecycle.
- Deployed services remain accessible and the backend reports not ready when its database/schema prerequisites are not satisfied.
- Errors, missing configuration, duplicate edge events, and unavailable external services do not silently grant access or duplicate operational records.

## Scope boundary

FlowGuard is an academic proof of concept. It does not claim certified biometric anti-spoofing, production licence-plate recognition accuracy, autonomous barrier actuation, explosive classification, production pest detection, continuous cross-camera person/animal re-identification, or measured reductions in labour or incident rates. SecurePi pest logic and off-device tests do not prove successful physical rodent detection on the intended Pi 5/IMX500 model; that remains a documented hardware-validation requirement.

See [client-feedback-traceability.md](client-feedback-traceability.md) for the evidence-based disposition of client requests and limitations.
