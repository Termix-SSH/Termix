-- automations 0002: unlink_channels
-- Hand-written: channels moved from core's notification_channels to the
-- alerts plugin, so the link table drops its foreign key to the old table.
-- The constraint's name differs between installs, so the table is rebuilt.

CREATE TABLE IF NOT EXISTS `p_automations_channels_v2` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `automation_id` int NOT NULL,
  `channel_id` int NOT NULL,
  FOREIGN KEY (`automation_id`) REFERENCES `p_automations_automations` (`id`) ON DELETE CASCADE
);
INSERT INTO `p_automations_channels_v2` (`id`, `automation_id`, `channel_id`) SELECT `id`, `automation_id`, `channel_id` FROM `p_automations_channels`;
DROP TABLE `p_automations_channels`;
RENAME TABLE `p_automations_channels_v2` TO `p_automations_channels`;
CREATE UNIQUE INDEX `idx_automation_channels_pair` ON `p_automations_channels` (`automation_id`, `channel_id`);
