-- 20260803b_support_ticket_transcript_unique.sql
--
-- Purpose
--   Close a concurrency gap in Module 3's auto-escalation: two near-simultaneous
--   chat requests for the same session could both read isEscalated=false before
--   either write committed, each creating its own SupportTicket for the same
--   transcript. The application now wraps ticket-create + transcript-update in
--   one transaction (see server/services/supportService.js), but that alone
--   only prevents the race going forward — it doesn't stop it at the database
--   level for any other code path. This adds a UNIQUE constraint on
--   support_tickets."transcriptId" so at most one ticket can ever reference a
--   given transcript, matching the model's `hasOne`/`belongsTo` association
--   (see server/models/ChatTranscript.js, server/models/SupportTicket.js).
--
--   Postgres unique constraints treat NULL as distinct from every other NULL,
--   so tickets with no linked transcript (transcriptId IS NULL) are unaffected
--   and can still coexist without limit.
--
-- Safety
--   * Idempotent: only created if no unique index already covers the column.
--   * Non-destructive: no DROP, no data changes.
--   * CAVEAT: if the live table already contains more than one ticket for the
--     same non-null transcriptId (only possible if the race above already
--     happened before this migration), CREATE UNIQUE INDEX will fail with a
--     duplicate-key error. Find and resolve any such rows first:
--       SELECT "transcriptId", COUNT(*) FROM support_tickets
--       WHERE "transcriptId" IS NOT NULL GROUP BY "transcriptId" HAVING COUNT(*) > 1;

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'support_tickets'
          AND indexname = 'support_tickets_transcript_id_unique'
    ) THEN
        CREATE UNIQUE INDEX support_tickets_transcript_id_unique
            ON support_tickets ("transcriptId");
    END IF;
END $$;

COMMIT;
