-- ssh_data.enable_docker and docker_config moved to the docker plugin's host
-- settings. The copy runs at boot, after this migration, so a real DROP
-- COLUMN here would delete the data first. The columns stay in place,
-- unused, until 3.0.0.
SELECT 1;
