# Problem statement

FlowGuard addresses SCCCI Problem Statement 5B, Asset & Manpower Monitoring for Harrison Food Factory. The current proof of concept consolidates access checks, attendance, loading-bay scheduling, camera/zone monitoring, unattended-object alerts, facility support, and incident resolution for Facilities Managers, Tenants, Staff, and drivers.

## Current problem

Manual observation across multiple entrances, tenant areas, monitored zones, and two loading bays makes it difficult to maintain a consistent, searchable operational record. Separate access, delivery, alert, support, and incident workflows also make escalation and follow-up harder to coordinate.

## Implemented response

- Facial enrolment, checkpoint recognition, motion/head-turn liveness, attendance, access audits, evaluation, and privacy-aware off-boarding.
- Camera/zone configuration, browser/upload/SecurePi object sources, people counting, unattended-object alerts, and linked incident creation.
- Keyword/knowledge-base facility helpdesk, persistent transcripts, automatic ticket escalation, and FM resolution.
- Searchable incident CRUD with bidirectional detection-alert synchronisation.
- Booking CRUD, public Driver Pass, QR/plate-assisted FM gate verification, decision auditing, and mock-safe WhatsApp notifications.

## Scope boundary

The current submission is an academic proof of concept. Advanced pest analytics, temporal object-action recognition, threat classification and continuous multi-camera re-identification are documented as post-PoC deployment work and are not presented as completed features.

The project also does not claim certified biometric anti-spoofing, production LPR accuracy, explosive certification, autonomous gate actuation, production sensor telemetry, or a measured reduction in security labour. These require separate data, hardware, integration, validation, safety, privacy, and operational approvals.

See [client-feedback-traceability.md](client-feedback-traceability.md) for the client-request disposition.
