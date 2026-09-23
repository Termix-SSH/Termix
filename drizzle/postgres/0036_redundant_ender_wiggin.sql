-- proxmox_node_history and proxmox_stats_preferences moved to the proxmox
-- plugin (p_proxmox_*), adopted by rename rather than dropped. A real DROP
-- TABLE here would run before the plugin's adoption migration and delete
-- every row.
ALTER TABLE "ssh_data" DROP COLUMN "enable_proxmox";--> statement-breakpoint
ALTER TABLE "ssh_data" DROP COLUMN "proxmox_config";--> statement-breakpoint
ALTER TABLE "ssh_data" DROP COLUMN "enable_proxmox_stats";--> statement-breakpoint
ALTER TABLE "ssh_data" DROP COLUMN "proxmox_stats_config";