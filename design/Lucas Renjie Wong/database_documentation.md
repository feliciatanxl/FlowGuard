# Lucas database documentation

Source of truth: current Sequelize models in `server/models` plus the hand-run SQL migrations in `server/migrations/` that evolved these tables after they were first created (this project has no Sequelize-CLI migration framework). Sequelize supplies `createdAt`/`updatedAt` timestamps on all three tables unless noted otherwise. Column names on these three tables are quoted camelCase in PostgreSQL (e.g. `"isArchived"`), not the snake_case convention used by some newer tables elsewhere in the app — new columns on these tables must keep matching that existing convention.

## `chat_transcripts` / ChatTranscript

| Field | Sequelize/PostgreSQL type | Null/constraint/default | Purpose |
|---|---|---|---|
| `id` | UUID | PK, default `UUIDV4` | Transcript identity. |
| `sessionId` | UUID | not null, **unique** | One transcript per browser-tab chat session; generated client-side (`crypto.randomUUID()`) and kept in `sessionStorage`. |
| `userId` | INTEGER | nullable, soft reference to `users.id` (no FK/association) | Set only if the tenant is logged in (and then only from a server-verified token, never trusted from the request body alone). |
| `tenantName` | STRING | nullable | Self-reported for anonymous visitors; server-verified (overridden from the account) when a valid Bearer token is present. |
| `unitNumber` | STRING | nullable | Always self-reported — no field on the User model holds an authoritative unit number, so this cannot be verified even for a logged-in tenant. |
| `messages` | JSONB | not null, default `[]` | Array of `{ role: 'user'|'ai', text, timestamp }`. The whole conversation lives in one JSON column, not a separate messages table. |
| `isEscalated` | BOOLEAN | not null, default `false` | Flips true the moment a linked `SupportTicket` is created; gates whether further messages get a canned "already tracked" reply instead of a new answer/escalation. |
| `escalationReason` | TEXT | nullable | The tenant message that triggered escalation. |

Associations: `ChatTranscript.hasOne(SupportTicket, foreignKey: 'transcriptId', as: 'ticket')`.

Indexes: implicit PK on `id`; unique index on `sessionId` (from the model's `unique: true`); `idx_chat_transcripts_escalated_created` on (`isEscalated`, `createdAt`) — added by migration `20260803_support_ticket_category_status_archive.sql` specifically to back the 90-day retention cron's `WHERE isEscalated = false AND createdAt < cutoff` query, which had no supporting index before.

## `support_tickets` / SupportTicket

| Field | Sequelize/PostgreSQL type | Null/constraint/default | Purpose |
|---|---|---|---|
| `id` | UUID | PK, default `UUIDV4` | Ticket identity; the short form shown to users/FM is the first 8 characters, uppercased. |
| `transcriptId` | UUID | nullable, **unique** (added by migration `20260803b_support_ticket_transcript_unique.sql`) | Links back to the originating chat session. `NULL` for manually-created tickets (e.g. an incident escalation) — Postgres allows unlimited `NULL`s under a unique constraint, so those coexist freely; a non-null value can link to at most one ticket, closing a concurrency race where two near-simultaneous chat requests for the same session could otherwise each create their own ticket. |
| `userId` | INTEGER | nullable, soft reference | Copied from the transcript at ticket-creation time, or unset for a manual ticket. |
| `tenantName` | STRING | nullable | Copied from the transcript, or supplied directly for a manual ticket. |
| `unitNumber` | STRING | nullable | Same as above. |
| `issueTitle` | STRING(255) | not null | Auto-generated from the first 100 characters of the triggering message for AI escalations; supplied directly for manual tickets. |
| `issueDescription` | TEXT | not null | Auto-generated (session reference + the tenant's last message) for AI escalations; supplied directly for manual tickets (e.g. references the source incident's ID/location). |
| `category` | STRING(100) | not null, default `'General'` | Free text (not an ENUM), matching `knowledge_base.category`'s convention — added by migration `20260803_support_ticket_category_status_archive.sql`. Auto-inferred at escalation time (closest Knowledge Base match's category, else a static keyword classifier, else `General`); FM can correct it via the status-update endpoint. |
| `priority` | ENUM(`Low`,`Medium`,`High`) | not null, default `High` | AI-escalated tickets always create as `High` — `Low`/`Medium` currently only occur on manually-created tickets (e.g. incident severity mapping). |
| `status` | ENUM(`Pending`,`Investigating`,`Resolved`,`Closed`) | not null, default `Pending` | Changed from an original 3-value enum (`Pending`/`In Progress`/`Resolved`) by the same migration; existing `In Progress` rows were backfilled to `Investigating`. Postgres cannot drop an enum label in place, so `In Progress` remains a harmless, unused value at the database level — application code never emits or accepts it again. |
| `isArchived` | BOOLEAN | not null, default `false` | Reversible archive state, distinct from hard delete — added by the same migration. |
| `resolvedBy` | STRING | nullable | Stamped (FM identity) when status is set to `Resolved`; cleared whenever status moves away from `Resolved`, so a reopened ticket never shows a stale value. |
| `resolvedAt` | DATE | nullable | Same lifecycle as `resolvedBy`. |
| `resolutionNotes` | TEXT | nullable | Free-text FM notes, settable independently of status. |

