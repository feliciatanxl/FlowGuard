# AI Reflection — Facial Recognition & Access Management (Felicia)

This module was built with the help of AI assistants (Claude and Gemini). The raw prompt
logs are in [`ai-logs/`](./ai-logs/) and the shared chat links are in
[`ai-logs/logs_link.md`](./ai-logs/logs_link.md).

## What AI helped with
- Scaffolding the React enrolment flow (webcam capture + manual upload fallback) and the
  V-Patrol / Gate Scanner live-recognition UI (state machine, face-box overlay, liveness).
- Writing the Python InsightFace endpoints (`/api/encode-faces`, `/user/recognize`) and the
  cosine-similarity matching logic.
- Designing the Sequelize models and the Express routes for enrolment, user management,
  security logs, and the new FM manual-review workflow.
- Adding route protection, PDPA-style off-boarding, and the Jest / Vitest test suites.
- Drafting documentation (API docs, DB schema, this report).

## What I manually reviewed
- **Security boundaries** — I checked that protected pages (`/vpatrol`, `/users`,
  `/tenant-management`, `/user-logs/:id`, `/security-review`, `/gate-scanner`, `/attendance`,
  `/staff`, `/enrollment`) are wrapped in `ProtectedRoute`, and that the `/api/security/*`
  routes reject requests without a JWT. I confirmed only FM users can review logs or reach
  FM management pages.
- **PDPA / data minimisation** — I verified deletion wipes the `faceVector`, removes the
  attendance trail, and anonymises (does not silently keep) the personnel name on security
  logs. I deliberately kept the access events for the audit trail and only stripped the PII.
- **Data-store accuracy** — the embedding is stored as `FLOAT[]` (`ARRAY(FLOAT)`), not a
  `pgvector` column, so I corrected the README and DB schema docs to match the real code.

## What code I accepted / rejected
- **Accepted:** the enrolment UI, the recognition state machine, the review-status model
  fields, and the anonymise-on-delete approach.
- **Adjusted:** I made `ProtectedRoute` support an `allowedRoles` array so multi-role pages
  (attendance, staff) are not forced to a single role.
- **Rejected / corrected:** an earlier AI draft claimed `pgvector`/`VECTOR(512)` in the docs
  while the model actually uses `FLOAT[]`; I rejected the inaccurate wording. I also chose
  **anonymisation over hard-deleting** security logs so the audit history survives off-boarding.

## How I verified correctness
- `cd server && npx jest` → all backend tests pass (auth, enrol, delete/PDPA, review workflow).
- `cd client && npx vitest run` → all frontend tests pass (enrol render, upload validation,
  submit endpoint, route protection).
- `cd client && npx vite build` → production build succeeds.
- Manual browser checks: enrolment (camera + upload), live recognition logging, FM review
  page status/notes update, and that logging out blocks the protected pages.

## Limitations / risks
- Recognition uses a fixed cosine-similarity threshold (0.45) and a simple head-turn liveness
  check — not production anti-spoofing; good enough for a PoC demo.
- Security logs link to users by **name**, not a foreign key, so the anonymisation matches on
  name. A future improvement is a real `userId` FK with `ON DELETE SET NULL`.
- The Vite dev proxy targets the backend on a fixed port; the `.env` `APP_PORT` must match it.
