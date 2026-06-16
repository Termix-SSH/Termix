<!-- SUMMARY -->

Bug fixes and new features, including Proxmox integration, SSO/OIDC redesign, revamped host metrics, tmux session management, and numerous UI and stability improvements.

<!-- /SUMMARY -->

<!-- YOUTUBE -->

https://youtu.be/ImwAbm4hW-k

<!-- /YOUTUBE -->

<!-- UPDATE_LOG -->

- Improved terminal syntax highlighting with more customizability and reliability (toggle setting moved from user profile to host editor)
- Tmux session monitor/management
- Tailscale SSH authentication and device listing support
- SSO/OIDC redesign (multiple OIDC providers, LDAP, Google, GitHub support)
- Terminal session logging
- Customize side rail tab visibility
- Admin audit log
- Added `x.x.x` version tag alongside `release-x.x.x` for Docker
- OIDC custom group claim support
- Renamed server stats to host metrics
- Fully revamped host metrics page with new cards and dashboard like organizing system (services, process inspector, log viewer, cron jobs, packages, ssl cert management, firewall, user/permissions, health checks, disk breakdown, timers, and top by memory)
- Proxmox guest discovery and import integration
- Moved ssh host config outside of top tab bar and into new tab bar visible on SSH tab
- Improved folder management (nested folders, folder icons, folder colors, better folder selection, etc.)
- Storage preference to user profile settings (store/load toggles locally or in the DB)
- Sort/filter functions to credential list (copy of host list)
<!-- /UPDATE_LOG -->

<!-- BUG_FIXES -->

- SFTP jump-host fallback from host data
- Guacd password incorrectly passed for app view
- Admin page failing to load admin information
- Disabled hardware acceleration on Windows to prevent startup crash
- Dashboard total credentials stuck at 0
- Host username ignored when credential attached
- Clone host cannot switch auth method
- File manager context menu off-screen
- File delete affecting inactive tabs
- Silent delete failure on Windows hosts
- iPad host tab does nothing
- Docker console terminal background using incorrect colors
- Reliable OIDC group syncing for admin roles
- Guacd connections using incorrect screen height
- 2FA failing to disable
- Hostname fill entire column and truncate at proper spot in dashboard
- Make credentials start collapsed
- Incorrect JSDoc comments
<!-- /BUG_FIXES -->
