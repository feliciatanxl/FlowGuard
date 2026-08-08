-- 20260807_detection_alert_sensor_metadata.sql
--
-- Persist safe SecurePi PIR/ultrasonic metadata on detection alerts so the
-- Security Camera panel can render it after edge ingest.

BEGIN;

ALTER TABLE detection_alerts
    ADD COLUMN IF NOT EXISTS sensor_metadata JSONB;

COMMIT;
