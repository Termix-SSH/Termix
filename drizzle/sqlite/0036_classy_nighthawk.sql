-- tmux_session_tags moved to the tmux-monitor plugin, whose first migration
-- renames it to p_tmux_monitor_session_tags. Dropping it here would lose
-- every saved tag, so this only stops drizzle tracking it. SELECT 1 because
-- MySQL rejects an empty query.
SELECT 1;
