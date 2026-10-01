-- mac_address and wol_broadcast_address move to the wake-on-lan plugin's
-- host settings at boot, after this migration runs. Dropping them here would
-- delete the data before the copy has a chance to run.
SELECT 1;
