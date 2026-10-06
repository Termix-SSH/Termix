<!-- SUMMARY -->

An urgent patch for 2.9.1 that fixes the server writing huge amounts of data to disk, which could add up to 100 GB every few hours. Update as soon as you can.

<!-- /SUMMARY -->

<!-- YOUTUBE -->

https://youtu.be/lngaePO96tM

<!-- /YOUTUBE -->

<!-- UPDATE_LOG -->

- Background database saves now happen at most once every 30 seconds, so disk writes no longer grow with the number of hosts
- Plugin database and storage reads are now logged to the audit log once per start instead of on every read
- On first start, 2.9.2 clears the plugin read entries that 2.9.1 piled up in the audit log

<!-- /UPDATE_LOG -->

<!-- BUG_FIXES -->

- The server rewriting its whole database to disk many times a second, causing very high disk writes (up to 100 GB every few hours) on 2.9.1
- The audit log filling up with plugin entries and pushing out real ones

<!-- /BUG_FIXES -->
