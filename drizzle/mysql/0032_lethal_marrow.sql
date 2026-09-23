-- network_topology moved to the network-topology plugin, which adopts (renames)
-- this table in its own migration before this drizzle migration would run.
-- No DROP here: it would delete every row before the plugin's rename applies.
SELECT 1;
