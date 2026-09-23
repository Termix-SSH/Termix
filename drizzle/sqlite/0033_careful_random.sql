-- file_manager_pinned, file_manager_recent, file_manager_shortcuts and
-- transfer_recent are adopted (renamed, not dropped) by the file-manager
-- plugin's own migration, which runs at plugin activation, after core's
-- drizzle migrations. A DROP TABLE here would run first and delete the data.
SELECT 1;
