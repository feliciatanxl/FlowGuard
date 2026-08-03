# Server migrations

Plain, idempotent SQL migrations for the live PostgreSQL database. The project has
no Sequelize-CLI migration framework, so these are hand-run `.sql` files. Every file
is written to be safe to run more than once (`ADD COLUMN IF NOT EXISTS`, no drops).

## Running a migration

From the `server/` directory, using the same credentials as `.env`
(`DB_HOST` / `DB_PORT` / `DB_USER` / `DB_NAME`):

```bash
# PowerShell / Windows (psql from the PostgreSQL install)
$env:PGPASSWORD = "<DB_PWD>"
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" `
    -h localhost -p 5432 -U postgres -d flowguard `
    -f migrations/20260714_sync_object_detection_schema.sql
```

```bash
# bash
PGPASSWORD='<DB_PWD>' psql -h localhost -p 5432 -U postgres -d flowguard \
    -f migrations/20260714_sync_object_detection_schema.sql
```

Each migration wraps its changes in a transaction, so a failure rolls back cleanly
and leaves the database untouched.

## Migrations

| File | What it does |
|------|--------------|
| `20260714_sync_object_detection_schema.sql` | Adds the two Object Detection columns that existed in the Sequelize models but not in the live DB after the group-final merge: `monitoring_zones.detection_type` and `detection_alerts.incident_log_id`. Fixes the 500s on `GET /api/zones` and `GET /api/cameras`. |
| `20260729_edge_idempotency_and_whatsapp.sql` | Adds four `detection_alerts` columns for SecurePi edge idempotency + WhatsApp security-alert tracking: `edge_event_id` (unique when non-null — the retry-safe idempotency key), `whatsapp_status` (default `Not Requested`), `whatsapp_sent_at`, `whatsapp_error`. Guarded unique index avoids duplicating Sequelize's own constraint on a fresh DB. |
| `20260803_support_ticket_category_status_archive.sql` | Adds `support_tickets.category` (default `General`) and `support_tickets."isArchived"` (default `false`); adds `Investigating`/`Closed` to the ticket status enum and backfills existing `In Progress` rows to `Investigating`. Adds supporting indexes on `support_tickets` (`isArchived`+`status`+`createdAt`, `category`, `priority`), `chat_transcripts` (`isEscalated`+`createdAt`), and `knowledge_base` (`category`). |
| `20260803b_support_ticket_transcript_unique.sql` | Adds a UNIQUE index on `support_tickets."transcriptId"` so at most one ticket can ever link to a given transcript, closing a concurrency gap where two near-simultaneous chat requests could each create their own ticket for the same session. NULLs remain unrestricted (many tickets can have no linked transcript). |
| `20260803_add_incident_resolved_at.sql` | Adds `incident_logs."resolvedAt"` (TIMESTAMPTZ, nullable), stamped when an incident's resolutionStatus enters a terminal state (Cleared / False Positive) and cleared on reopen. Backs the Incident Dashboard's Deep Analytics MTTR chart. |
