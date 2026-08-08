# Lucas use cases

Scope: Module 3 — AI Helpdesk & Facility Support (AI chatbot, chat transcript logging, automatic ticket escalation, Support Ticket CRUD, Knowledge Base CRUD, and a cross-module escalation path from Incident Tracking). User authentication is shared infrastructure. The use cases below describe only current behavior.

## Actors and roles

| Actor | Current authority |
|---|---|
| Facilities Manager (`FM`) | Reads/searches/filters the ticket queue, opens linked transcripts, updates ticket status/category/resolution notes, archives or hard-deletes tickets, and creates/edits/deletes Knowledge Base FAQs. Also creates tickets manually (e.g. escalating an incident from Module 4). |
| Tenant | Chats with the AI Helpdesk, with or without being logged in. A logged-in tenant's identity (`tenantName`) is server-verified from their account; an anonymous visitor's identity is self-reported and unverified. |
| Public/anonymous visitor | Can use the chat widget with no FlowGuard account — the endpoint requires no authentication. |
| Google Gemini (external AI service) | Generates the natural-language reply text only. It never decides escalation, ticket priority, ticket creation, or any database write — those stay fully deterministic in the backend. If it fails or is unavailable, the system falls back to a deterministic keyword-matched reply. |

## UC-S1: Tenant chats with the AI Helpdesk

- **Actor/role:** Tenant or anonymous visitor (public endpoint, no login required).
- **Preconditions:** Client holds a per-browser-tab `sessionId` (a UUID generated once and kept in `sessionStorage`, so it survives a page refresh within the same tab).
- **Main success flow:**
  1. Tenant types a message into the floating chat widget and sends it.
  2. `POST /api/support/chat` validates the request (`sessionId` must be a well-formed UUID; `message` must be non-empty and ≤2000 characters).
  3. If the request carries a valid, currently-active Bearer token, the server re-reads the account and overrides the client-supplied `tenantName`/`userId` with the verified values (unit number has no authoritative source on the User model, so it always stays client-supplied).
  4. The message is appended to the session's `ChatTranscript.messages` (creating the transcript row on first contact via `findOrCreate`).
  5. The current Knowledge Base is fetched and passed to Gemini as grounding context, along with a system prompt instructing it to answer only from that context, admit when it doesn't know, and treat the tenant's message as data rather than instructions.
  6. Gemini's reply is appended to the transcript and returned to the tenant.
- **Alternate/manual modes:** If Gemini fails (missing/invalid key, timeout, quota, network error), the system falls back to a deterministic keyword/token-overlap match against the Knowledge Base, or a generic "tell me more" prompt if nothing matches closely enough.
- **Edge/error flows:** Malformed `sessionId` or empty/over-length message → 400. A message that is the very first turn of a brand-new session never escalates on a trigger word alone (see UC-S2) — it always gets a KB/Gemini answer attempt first. Unauthenticated requests with a spoofed `tenantName` are accepted at face value (a known, documented limitation — see Security/privacy).
- **Postconditions:** The full exchange (both the tenant's message and the AI's reply, each timestamped) is persisted in `ChatTranscript.messages`.
- **Security/privacy:** The tenant message is treated as untrusted input inside the Gemini prompt (a basic prompt-injection guard, since the model has no tool/function-calling access — it only ever returns text). `unitNumber` and, for anonymous visitors, `tenantName` are unverified self-reported fields — a malicious client could claim a false identity in an escalated ticket. Chat is rate-limited per IP specifically (tighter than the general read limit) because each non-escalating turn can call the billed Gemini API.

## UC-S2: Automatic escalation to a Support Ticket

