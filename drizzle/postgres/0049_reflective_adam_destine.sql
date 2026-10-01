-- dashboard_service_links, homepage_items and homepage_layouts moved to the
-- homepage plugin, which adopts them by rename at activation (see
-- plugins/homepage/migrations/postgres/0001_adopt_homepage_tables.sql).
-- Dropping them here would delete every row before the plugin's migration
-- ever runs, since this runs at boot before the plugins table exists.
SELECT 1;
