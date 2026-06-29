<!-- SUMMARY -->

Major new features including serial connections, Tailscale/WireGuard support, HashiCorp Vault SSH auth, Bitwarden SSH agent, WebAuthn passkeys, Podman support, a new grid-based dashboard, host metrics history with alerting, and much more.

<!-- /SUMMARY -->

<!-- YOUTUBE -->

https://youtu.be/c3UD4q2jW_8

<!-- /YOUTUBE -->

<!-- UPDATE_LOG -->

- Termix ID with a public handle, hosted public key resolver, and built-in CA for issuing SSH certificates
- Serial connections support
- Tailscale and WireGuard VPN host integration with status detection
- HashiCorp Vault SSH signer authentication
- Bitwarden SSH agent integration
- WebAuthn passkey authentication
- Podman container runtime support alongside Docker
- SSH agent forwarding support across all SSH features
- New grid and widget-based dashboard homepage
- Grafana-style server stats history graphs
- Alert system with ntfy and webhook notification support
- Host temperature metrics card
- App fullscreen mode
- External editor support for file manager (desktop app)
- Safe host sharing export
- SSH credential password fallback for key-based auth
- Open all sessions in a folder at once
- Custom terminal theme color support
- Custom tunnel endpoints configuration
- GUACD_URL environment variable support
- App rail hover expansion setting
- Terminal font zoom with mouse wheel
- File manager terminals promoted to full tabs
- Donate button on dashboard
- PuTTY PPK SSH key support
- Confirmation dialog when closing active host connections
- Confirmation prompt before opening large files in the editor
- Cross-host file manager clipboard
- Prioritize host results in command palette search
- Retry autostart tunnel host fetches on failure
<!-- /UPDATE_LOG -->

<!-- BUG_FIXES -->

- SSH port connection bug
- VNC required argument handshake failure
- Jump host SOCKS5 proxy selection using wrong proxy
- Tunnel endpoint resolution failing in some configurations
- Direct tunnel skipping endpoint credential validation incorrectly
- Dashboard host routing ignoring protocol settings
- Dashboard service link creation broken
- File manager uploads failing with 400 error and missing schema migrations on upgrade
- Large file manager uploads not chunked (chunked for files >=1.5GB)
- File uploads over 100MB failing due to ArrayBuffer browser limit
- File path case not preserved in file manager UI
- File downloads unreliable in the desktop app
- Tmux detection path handling incorrect
- Host metrics startup polling incorrect
- TUI terminal output highlighting incorrect
- Runtime base path for auth callbacks incorrect
- Windows app icon unstable
- SSH heading syntax highlighting broken
- Terminal link dialog layering issue
- Electron OIDC browser authentication failures
- Proxmox import auth fallback not working
- OIDC role credential shares not synced for OIDC users
- RDP connections requiring credentials when none are needed
- VNC authentication settings not persisted
- Guacamole unicode token corruption
- Guacamole websocket base path incorrect
- Guacamole disconnect during startup crash
- Host metrics starting for non-SSH hosts
- Sidebar host hover causing layout shift
- Alert UI incorrectly applying Termix CSS and alert system failing to load
- Translation key incorrect for nav close action
- PUID HTML ownership in Docker entrypoint
<!-- /BUG_FIXES -->