Associations: `SupportTicket.belongsTo(ChatTranscript, foreignKey: 'transcriptId', as: 'transcript')`.

Indexes: implicit PK on `id`; unique index `support_tickets_transcript_id_unique` on `transcriptId`; `idx_support_tickets_archived_status_created` on (`isArchived`, `status`, `createdAt`) — sized specifically to the FM dashboard's actual default query shape; `idx_support_tickets_category`; `idx_support_tickets_priority`.

## `knowledge_base` / KnowledgeBase

| Field | Sequelize/PostgreSQL type | Null/constraint/default | Purpose |
|---|---|---|---|
| `id` | UUID | PK, default `UUIDV4` | FAQ entry identity. |
| `category` | STRING | not null, default `'General'` | Free text, FM-defined — no fixed enum, so FM can introduce new categories (e.g. "Loading Bay Rules") at will. The FM dashboard's category filter dropdowns use a separate fixed suggested list, which can drift from whatever categories actually exist here. |
| `question` | TEXT | not null | The FAQ's question, shown to FM and used as Gemini grounding context / fallback keyword-match text. |
| `answer` | TEXT | not null | The FAQ's answer — the actual facility policy text. |
| `keywords` | `ARRAY(STRING)` / PostgreSQL `TEXT[]` | not null, default `{}` | Curated tags used only by the deterministic fallback matcher (a curated-keyword hit scores double a bare question-text overlap) and by the escalation-time category classifier's KB lookup; Gemini's primary reply path is grounded on every entry's category/question/answer regardless of keywords. |
| `createdBy` | STRING | nullable | FM identity string (email/name/`FM #<id>`), not a foreign key. |
| `updatedBy` | STRING | nullable | Same, stamped on update. |

Associations: none — `KnowledgeBase` is read by the chat engine (as Gemini context and as the fallback-matcher's candidate pool) and by the FM dashboard, but has no relationship to the other two tables.

Indexes: implicit PK on `id`; `idx_knowledge_base_category`.

## Deletion, retention, and data flow

- **Chat retention (PDPA):** a daily cron job deletes `ChatTranscript` rows where `isEscalated=false` and `createdAt` is more than 90 days old. Escalated transcripts are retained indefinitely (they remain linked to a ticket FM may still need); archiving a ticket does not change this, since the linked transcript's `isEscalated` flag never flips back.
- **Ticket deletion:** `DELETE /api/support/tickets/:id` is a hard delete of both the ticket and its linked transcript together, inside one database transaction — never a partial delete.
- **Ticket archiving:** a soft, fully reversible alternative to deletion (`isArchived` toggle); an archived ticket and its transcript are both retained and remain fully readable in the FM dashboard's Archive view, just excluded from the default active queue and its stats.
- **No image/biometric data:** unlike Module 1, nothing in this module stores images, embeddings, or any biometric data — only text (chat messages, ticket fields, FAQ content).
- **Schema evolution:** these three tables were originally created via Sequelize `sync()` (which creates missing tables but does not alter existing ones); subsequent column/index/constraint changes went through hand-written, idempotent SQL migrations (`server/migrations/20260803_support_ticket_category_status_archive.sql`, `server/migrations/20260803b_support_ticket_transcript_unique.sql`), following the same non-destructive convention (`ADD COLUMN IF NOT EXISTS`, guarded index creation, no drops) already established by the object-detection and edge-idempotency migrations from earlier in the project.
