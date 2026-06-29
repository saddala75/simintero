-- infra/scripts/cleanup-tables.sql
-- Periodic data retention and cleanup for high-volume platform tables.

-- 1. Remove processed deduplication events older than 90 days
DELETE FROM shared.processed_events
WHERE processed_at < now() - interval '90 days';

-- 2. Remove transient consumer failures older than 30 days
DELETE FROM shared.consumer_failures
WHERE last_attempted_at < now() - interval '30 days';

-- 3. Archive and purge DLQ entries older than 180 days
INSERT INTO shared.consumer_dlq_archive (event_id, consumer_group, topic, payload, error, failed_at, replayed_at, archived_at)
SELECT event_id, consumer_group, topic, payload, error, failed_at, replayed_at, now() AS archived_at
FROM shared.consumer_dlq
WHERE failed_at < now() - interval '180 days';

DELETE FROM shared.consumer_dlq
WHERE failed_at < now() - interval '180 days';
