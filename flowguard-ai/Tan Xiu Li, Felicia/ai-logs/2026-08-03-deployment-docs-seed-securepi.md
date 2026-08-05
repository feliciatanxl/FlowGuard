# AI Log — Deployment/test-account docs, FM seed credential hardening, and SecurePi architecture documentation

**Date:** 2026-08-03
**Branch:** feature/facial-smart-logistics
**Tool:** Codex CLI
**Project:** FlowGuard
**Source session:** `019fc757-4297-7b30-944f-c0a440c9bd3b`

**Archive note:** User-authored prompts are reproduced verbatim except that credential-like values are replaced with `[REDACTED]`. Long multi-section briefs pasted as attachments are quoted verbatim at their opening and their remaining sections are summarised faithfully (marked `[…]`); no prompt content is invented. Internal auto-review, subagent, command, hidden-reasoning and tool-notification records are omitted.

---

## Task 1 — Document the staging URL and test accounts in deployment.md

**Prompt date/time:** 2026-08-03 19:17 SGT

**Prompt (verbatim opening; full brief summarised):**

> Work on the current FlowGuard repository and current branch. Do not switch branches / commit / push / merge / deploy / modify Cloud Run, Cloud SQL, Secret Manager or Artifact Registry / run migrations / create, delete or reset user accounts / add any real password, secret, token or personal credential. Do not make application-code changes unless documentation cannot be corrected without them (report instead).

The brief framed this as Full Stack Assignment / Week 17 Final Review submission work: `deployment.md` must document the cloud-hosted client URL and the test user accounts (one existing seeded FM account, email expected `admin@harrison.com`, using the standard demo password which must not be revealed), plus Tenant/Staff demo accounts to be created by the user. `[…]`

**Response summary:** Updated `deployment.md` to document the staging URL and the test-account matrix without disclosing any password.

**Outcome:** Produced doc edits; no accounts created or passwords revealed. No commit/push/deploy.

---

## Task 2 — Remove the hardcoded FM seed password and create the SecurePi edge-AI documentation

**Prompt date/time:** 2026-08-03 19:33 SGT

**Prompt (verbatim opening; full brief summarised):**

> Work on the current FlowGuard repository and current branch. Do not switch branches / commit / push / merge / deploy / trigger Cloud Build / modify Cloud Run, Cloud SQL, Secret Manager or Artifact Registry / run migrations / create, reset or delete any deployed account / reveal the existing FM password / restore deleted SecurePi source folders into FlowGuard.

The brief had two parts: (A) safely remove the literal FM bootstrap password from `server/seed.js` (which printed it during seeding) without disclosing the value, after inspecting the seed flow, User model, password hashing hooks, auth/password-change routes and server `.env` example; and (B) create documentation explaining the separate SecurePi Raspberry Pi 5 + Sony IMX500 edge-AI subsystem and its relationship with FlowGuard. `[…]`

**Response summary:** Hardened the FM seed credential (no literal password, sourced from environment) and authored/updated the SecurePi Pi 5 + IMX500 edge-AI architecture documentation describing the separate-repository ownership boundary.

**Outcome:** Produced edits (seed fix + SecurePi doc). No accounts created/reset, no password disclosed, no commit/push/deploy. Final message "SEED SECURITY AND SECUREPI DOCUMENTATION READY FOR REVIEW"; manual next steps flagged — verify/rotate the FM demo password, create demo Tenant/Staff, confirm the canonical SecurePi repo, and perform physical Pi 5 + IMX500 validation.
