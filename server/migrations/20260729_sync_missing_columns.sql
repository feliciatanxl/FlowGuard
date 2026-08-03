-- 20260729_sync_missing_columns.sql
--
-- Purpose
--   Bring a local PostgreSQL schema back in line with the current Sequelize
--   models after pulling the latest default-branch changes. Diagnosed by
--   comparing every model's rawAttributes against information_schema.columns
--   on this machine: normal server startup only CREATEs missing tables
--   (see server/index.js's db[name].sync({ alter: alterSchema }) with
--   alterSchema defaulting to false), so columns added to EXISTING tables
--   across several past feature merges were never applied here.
--
--   detection_alerts.alert_type        -> DetectionAlert.alert_type (STRING(100))
--   detection_alerts.severity          -> DetectionAlert.severity (ENUM Low/Medium/High/Critical)
--   detection_alerts.source            -> DetectionAlert.source (STRING(100))
--   detection_alerts.confidence        -> DetectionAlert.confidence (FLOAT)
--   detection_alerts.snapshot_url      -> DetectionAlert.snapshot_url (STRING(500))
--   detection_alerts.device_id         -> DetectionAlert.device_id (STRING(100))
--   detection_alerts.occurred_at       -> DetectionAlert.occurred_at (DATE)
--   detection_alerts.incident_log_id   -> DetectionAlert.incident_log_id (INTEGER)
--       Re-stated idempotently: also covered by 20260714_sync_object_detection_schema.sql,
--       which appears to not have been run on this machine either.
--   monitoring_zones.detection_type    -> MonitoringZone.detection_type (STRING(30))
--       Re-stated idempotently, same reason as above.
--   security_logs.matchedUserId        -> SecurityLog.matchedUserId (INTEGER)
--   security_logs.confidence           -> SecurityLog.confidence (FLOAT)
--   security_logs.cameraLocation       -> SecurityLog.cameraLocation (STRING/VARCHAR(255))
--   users.tokenVersion                 -> User.tokenVersion (INTEGER, default 0)
--   users.passwordResetTokenHash       -> User.passwordResetTokenHash (STRING(64))
--   users.passwordResetExpiresAt       -> User.passwordResetExpiresAt (DATE)
--
-- Safety
--   * Idempotent: every statement uses ADD COLUMN IF NOT EXISTS, so re-running is a
--     no-op and columns that already exist are left exactly as they are.
--   * Non-destructive: no DROP, no TRUNCATE, no DELETE, no table recreation.
--   * Existing rows are preserved. All new columns are either NULLable or have a
--     default matching the Sequelize model, so no existing row needs manual backfill.
--   * The enum_detection_alerts_severity type already existed in this database
--     (left over from an earlier partial sync) and is reused as-is; its labels
--     (Low, Medium, High, Critical) already match the DetectionAlert model.
--   * Does NOT depend on DB_SYNC_ALTER=true.

BEGIN;

-- detection_alerts ---------------------------------------------------------
ALTER TABLE detection_alerts
    ADD COLUMN IF NOT EXISTS alert_type VARCHAR(100);

ALTER TABLE detection_alerts
    ADD COLUMN IF NOT EXISTS severity enum_detection_alerts_severity NOT NULL DEFAULT 'High';

ALTER TABLE detection_alerts
    ADD COLUMN IF NOT EXISTS source VARCHAR(100) NOT NULL DEFAULT 'Object Detection';

ALTER TABLE detection_alerts
    ADD COLUMN IF NOT EXISTS confidence DOUBLE PRECISION;

ALTER TABLE detection_alerts
    ADD COLUMN IF NOT EXISTS snapshot_url VARCHAR(500);

ALTER TABLE detection_alerts
    ADD COLUMN IF NOT EXISTS device_id VARCHAR(100);

ALTER TABLE detection_alerts
    ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ;

ALTER TABLE detection_alerts
    ADD COLUMN IF NOT EXISTS incident_log_id INTEGER;

-- monitoring_zones -----------------------------------------------------------
ALTER TABLE monitoring_zones
    ADD COLUMN IF NOT EXISTS detection_type VARCHAR(30);

-- security_logs ---------------------------------------------------------------
ALTER TABLE security_logs
    ADD COLUMN IF NOT EXISTS "matchedUserId" INTEGER;

ALTER TABLE security_logs
    ADD COLUMN IF NOT EXISTS confidence DOUBLE PRECISION;

ALTER TABLE security_logs
    ADD COLUMN IF NOT EXISTS "cameraLocation" VARCHAR(255);

-- users -------------------------------------------------------------------------
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS "passwordResetTokenHash" VARCHAR(64);

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS "passwordResetExpiresAt" TIMESTAMPTZ;

COMMIT;
