<!-- SUMMARY -->

Revamped RBAC/sharing, session recording & replay, Vault auth for monitors, API key host enrollment, Proxmox guest auto sync, database refactor, plus 30+ bug fixes across terminal, file manager, RDP/VNC, and auth. DO NOT DOWNGRADE FROM THIS VERSION.

<!-- /SUMMARY -->

<!-- YOUTUBE -->

https://youtu.be/c3UD4q2jW_8

<!-- /YOUTUBE -->

<!-- UPDATE_LOG -->

- Revamped RBAC/sharing system (new UI, all auth types and host protocols now supported)
- Complete admin control over user information (manage all users hosts, credentials, and snippets)
- Support Vault auth for monitors
- API key host enrollment endpoint
- Allow pinned hosts with name sorting
- Session recording and replay
- Terminal font size shortcuts (ctrl + / -)
- Open File Manager to tab right-click menu
- Proxmox guest auto sync
- Complete database refactor
- 30-day donation reminder and new donation milestones that support research: (donate.termix.site)
- Improve site performance with cache and poll pauses
- Save quick connect sessions as hosts
<!-- /UPDATE_LOG -->

<!-- BUG_FIXES -->

- Syntax highlighting artifacts
- Filter dashboard status hosts
- Persist dashboard service link changes
- Snippet text overflow
- Persist remote desktop credential auth
- Guard language switching failures
- Resolve tunnel source credentials
- Windows file delete command
- Artifact release checkout ref
- Command palette escape in fullscreen
- Alerts and audit log normalization
- macOS VNC protocol negotiation
- Port knocking before SSH connect
- Allow escape to close link confirmation
- Prevent Electron modifier wheel zoom
- Credential auth optional password
- Retry transient terminal DNS lookups
- OIDC redirect forwarded port handling
- Preserve recent open tabs on startup
- Terminal font selection
- Poor font legibility in multiple places
- File manager uploads failing
- Tmux detection for non-POSTIX shells
- OPKSSH js-yaml ESM import
- Android Vietnamese IME input
- Firefox RDP clipboard paste
- Proxmox discovery over HTTPS
- External editor actions in file preview
- Firefox desktop OIDC callback
- Status checks through jump hosts
- Restore sudo password auto fill settings
- Preserve file editor position on save
- Sync cloud preference storage mode
- Render RDP sessions at native pixel density
- Restore database import in embedded desktop mode
- Command autocomplete dropdown poor contrast
- Allow clipboard paste in key recording field
- Fix GitHub/google SSO "not defined" errors
<!-- /BUG_FIXES -->
