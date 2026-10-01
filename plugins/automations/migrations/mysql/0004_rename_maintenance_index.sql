-- automations 0004: rename_maintenance_index
-- Renames the maintenance index to the idx_ pattern every other index uses.

CREATE UNIQUE INDEX `idx_automation_maintenance_host_owner` ON `p_automations_host_maintenance` (`user_id`, `host_id`);
DROP INDEX `maintenance_host_owner` ON `p_automations_host_maintenance`;
