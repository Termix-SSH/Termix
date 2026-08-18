<!-- SUMMARY -->

Termix AI, automations, fleets, workspaces, subhosts, Proxmox metrics, a context aware terminal toolbar, split screen tabs, onboarding, PostgreSQL/MySQL support, and a large batch of fixes.

<!-- /SUMMARY -->

<!-- YOUTUBE -->

https://youtu.be/g0QjNdV3YYY

<!-- /YOUTUBE -->

<!-- UPDATE_LOG -->

- Added completely optional and disabled/removed by default Termix AI, an assistant that can work with your hosts and terminals
  - This feature was added based off a 60% (yes) to 40% (no) Discord vote.
  - The assistant cannot change anything on its own. It can only read a limited set of your Termix data and propose actions, and every change or command runs only after you approve it, using your own account and permissions.
  - It has no access to credentials, SSH keys, vaults, users, roles, sessions, SSO, certificates, audit logs, or instance settings. Secrets are also stripped from anything sent to a model provider.
  - Both an admin and each user must turn it on before it does anything, and it stays off after upgrading.
- Added automations with events, channels, and steps
- Added a fleet system with snippets, packages, files, and inventory
- Added workspaces to save and restore your tab layout
- Added subhosts so hosts can be organized under a parent host
- Added Proxmox metrics integration
- Added a context aware terminal toolbar with quick links, host info, image pasting, and a movable desktop layout
- Added interactive terminal macros
- Added first-class split screen tabs
- Added a file manager trash instead of permanent deletes
- Added a local terminal to the desktop app
- Added inheritable connection defaults so hosts can share settings
- Added an onboarding flow with an interface simplicity system
- Added PostgreSQL and MySQL support alongside SQLite
- Added a redesigned host and credential sidebar with synced preferences and drag-to-reorder
- Added the option to open some app rail tabs as their own tab or in a right sidebar
- Added folder select to host multi select
- Added connection logs for RDP, VNC, and Telnet hosts
- Added native RDP launching on Windows desktop
- Added a drive file browser and drag-and-drop upload for RDP
- Added terminal image handoff so images open on your local machine
- Added custom terminal font selection
- Added trusted proxy authentication
- Added global touch input settings
- Added adaptive transfers that pick the fastest route and verify integrity
- Added adaptive polling and preloading that respond to activity and network cost
- Added adaptive SSH local echo for high latency connections
- Added custom disk and network metric options
- Added the ability to exclude specific mounts from disk usage metrics
- Added expanded snippet options
- Added downloadable session logs as text files
- Added keyboard shortcuts to move between open tabs
- Added Discord webhook notification channels
- Added paste support when not running over HTTPS
- Added Headscale API key and custom API endpoint support
- Added a Meta key option for terminals
- Added BE-AZERTY keyboard layout for remote desktop
- Added PKCE to the OIDC login flow
- Added Proxmox VMID and Docker tags to discovered guests
- Added custom SSL certificate support in admin settings
- Greatly improved performance across metrics polling and host management for large setups

<!-- /UPDATE_LOG -->

<!-- BUG_FIXES -->

- Periodic SSH terminal stalls caused by SQLite telemetry writes
- Missing OPKSSH binary breaking installs without internet access
- Session recording writes slowing down terminals
- SGR mouse tracking escape codes printing as text
- Terminal display distortion with special characters
- Windows Ctrl+W not closing the active tab
- Tray Quit not terminating the desktop app
- Mobile terminal scrollback not matching xterm wheel behavior
- tmux breaking on UTF-8 paths
- Sudo password auto-fill not persisting
- SSH and sudo passwords not being saved or auto-filled
- Switching SSH authentication away from Vault failing
- Host edits being discarded without a warning
- Quick-created credentials not being selected
- Saved RDP connection settings not being preserved
- RDP domain credentials not being prompted for
- Windows key mapping in remote desktop sessions
- VNC failing to connect to macOS screen sharing
- Mouse input breaking on touch-capable devices in RDP and VNC
- Docker runtime selection not persisting, plus Docker manager UI issues
- Desktop Docker console WebSocket not being authenticated
- Folders intermittently disappearing from duplicate requests
- Folder deletion not refreshing the host list
- Proxmox guest identity being lost on edit
- Long host names shifting dashboard metrics
- Host list rows resizing unexpectedly
- Metrics collection all firing at once on startup
- Session activity writes hitting the database too often
- Reachable and available hosts being treated the same
- SSH keepalives could not be disabled
- OIDC group claims from multiple sources not being merged
- OIDC discovery issuers with trailing slashes failing
- LDAP logins not using preferred_username
- Trusted MFA devices not being bound to a specific client install
- 2FA could not be disabled with a single credential
- Profile API keys not being shown after creation
- SSH agent authentication being unclear in the host editor
- Tunnel status stream not requiring authentication
- SFTP and Docker console accepting a mismatched host id
- SSH connections whose host id resolved elsewhere being accepted
- User-managed CA certificates not being applied over SFTP
- Already-shared hosts losing their SSH authentication
- Real client IP not being captured for SSH login alerts behind a reverse proxy
- Audit log IPs not using the real client IP
- Homepage System Overview update indicator never firing
- Webhook notification channels not working
- Remote sync failing behind an nginx proxy
- First server sync not refreshing the UI
- Desktop app not showing update prompts and hiding the version badge
- Desktop Tailscale configuration being lost
- Command palette not loading new activity, plus Enter now opens the first result
- Database connection failures during login not being reported clearly
- audit_logs.user_id not being nullable on fresh SQLite installs
- Sync upserts writing to the wrong row
- Database migration failures on tables without an id column
- ssh_credentials rebuilds not matching the live schema
- Sidebar reset and fullscreen buttons sharing the same icon
- Host list icons not matching the tab bar icons
- Keep Linux credential storage working on unrecognised desktops

<!-- /BUG_FIXES -->
