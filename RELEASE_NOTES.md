<!-- SUMMARY -->

A patch for 2.9.0 that fixes OIDC sign-in after upgrading, Docker and Host Metrics logins, memory and CPU use, file downloads, tmux sessions, user data export and more. Also adds predefined host tags.

<!-- /SUMMARY -->

<!-- YOUTUBE -->

https://youtu.be/lngaePO96tM

<!-- /YOUTUBE -->

<!-- UPDATE_LOG -->

- Added predefined host tags that admins can set, with suggestions in the host editor
- Kept compact host row actions on the same line as the host name
- Added a reload button when a sign-in verification method fails to load
- Admins can now merge a duplicate SSO account made by 2.9.0 back into the original account
- Hosts behind the same jump hosts now share one connection for status checks
- Simplified host status to just online or offline, removing the "last login failed" state
- Host status now updates every 15 seconds without a page refresh, and status checks run every 30 seconds by default
- Completed the Simplified Chinese translation
- Documented cookie and API key sign-in in the API docs

<!-- /UPDATE_LOG -->

<!-- BUG_FIXES -->

- OIDC accounts from 2.8 not being able to sign in, or getting a new empty account, after upgrading
- Downloading a file in the file manager turning the whole screen black
- tmux sessions not resuming and new sessions being created instead
- Connections through two or more jump hosts failing
- Docker and Host Metrics failing to sign in while the terminal worked
- Fleets, Proxmox and automations not getting the host sudo password
- Server running out of memory on start and when importing hosts
- High CPU use after the app was first opened
- User data export freezing the server
- 1Password and other secret references being rejected as SSH keys
- Slow file deletes in the file manager
- Mac App Store app failing to start its local server
- Snippets failing to sync on older databases
- GitHub sign in failing
- RDP showing scrollbars and jittering near the edges
- Status checks triggering Fail2Ban bans while a session was open
- Too many database writes from session activity
- Host editor tabs being hidden when they did not fit
- SSH host keys being accepted without a check when the host was missing from the database
- Host status only updating after a full page refresh
- Every host showing offline right after signing in
- Host status flipping between online and offline on refresh or after one dropped packet
- Hosts showing "last login failed" when they connected fine
- Hosts behind a jump host staying offline after the jump connection dropped
- Host status being wiped in the desktop app when the host list failed to load
- Tunnels, remote desktop logins and other host settings missing from shared hosts in the desktop app
- SSO and LDAP provider dialogs overflowing the screen and using mismatched toggles
- Plugin audit log entries failing to save when no user was signed in

<!-- /BUG_FIXES -->