- **Actor/role:** System-triggered during UC-S1; no direct actor action beyond continuing to chat.
- **Preconditions:** The session is not already escalated.
- **Main success flow:**
  1. After the tenant's message is appended, the system evaluates `shouldEscalate`: true if the message contains a trigger phrase (e.g. "still not working", "urgent", "speak to someone") **and** this is not the tenant's first message in the session, **or** if the tenant has now sent 5 or more messages in the session regardless of content.
  2. Ticket creation and marking the transcript escalated happen together inside one database transaction, so a failure partway through can never leave a ticket the tenant is never told about.
  3. A `SupportTicket` is created: `priority` is always `High`, `status` is always `Pending`, and `category` is inferred — first from the closest Knowledge Base match's own category (if any), else from a small static keyword→category classifier (Access Control / Loading Bay / Visitor Parking / Security), else `General`.
  4. Gemini phrases the confirmation message shown to the tenant (ticket ID and the fact of escalation are fixed by the backend beforehand — Gemini only chooses the wording); if that call fails, a fixed template string is used instead.
  5. Every subsequent message in the same session receives a canned/Gemini-phrased "already being tracked" reply instead of a new escalation or KB answer.
- **Alternate/manual modes:** None — escalation is fully automatic and deterministic; no human or AI approval step exists before ticket creation.
- **Edge/error flows:** A trigger phrase on the *first* message of a session does not escalate (closes a bypass that would otherwise let a tenant skip the AI/KB attempt entirely by opening with "this is urgent"). Escalation is idempotent per transcript: `support_tickets.transcriptId` has a database-level unique constraint, so even a race between two near-simultaneous requests for the same session cannot create two tickets for one transcript.
- **Postconditions:** `ChatTranscript.isEscalated=true`, `escalationReason` set to the triggering message, and exactly one linked `SupportTicket` exists.
- **Security/privacy:** Escalation, priority, and ticket creation are never decided by the AI — only the reply wording is AI-generated, and only after the decision is already made.

## UC-S3: FM reviews and manages the support ticket queue

- **Actor/role:** FM only.
- **Preconditions:** Valid FM JWT.
- **Main success flow:**
  1. FM opens `/support-dashboard`; the Tickets tab loads `GET /api/support/tickets`, which defaults to the active (non-archived) queue, sorted High-priority-first then newest, paginated (10 per page in the UI, capped at 100 server-side).
  2. FM can search (tenant/unit/issue title/description, case-insensitive), and filter by status and category; any filter/search change resets to page 1 in the same render (no wasted intermediate fetch).
  3. FM edits a ticket's status, category, and/or resolution notes inline and saves via `PATCH /api/support/tickets/:id/status`; marking a ticket `Resolved` stamps `resolvedBy`/`resolvedAt`, and moving it away from `Resolved` clears both so the UI never shows a stale "Resolved by" caption on a reopened ticket.
  4. FM opens the linked transcript in a modal to read the full chat history behind the escalation.
  5. Summary cards (Total / High Priority / Investigating / Resolved) are backed by a dedicated `GET /api/support/tickets/stats` aggregate query, scoped to the active queue.
- **Alternate/manual modes:** FM can toggle to the Archive view (`?archived=true`) to see archived tickets separately from the active queue. FM can archive/restore a ticket (`PATCH /api/support/tickets/:id/archive`, reversible) as an alternative to hard delete for tickets that are resolved but worth keeping for reference.
- **Edge/error flows:** A malformed (non-UUID) ticket ID on any route returns 400, not a raw database error. An invalid `status` value returns 400 listing the valid set. Deleting a ticket (`DELETE /api/support/tickets/:id`) removes the ticket and its linked transcript together inside one transaction, so a failure partway through cannot leave one deleted and the other orphaned.
- **Postconditions:** Ticket fields reflect FM's edits; archived tickets are excluded from the default queue and its stats but remain fully readable in the Archive view; deleted tickets and their transcripts are gone permanently.
- **Security/privacy:** All ticket-management routes require `verifyToken` + `requireRole('FM')`, the same DB-authoritative auth pattern shared across the app (a suspended/deleted FM account or a stale token is rejected on every request, not just at login).

## UC-S4: FM manages the Knowledge Base

