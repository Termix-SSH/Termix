<!-- SUMMARY -->

Dozens of bug fixes and small new features, including VNC/RDP sharing, OIDC improvements, file manager fixes, SSH jump host fixes, terminal enhancements, RDP keyboard layout support, and much more.

<!-- /SUMMARY -->

<!-- YOUTUBE -->

https://youtu.be/ImwAbm4hW-k

<!-- /YOUTUBE -->

<!-- UPDATE_LOG -->

- VNC, RDP, and Telnet credential sharing support
- Default host settings (SOCKS5, credentials, terminal settings, and more)
- Custom terminal background image per host
- Silent OIDC login configurable as default (no URL parameter required)
- Bulk open SSH sessions for multiple selected hosts at once
- Improved Nord theme contrast and accessibility
- Admin can manually create users while registration is disabled
- OIDC auto-provisioned users supported when registration and password login are disabled
- OIDC username usable as SSH username credential
- Custom labels and drag-to-reorder for sessions in the Connections panel
- Appearance and profile settings persisted to the database across devices
- Saved server URL dropdown in the app connection screen
- File manager text editor font size adjustment
- Tab key shortcut for entering your username in the terminal
- Shift+Tab hotkey support for mobile
- Terminal keyboard shortcuts support
- UTF-8 encoding support in the file manager
- Optional broadcast address for Wake-on-LAN packets
- SFTP legacy mode support
- Snippets JSON import and export with folder metadata
- Clickable links and service shortcuts on the dashboard
- Host status color indicators restored to sidebar
- Per-host configuration to set tab title to shell's window title instead of host name
- Split screen hotkeys
- Support for AZERTY and other non-QWERTY keyboard layouts in RDP
- RDP load balancing info and Connection Broker Cookie support
- Per-connection guacd proxy host and port configuration
- Deep link support for bookmarking direct SSH or file manager sessions
- ACME/Certbot SSL certificate support
- Import hosts from SSH config file
- OIDC with custom CA certificate support
- Open files directly in the file manager text editor
- File manager text editor Ctrl+W capture to prevent accidental tab close
- Option to collapse hosts to a single line in the sidebar
- Select a different backend Termix server from within the app
- Windows portable app now truly portable (no registry writes)
- Bundle fonts for offline environments
- Option to disable clickable links in the terminal
- Proxmox login options including OPKSSH
- UI suggestions and general interface improvements
- Per-protocol host metrics (online/offline detection) configuration
- Increase file manager max upload size by splicing files and reassembling them (~5GB)
<!-- /UPDATE_LOG -->

<!-- BUG_FIXES -->

- File transfers over 100MB failing
- File transfers over 30 seconds aborted by axios timeout
- SSH terminal through jump host chain timing out with malformed SSH messages
- Cloning a host with SSH key auth not allowing auth method change on the clone
- File deletion in the file manager affecting selected files in inactive tabs
- File manager not connecting when cert passphrase is not saved
- File text editor cursor position lost on save
- macOS Option + Left/Right Arrow outputting raw ANSI sequences instead of moving cursor by word
- File manager tree view not sorted alphabetically
- SFTP failing with timeout when using a jump host chain
- SSH key auth with Duo not showing prompt and failing immediately
- Enabling 2FA with password login disabled causing a login deadlock
- Failed to disable 2FA even when providing correct TOTP or password
- Arrow buttons not working in Midnight Commander on the Android app
- Credential deploy command copy failing silently (clipboard API unavailable in some browsers)
- Disabling password login still showing the password login form
- Folder picker in the new host form not showing existing folders
- Command palette always opening hosts as SSH terminal regardless of protocol settings
- Saving SSH credentials failing on fresh installs
- Import hosts failing when hosts use SSH key credentials
- Warpgate authentication prompting for a password unnecessarily
- File manager folder icon not appearing under host name on hover
- File manager delete silently failing on Windows hosts (rm -f not supported by PowerShell)
- SSH terminal failing with keepalive timeout when server MOTD is slow to load
- SSH connection via SOCKS5 proxy failing after update
- Linking an OIDC account to a password account not working
- User password copy missing and RBAC issues in admin panel
- Debian and Android packages not opening the server on launch
- Username field in host edit and new host form having no effect
- Mobile terminal crashing on iOS with React error 130
- Network interface symbols incorrect in host metrics
- Sudo password auto-fill not working on Ubuntu Server 26.04
- get_cwd command injecting into live PTY and corrupting interactive programs
- Initial directory command failing on Windows PowerShell SSH targets
- 3-way split not working with layout issues
- Docker management not working for Windows hosts
- Docker management failing on Debian with exit code 1
- Docker logs not respecting the current theme
- API not responding correctly after update
- Caddy reverse proxy configuration not working
- Wrong keyboard layout in VNC sessions
- KDE scaling issues in the desktop app
- Linux app failing to start due to better-sqlite3 Node version mismatch
- Tab autocomplete not working in the macOS x86 app
- Cloudflare SSL tunnels with third-level subdomains blocking Termix web portal access
- Fzf completion not working in the Android app
- SSH terminal frame delivery jitter in Docker (ssh2 native crypto not compiled)
- OIDC login failing in Linux and Android apps when Authentik has a Captcha stage
- Android app crashing after entering password when auth is set to None
- Editing or saving a host clearing the password for RDP and VNC connections
- Hardcoded 30-minute open-tabs TTL defeating session persistence
- Keyboard mapping issues on Windows Server 2019 via RDP
- Shared server not appearing for other users
- RBAC role assignment failing for OIDC users
- SSO configuration broken when supplied via environment variables
- RDP requiring credentials even when none are needed
- Terminal outputting success right after folder path
- GitHub/Google SSO provider giving ERR_INVALID_URL
- Keyboard focus not on main screen when selecting tmux session
- Remove all references to SALT variable
- Syntax highlighter duplicating path, visual corruptions, cursor jumps, etc.
- RDP session screen clips/spills over on viewport resize
<!-- /BUG_FIXES -->
