-- command_history moved to the ssh-terminal plugin, whose first migration
-- renames it to p_ssh_terminal_command_history. Dropping it here would lose
-- every saved command, so this only stops drizzle tracking it. SELECT 1
-- because MySQL rejects an empty query.
SELECT 1;
