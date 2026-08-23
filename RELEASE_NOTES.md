<!-- SUMMARY -->

Credential cloning, a WSL local terminal, Helm and GitOps deployment, an editable file manager path bar, download progress bars, and a large batch of connection, sync, and remote desktop fixes.

<!-- /SUMMARY -->

<!-- YOUTUBE -->

https://youtu.be/lngaePO96tM

<!-- /YOUTUBE -->

<!-- UPDATE_LOG -->

- Added the ability to clone an existing credential
- Added a WSL option for the local terminal
- Added Helm charts and a GitOps deployment setup
- Added an editable path bar to the file manager
- Added a progress bar for file downloads in the file manager
- Added an identity file option so agent authentication stops after the right key
- Added an environment variable to turn on silent OIDC login
- Added editable model settings for AI providers
- Improved tmux monitor performance when aggregating sessions
- Improved Linux packaging with standard icon sizes

<!-- /UPDATE_LOG -->

<!-- BUG_FIXES -->

- Passkey sign in not showing up on the login screen
- Connections through jump hosts failing
- Jump hosts and remote desktop hosts not resolving after a sync
- Malformed websocket messages crashing the server
- Encrypted file manager keys not prompting for a passphrase
- SSH agent forwarding not working with the in-memory agent
- Two factor prompts rejecting codes longer than six digits
- OIDC lockout with no way to recover from environment settings
- Tailscale requests failing on some setups
- Terminal clipboard shortcuts not working on non-QWERTY layouts
- Rapid mobile terminal input being sent one keystroke at a time
- HTTPS not being able to share the configured port
- Portable imports failing on remote databases
- Host status not showing when metrics collection is off
- Proxmox guest credential usernames being wrong
- File drops not working for RDP in the browser
- Duplicate Docker HTTPS listener on startup
- Remote sync server probe ignoring the certificate setting
- Runtime SSL settings not being preserved
- Automation notifications missing host details
- Connection screens crashing outside the connection log provider
- better-sqlite3 failing in Docker on some platforms
- Host action rows shifting at large font sizes
- Sidebar height jumping when hosts or credentials have tags
- Gaps between host rows in the sidebar list
- Rounded corners on the host list search bar
- Image storage settings text wrapping to one word per line
- Unclear wording on the click-to-expand host setting
- Dragging a folder into the file manager failing to upload

<!-- /BUG_FIXES -->
