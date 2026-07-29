# Frontend test cases - Felicia

These cases map to the current Vitest files in this folder. Latest subset run: **501/501 passed across 54 files** on 28 July 2026. The nine scan-tuning, user-marker, Gate Verification, and camera-lifecycle files also passed **79/79 in three consecutive runs**.

| Area | Representative cases and expected result | Mode/edge coverage | Current status |
|---|---|---|---|
| Face enrolment | Render capture UI; front/left/right progression; upload each angle; reject non-image; submit `/user/enroll-face`; surface backend error. | Pi source, webcam fallback, upload fallback, re-enrol target. | Passing in full subset except no failure attributed here. |
| Camera sources | Probe Pi, switch to webcam, capture Pi snapshot, handle timeout/denied camera without confusing AI outage with Pi outage. | Camera Module 3 unavailable -> webcam; enrolment camera denied -> upload. | Passing. |
| Recognition/liveness | Face box, presence/count, baseline/head-turn state, same-ID final confirmation, unknown/suspended/multiple faces, stale response/source switch. | Gate Scanner and V-Patrol; manual Scan Now does not bypass policy. | Passing. |
| Attendance/V-Patrol | Attendance toolbar/role summaries; Gate Scanner triggers attendance only after final confirmation; V-Patrol writes access event without attendance. | FM/Tenant/Staff scoping, denied events. | Passing. |
| Evaluation | Participant sync/list, recorder, image evaluation, live confusion matrix, phase-3 policies, no production writes. | Unknown/no face; stable labels; local evidence. | Passing. |
| User/RBAC/security UI | ProtectedRoute, sidebar/drawer, roles, user management, tenant expiry, Settings, security timeline/review dates. | FM/Tenant/Staff visibility, accessible visible `YOU` marker, and responsive layout. | Passing. |
| Smart Logistics CRUD | List/search/today filter; create/edit; SG date/time; conflict/error display; cancel; public pass polling and safe display. | FM/Tenant/Staff views; completed/cancelled edit restrictions. | Passing. |
| Driver Pass/QR | Large QR/reference, live polling, fallback, native/ZXing/cloud/manual behaviors. | No QR -> cloud/manual; permission/source failure. | Passing. |
| Gate verification | Automatic/manual source selection, time/status/reason messaging, PoC OCR correction, audited override UI, idempotent entry/exit display. | Cancelled/early/late/mismatch/unreadable/camera unavailable. | Passing. |
| Performance constants | Shared capture size/quality and scanner cadence. | Accuracy default 512 px/JPEG 0.74; bounded configuration 512-640/0.74-0.85; invalid/lower-detail values fail back to defaults. | Passing. |
| Build/API/error hygiene | API base, error pages/boundary, icon/media helpers, mojibake scan, hash navigation. | Production relative paths and graceful errors. | Passing. |

Shared CameraFeed coverage is also green and uses the canonical `camera_id`/`zone_id` contract with valid-token and missing-token cases.
