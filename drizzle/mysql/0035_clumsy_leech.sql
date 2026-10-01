-- proxmox_node_history and proxmox_stats_preferences moved to the proxmox
-- plugin (p_proxmox_*), adopted by rename rather than dropped. The four
-- ssh_data proxmox columns are copied into the plugin's host settings after
-- plugins load, which is after this migration, so a real DROP COLUMN here
-- would delete the data first. The columns stay in place, unused, until 3.0.0.
SELECT 1;
