-- c2s_tunnel_presets moved to the tunnels plugin, whose first migration renames
-- it to p_tunnels_presets. Dropping it here would lose every saved preset, so
-- this only stops drizzle tracking it. SELECT 1 because MySQL rejects an
-- empty query.
SELECT 1;
