-- 20260729_edge_idempotency_and_whatsapp.sql
--
-- Purpose
--   Support idempotent SecurePi edge ingestion and WhatsApp security-alert
--   notification tracking on detection_alerts. SecurePi retries an event when
--   Wi-Fi drops, so the backend must de-duplicate on a stable per-occurrence id
--   and record whether the security WhatsApp was sent, so a retry never creates a
--   second DetectionAlert / IncidentLog and never re-sends the same alert.
--
--   Adds four DetectionAlert columns (see server/models/DetectionAlert.js):
--     detection_alerts.edge_event_id    VARCHAR(255)  UNIQUE when non-null
--         Stable id for one edge detection occurrence. Browser/AI-engine alerts
--         leave it NULL; Postgres treats NULLs as distinct so many NULL rows
--         coexist while a repeated edge event_id is rejected by the unique index.
--     detection_alerts.whatsapp_status  VARCHAR(20)  NOT NULL DEFAULT 'Not Requested'
--         Not Requested | Pending | Sent | Failed | Skipped | Simulated
--     detection_alerts.whatsapp_sent_at TIMESTAMPTZ  (nullable)
--     detection_alerts.whatsapp_error   TEXT         (nullable)
--
-- Safety
--   * Idempotent: ADD COLUMN IF NOT EXISTS, and the unique index is created only
--     if no unique index already covers edge_event_id (guarded DO block), so a
--     fresh DB whose table Sequelize already created with the UNIQUE constraint is
--     not given a duplicate index, and re-running is a no-op.
--   * Non-destructive: no DROP, no TRUNCATE, no DELETE, no table recreation.
--   * Existing rows are preserved. edge_event_id/whatsapp_sent_at/whatsapp_error
--     are NULLable; whatsapp_status backfills existing rows with 'Not Requested'.
--   * Does NOT depend on DB_SYNC_ALTER=true.

BEGIN;

-- Idempotency key for edge-device ingestion (nullable; unique when non-null).
ALTER TABLE detection_alerts
    ADD COLUMN IF NOT EXISTS edge_event_id VARCHAR(255);

-- WhatsApp security-alert notification tracking.
ALTER TABLE detection_alerts
    ADD COLUMN IF NOT EXISTS whatsapp_status VARCHAR(20) NOT NULL DEFAULT 'Not Requested';
ALTER TABLE detection_alerts
    ADD COLUMN IF NOT EXISTS whatsapp_sent_at TIMESTAMPTZ;
ALTER TABLE detection_alerts
    ADD COLUMN IF NOT EXISTS whatsapp_error TEXT;

-- Unique index on edge_event_id, created only if no unique index already covers
-- the column (handles both the migrated-existing-DB path and a fresh DB where
-- Sequelize's sync already added its own UNIQUE constraint).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_index i
        JOIN pg_class c   ON c.oid = i.indrelid
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY (i.indkey)
        WHERE c.relname = 'detection_alerts'
          AND a.attname = 'edge_event_id'
          AND i.indisunique
    ) THEN
        CREATE UNIQUE INDEX detection_alerts_edge_event_id_uidx
            ON detection_alerts (edge_event_id);
    END IF;
END $$;

COMMIT;