- **Actor/role:** FM only for writes; the FAQ list itself is also read publicly (by the chat engine and by anyone browsing `/api/support/knowledge`).
- **Preconditions:** Valid FM JWT for create/update/delete.
- **Main success flow:**
  1. FM opens the Knowledge Base tab, which lists all FAQs (`GET /api/support/knowledge`), filterable by category and searchable by question/answer text.
  2. FM adds a new FAQ (`POST /api/support/knowledge`) with category, question, answer, and optional comma-separated keywords; `createdBy` is stamped from the authenticated FM's identity.
  3. FM edits an existing FAQ (`PUT /api/support/knowledge/:id`); unspecified fields are left unchanged, `updatedBy` is stamped.
  4. FM deletes an outdated FAQ (`DELETE /api/support/knowledge/:id`), behind a confirmation dialog in the UI.
- **Alternate/manual modes:** None — there is no draft/approval workflow; a saved FAQ is immediately live and immediately available as Gemini grounding context and as the deterministic fallback's match pool.
- **Edge/error flows:** Missing question or answer → 400. Unknown FAQ ID → 404 (also 400 first if the ID isn't a well-formed UUID).
- **Postconditions:** The chat engine's next reply reflects the updated Knowledge Base immediately (no cache to invalidate — it is fetched fresh on every chat turn).
- **Security/privacy:** `category` is a suggested taxonomy (a fixed list in the FM dashboard's filter dropdowns) but stored as free text server-side, so FM can introduce new categories; this means a newly-invented category may not appear in the ticket-side filter dropdown until that dropdown's fixed list is extended (a known, documented limitation).

## UC-S5: FM escalates an Incident (Module 4) directly to a Support Ticket

- **Actor/role:** FM only, from the Incident Dashboard (a Module 4 page).
- **Preconditions:** An existing `IncidentLog` row FM wants to hand off to Facilities Management as a trackable ticket.
- **Main success flow:**
  1. FM clicks "Escalate to Ticket" on an incident row, opening a confirmation modal showing the incident's ID, location, source, and severity.
  2. FM confirms; the client calls `POST /api/support/tickets` directly (not through the chat/auto-escalation flow), since there is no chat transcript behind an incident-sourced ticket.
  3. Incident severity is mapped to ticket priority (`Critical`/`High` → `High`, `Medium` → `Medium`, else `Low`); the ticket is tagged `category: "Security"`; the issue title/description reference the source incident's ID and location.
  4. On success, the modal closes and a toast shows the created ticket's short ID.
- **Alternate/manual modes:** None currently — this is a one-way, one-shot escalation; there is no link back from the ticket to the incident beyond the free-text description referencing the incident ID (no dedicated foreign key exists between `support_tickets` and `incident_logs`).
- **Edge/error flows:** A request failure (network, validation, server error) shows an error toast and leaves the incident un-escalated so FM can retry.
- **Postconditions:** A new `SupportTicket` exists with `transcriptId=null` (no linked chat) and enters the same FM ticket-management workflow as any AI-escalated ticket (UC-S3).
- **Security/privacy:** Same FM-only auth as every other ticket-management route; this endpoint performs no cross-module database writes — the incident itself is unaffected by the escalation.

## UC-S6: Automatic 90-day transcript retention (PDPA)

- **Actor/role:** System (scheduled cron job); no direct human actor.
- **Preconditions:** Server process is running (the job is registered at startup).
- **Main success flow:**
  1. Once daily at 02:00, the job deletes every `ChatTranscript` where `isEscalated=false` and `createdAt` is older than 90 days.
  2. Escalated transcripts are deliberately excluded, since they remain linked to a `SupportTicket` FM may still need to reference (archiving a ticket does not change this — an archived ticket's transcript is still "escalated" and is retained).
- **Alternate/manual modes:** None — there is no manual "purge now" trigger and no per-tenant opt-out.
- **Edge/error flows:** A failure during the scheduled run is logged; it does not crash the server, and the next day's run attempts again independently.
- **Postconditions:** Non-escalated chat history beyond 90 days no longer exists in the database.
- **Security/privacy:** This is the system's stated data-minimisation control for casual/unresolved chat sessions — a transcript that never led to a ticket is not retained indefinitely.
