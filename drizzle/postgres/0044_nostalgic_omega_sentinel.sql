-- host_metrics_preferences, host_health_checks, host_health_history and
-- host_metrics_history moved to the host-metrics plugin, which adopts them by
-- rename in its own first migration. That runs after this one, so a real
-- DROP TABLE here would delete every row first.
SELECT 1;--> statement-breakpoint
-- Status checks are core: the per-host switch and interval, copied out of
-- stats_config at boot by host-status-config-migration.ts.
ALTER TABLE "ssh_data" ADD COLUMN "status_check_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "ssh_data" ADD COLUMN "status_check_interval" integer;