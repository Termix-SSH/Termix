-- The remote desktop host options (enable_rdp, enable_vnc, enable_telnet,
-- the three ports, rdp_security, rdp_ignore_cert, security, ignore_cert,
-- guacamole_config) and user_preferences.rdp_defaults moved to the
-- remote-desktop plugin's settings. The copy runs after plugins load, which
-- is after this migration, so a real DROP COLUMN here would delete the data
-- first. The columns stay in place, unused, until 3.0.0.
SELECT 1;
