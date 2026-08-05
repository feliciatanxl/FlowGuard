-- 20260803_support_ticket_category_status_archive.sql
--
-- Purpose
--   Module 3 (AI Helpdesk & Facility Support) schema evolution to match the
--   full ticket lifecycle: ticket categorisation, an Investigating/Closed
--   status lifecycle, and a reversible archive path distinct from hard delete.
--   Also adds the indexes the ticket dashboard's default query and the 90-day
--   transcript-retention cron actually filter/sort on.
--
--   Adds to support_tickets (see server/models/SupportTicket.js):
--     category     VARCHAR(100)  NOT NULL DEFAULT 'General'
--     "isArchived" BOOLEAN       NOT NULL DEFAULT false
--     status ENUM gains 'Investigating' and 'Closed'. Existing 'In Progress'
--     rows are backfilled to 'Investigating'. Postgres cannot drop an enum
--     label in place, so 'In Progress' remains a harmless, unused value at
--     the database level — application code never emits or accepts it again
--     once this ships.
--
-- Safety
--   * Idempotent: ADD COLUMN IF NOT EXISTS, guarded ADD VALUE, guarded indexes.
--   * Non-destructive: no DROP, no TRUNCATE, no table recreation.
--   * Two transactions: ALTER TYPE ... ADD VALUE must commit before the value
--     can be used in the UPDATE below, so Part 1 and Part 2 cannot share a
--     transaction block.
--   * Touches only chat_transcripts / support_tickets / knowledge_base — no
--     other module's tables are affected.

-- ── Part 1: new enum values (commits before use) ────────────────────────────
BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumlabel = 'Investigating'
          AND enumtypid = 'enum_support_tickets_status'::regtype
    ) THEN
        ALTER TYPE enum_support_tickets_status ADD VALUE 'Investigating' AFTER 'Pending';
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumlabel = 'Closed'
          AND enumtypid = 'enum_support_tickets_status'::regtype
    ) THEN
        ALTER TYPE enum_support_tickets_status ADD VALUE 'Closed' AFTER 'Resolved';
    END IF;
END $$;

COMMIT;

-- ── Part 2: columns, backfill, indexes ──────────────────────────────────────
BEGIN;

ALTER TABLE support_tickets
    ADD COLUMN IF NOT EXISTS category VARCHAR(100) NOT NULL DEFAULT 'General';

ALTER TABLE support_tickets
    ADD COLUMN IF NOT EXISTS "isArchived" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: the retired 'In Progress' status becomes 'Investigating'.
UPDATE support_tickets SET status = 'Investigating' WHERE status = 'In Progress';

-- Dashboard's default query filters isArchived + status, sorts priority/createdAt.
CREATE INDEX IF NOT EXISTS idx_support_tickets_archived_status_created
    ON support_tickets ("isArchived", status, "createdAt" DESC);

CREATE INDEX IF NOT EXISTS idx_support_tickets_category
    ON support_tickets (category);

CREATE INDEX IF NOT EXISTS idx_support_tickets_priority
    ON support_tickets (priority);

-- Cron job's WHERE isEscalated = false AND createdAt < cutoff.
CREATE INDEX IF NOT EXISTS idx_chat_transcripts_escalated_created
    ON chat_transcripts ("isEscalated", "createdAt");

-- Dashboard KB tab filters/groups by category.
CREATE INDEX IF NOT EXISTS idx_knowledge_base_category
    ON knowledge_base (category);

COMMIT;
