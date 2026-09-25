-- dashboard_service_links, homepage_items and homepage_layouts moved to the
-- homepage plugin, which adopts them by rename at activation. Dropping them
-- here would delete every row before the plugin's migration runs.
SELECT 1;
