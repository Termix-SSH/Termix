<!-- SUMMARY -->

A side-by-side local and remote file manager for desktop, a new tab for transferring files straight between two servers, collaboration rooms, Step CA and 1Password credential support, per-host Web Endpoints, credential sharing with users and roles, and a large batch of connection, sync, and remote desktop fixes.

<!-- /SUMMARY -->

<!-- YOUTUBE -->

https://youtu.be/lngaePO96tM

<!-- /YOUTUBE -->

<!-- UPDATE_LOG -->

- Added a side-by-side local and remote view to the desktop file manager
- Added a dedicated tab for transferring files directly between two servers
- Added a dedicated Port Forwarding tab to the desktop app sidebar
- Added inline autosuggestions in the terminal using command history
- Added collaboration rooms for sharing a terminal or remote desktop session with a group
- Added Step CA as an SSH authentication type
- Added 1Password Connect as a credential source for SSH
- Added the ability to share credentials with specific users and roles
- Added automatic sharing for hosts added to an already-shared folder
- Added per-host Web Endpoints
- Added quick connect for RDP and VNC
- Added a button to pin the sidebar rail open instead of it auto-collapsing
- Added a compact snippet list option
- Added copy/paste support to the local terminal
- Added a terminal copy-on-select option
- Added tab switching and command palette actions to custom keybindings
- Added selectable host temperature sensors
- Added accessible interface font choices
- Added VNC display zoom controls
- Added more actions to the host right-click context menu
- Added white label branding for admins
- Added support for additional TOTP authenticator apps
- Added the ability to open RDP, VNC, and Telnet sessions directly from the desktop app
- Improved file manager navigation
- Improved motion and transition animations throughout the app
- Improved macOS packaging and terminal keyboard shortcuts
- Improved the terminal AI assistant with a toggle for terminal context
- Began plugin backend work (cut cross feature imports, added plugin DB tables, made the rail/tab system use registries, and updated nginx and manifests for plugins)

<!-- /UPDATE_LOG -->

<!-- BUG_FIXES -->

- Private AI custom endpoints failing to connect
- Proxmox credential guest imports not working correctly
- Fleet command results layout being broken
- Synced client tunnel endpoints not matching the source host
- Proxmox jump host settings not persisting after a sync
- Command palette keyboard navigation not working correctly
- Split layout selection not being restored
- macOS VNC connections failing to establish
- Rapid VNC scroll wheel input queuing up and making the remote desktop keep scrolling after you stop
- Remote desktop connections timing out unexpectedly
- RDP clipboard paste not working across some browsers
- Process inspector command column showing truncated commands
- RDP drive redirection uploads failing on the default deployment
- A terminal session that expired silently reconnected without explaining Auto-Tmux as an option
- Host status wrongly showing as offline when nothing was actively watching it
- Shared RDP users not being prompted for credentials when required
- Protected file reads failing without a sudo retry
- Host status polling unnecessarily authenticating over SSH
- Some host protocol settings being dropped when left unset
- Remote sync reauthentication failures not being surfaced to the user
- Dashboard metrics sessions not recovering after expiring
- RDP file uploads to redirected drives failing
- Connection toolbar visibility being inconsistent
- Host list scroll position resetting incorrectly after editing a host
- Live SSH sessions not being reflected in host status
- Vault authentication not working in the file manager
- Running snippets and commands on shared hosts being blocked
- Chunked file uploads failing due to a contract mismatch
- Bulk uploads failing partway through
- Local echo not being disabled on the terminal alternate screen
- Invalid timezones in the clock widget crashing the homepage
- Connection origin setting not being preserved when editing a host
- Local login notifications not appearing after a remote sync
- Passkey login not working in the desktop app
- Proxmox guest discovery commands failing without elevated permissions
- File transfer completion toasts staying on screen permanently
- SSH key type not being clearable once set
- Local echo appearing during password prompts inside other programs
- The desktop app hanging on a loading screen with no message when the embedded backend's port was in use
- Backend ports silently failing to bind, leaving a feature dead with no error in the logs
- Imported host settings and jump host references being lost or broken after import
- SSH agent forwarding breaking after certain unsupported extensions
- Sidebar host tree continuing to render while hidden, wasting resources
- macOS Alt+digit tab shortcuts producing characters instead of switching tabs
- macOS Option key producing Meta/escape sequences instead of special characters by default
- Dashboard not opening the correct remote desktop protocol
- Version checks overwriting the local version number on failure
- SFTP directory creation relying on shell access
- GPU acceleration opt-out setting being ignored on desktop
- Remote-only hosts leaking into local tab persistence on desktop
- Host metrics not being collected correctly on macOS and Windows hosts
- CORS rejecting requests by default when no allowed origins were configured
- Streamed SFTP uploads not completing correctly
- The SSH connection pool not enforcing its connection limits, letting stale connections pile up
- Local connections to shared hosts being blocked
- Client-to-server tunnels using the wrong bind or target address in some setups
- SSH host key changes not being surfaced as a warning
- Nested subhost parent references breaking after a remote sync
- Termix ID certificates missing principals needed for some servers to accept them
- TOTP being skipped without a fully verified WebAuthn check
- SSH connections not verifying the resolved server's host identity
- The OPKSSH binary not having its integrity verified before use
- Several transitive dependency security advisories
- Various HTTP and application trust boundary hardening (CSP, Docker, config defaults)

<!-- /BUG_FIXES -->
