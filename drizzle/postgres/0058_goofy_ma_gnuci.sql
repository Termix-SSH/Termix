-- The file manager, tunnels, web endpoint, terminal, tmux monitor, session
-- sharing and session recording host columns, and the dead show_*_in_sidebar
-- columns, moved to their plugins' host settings. The copies run after
-- plugins load, which is after this migration, so a real DROP COLUMN here
-- would delete the data first. The columns stay in place, unused, until 3.0.0.
SELECT 1;
