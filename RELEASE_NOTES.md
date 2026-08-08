<!-- SUMMARY -->

Enterprise audit logging with SIEM export, OIDC group-to-RBAC mapping, Tailscale SSH check mode, multi-disk metrics, and bug fixes across sync, jump hosts, RDP/VNC, and auth.

<!-- /SUMMARY -->

<!-- YOUTUBE -->

https://youtu.be/g0QjNdV3YYY

<!-- /YOUTUBE -->

<!-- UPDATE_LOG -->

- Added support for multi disk usage in file manager/host metrics
- Added better Ctrl + F terminal search
- Added right click menu on app rail to pin sidebar faster
- Support for overriding shared SSH credential
- Added mapping for OIDC provider groups to RBAC roles
- Added host export dialog for more customizable host exporting
- Initial groundwork for supporting more database types (postgres and mysql)
- Added audit log export (CSV/NDJSON) and optional live forwarding to a SIEM
- Added configurable audit log retention by age and row count
- Audit entries for file manager, RDP/VNC/Telnet, Docker and tunnel sessions
- Encrypted SSO secrets instead of BASE64 encoding them
- Added support for Tailscale SSH check mode with in-terminal browser authentication
- Added ENABLE_TELEMETRY variable to disable the usage ping before startup

<!-- /UPDATE_LOG -->

<!-- BUG_FIXES -->

- Hardened nginx headers/asset caching
- Deleting an account no longer deletes its audit entries and session recordings
- Made logger display expanded error messages
- Removed phantom port knocking
- Fixed Proxmox guest discovery failures over jump host
- Compare sync cursors independently of timestamp layout
- Fixed sync deleting not reaching other side
- Remote sync stalling after first pass and never propagating deletions
- DB_FILE_ENCRYPTION variable loading DB file as empty
- Removed unneeded field encryption boundaries
- SSH login alerts being dropped silently
- Honor lookupOptions.all in custom DNS lookup hook
- Jump host SOCKS proxy settings being ignored
- Jump host tunnels not reachable by guacd
- Per-host RDP/VNC recording flags being ignored
- RDP sessions not using the configured resolution
- OIDC login failing with unverifiable ID tokens or JWKs without alg
- Refuse to start with an empty database when data exists elsewhere
- Database not persisting during container shutdown
- Host command history setting not saving
- Desktop preference sync and remote sync account identity
- Desktop guacd calls not routed to the connected remote server
- File manager navigation getting stuck after permission errors
- Read-only shared hosts could be dragged into folders
- Terminal highlighting breaking inside split control strings
- Windows terminal Tab key and Android hardware keyboard keys
- tmux monitor failing on Tailscale-authenticated hosts
- Database export not staying same-origin on localhost
- Snippet execution results not reported correctly
- Shared hosts appearing twice
- Wake-on-LAN broadcast address being dropped
- Sharing an empty folder was rejected
- Remote sync losing references between linked records
- Desktop app failing to find its backend on some architectures
- Centralized outbound address validation for homepage proxy requests
- Default font size to medium instead of large
- Tailscale hosts hanging on connect when the tailnet ACL requires a periodic check

<!-- /BUG_FIXES -->
