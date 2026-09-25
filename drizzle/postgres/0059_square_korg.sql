-- dismissed_alerts and notification_channels moved to the alerts plugin. It
-- renames the first into its own namespace and copies the second at
-- activation, both after this migration, so a real DROP TABLE here would
-- delete them first. notification_channels stays in place, unused, until
-- 3.0.0.
SELECT 1;
