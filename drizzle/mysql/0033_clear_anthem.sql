-- snippets, snippet_folders and snippet_access moved to the snippets plugin
-- (p_snippets_*), adopted by rename rather than dropped. A real DROP TABLE
-- here would run before the plugin's adoption migration and delete every row.
SELECT 1;
