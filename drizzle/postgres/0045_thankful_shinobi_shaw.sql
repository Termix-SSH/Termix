-- ssh_data.stats_config split: its status half moved to status_check_enabled
-- and status_check_interval, its metrics half to the host-metrics plugin's
-- host settings. Both copies run at boot, after this migration, so a real
-- DROP COLUMN here would delete the data first. The column stays in place,
-- unused, until 3.0.0.
SELECT 1;
