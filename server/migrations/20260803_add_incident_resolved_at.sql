-- 20260803_add_incident_resolved_at.sql
--
-- Purpose
--   Adds incident_logs."resolvedAt" (TIMESTAMPTZ, nullable) backing the new
--   Mean-Time-To-Resolve analytics on the Incident Dashboard's Deep Analytics
--   subpage. Stamped by PATCH /api/incident/:id when resolutionStatus
--   transitions into a terminal state (Cleared / False Positive), and cleared
--   back to NULL if the incident is later reopened to a non-terminal status
--   (Active / Investigating / Escalated to Security) — see
--   server/routes/incident.js.
--
-- Safety
--   * Idempotent: ADD COLUMN IF NOT EXISTS.
--   * Non-destructive, no backfill: existing already-Cleared incidents get
--     resolvedAt = NULL and are simply excluded from MTTR until a new
--     terminal transition happens post-deploy. (updatedAt is NOT used as a
--     backfill proxy — it is touched by unrelated edits like notes changes
--     after resolution, so it would misreport resolution time.)
--   * Does NOT depend on DB_SYNC_ALTER=true (server/index.js's
--     db[name].sync({ alter: alterSchema }) only CREATEs missing tables with
--     alterSchema defaulting false, never ALTERs existing ones).

BEGIN;

ALTER TABLE incident_logs
    ADD COLUMN IF NOT EXISTS "resolvedAt" TIMESTAMPTZ;

COMMIT;
