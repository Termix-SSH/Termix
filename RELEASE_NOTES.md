<!-- SUMMARY -->

A new plugin system powering every feature, a dedicated sync page with more control over what syncs, one inbox for all alerts, a redesigned split screen, admin, user and folder host defaults, host maintenance mode, and a large batch of file manager, terminal, and remote desktop fixes.

<!-- /SUMMARY -->

<!-- YOUTUBE -->

https://youtu.be/lngaePO96tM

<!-- /YOUTUBE -->

<!-- UPDATE_LOG -->

- Rebuilt Termix around a plugin system, with features like the terminal, file manager, tunnels, Docker, Proxmox, remote desktop, metrics, automations, AI and every login method now shipped as signed plugins on a shared SDK
- Moved desktop sync to its own page in the sidebar, with options to choose what syncs, keep single hosts or folders on the device only, and resolve conflicts
- Added a recent servers list when linking the desktop app
- Combined all alerts into one inbox with popups, Termix announcements and a new email channel
- Redesigned split screen with free-form panes and a pane picker
- Redesigned host defaults so they can be set at the admin, user or folder level and are inherited by hosts unless overridden
- Added per-host maintenance mode and recurring schedules to automations
- Added optional auto reconnect for dropped SSH sessions and a button to reconnect all disconnected terminal tabs
- Added a duplicate tab action and a reconnect session keybinding
- Added a host click setting to either focus an existing tab or always open a new one
- Added keyboard type-ahead search to the host list
- Added tighter compact host rows with inline tags
- Added an option to show tab numbers
- Added an option to hide folder paths above nested folders
- Added a list of the fixed app shortcuts to the keyboard shortcuts screen
- Added terminal toolbar position, start state and fade settings per host
- Added a host setting to turn off password prompt auto-fill
- Added the option to apply a saved custom theme in connection defaults
- Added FortiToken push 2FA support for SSH
- Added a unified multi-host tmux monitor view and a per-host tmux mouse toggle
- Added fleet sharing
- Added a list view to Docker management and support for the OrbStack Docker socket on macOS
- Added network graph sync between the desktop app and the server
- Added homepage canvas layout sync across devices
- Added RDP display zoom controls
- Added an option to skip the move to trash confirmation in the file manager
- Made the file manager open in the remote login directory by default
- Added add host and copy IP actions for Tailscale devices
- Added inline credential sharing in the sidebar, matching host sharing
- Made the Windows desktop shortcut optional in the installer
- Redesigned the snippets panel to match the host list
- Redesigned the session log player controls
- Host status now shows online once the port answers and only warns when a login fails
- Faster SFTP downloads
- Faster UI loading with less jitter and lag across tabs, the dashboard and the network graph

<!-- /UPDATE_LOG -->

<!-- BUG_FIXES -->

- TOTP not being prompted for jump hosts in the terminal, file manager, metrics and client tunnels
- SSH host names resolving to IPv6 when IPv4 was available
- Host key updates not syncing between devices
- Host metrics returning 404 on the first connect
- Host metrics using too much CPU on the backend
- Host metrics showing image and firmware filesystems
- Sudo password not auto-filling
- Tunnels failing with shared credentials
- Imported jump host references breaking
- Hard to read terminal selection with the light theme
- Terminal input arriving out of order with local echo on
- Terminal image uploads failing when the image library was unavailable
- File manager saves failing or corrupting files, with no sudo prompt on protected files
- Sending a single file between servers failing
- Disk usage showing the wrong mount or not refreshing with the directory
- File uploads not cancelling and continuing to write on the server
- Ctrl/Cmd+F file search not working in the file manager
- File drops from the OS not working over existing rows
- No download progress in file viewers
- Text in Markdown previews not being selectable
- Inline rename, compact mode and narrow list layout issues in the file manager
- Remote desktop not using the host's saved guacd endpoint
- Remote desktop asking for clipboard access unprompted
- Remote desktop keys staying held after switching windows
- Session share links on desktop pointing at the local app instead of the server
- Shared terminal sizes and participant presence not syncing in session sharing
- Meeting guests not being shown to members, and guests seeing the full roster
- Session sharing not handing over cleanly after a takeover
- AI responses getting cut off mid stream
- AI provider settings not syncing to linked devices
- Proxmox guest sync and startup snippet sync not working
- LDAP logins losing the bind DN from the directory
- Homepage service checks failing for allowed private addresses
- Sidebar search showing overlapping hosts when grouped by tags
- Sidebar rows not resizing after changing density, and compact rows hiding host addresses
- Split screen layouts failing to create over plain HTTP
- Double Shift opening the command palette by accident
- Fleet detail buttons overflowing the sidebar
- Recent activity cutting off host names too early
- Docker container logs using the wrong background color
- Version number missing on desktop when the server was offline
- Desktop app not starting reliably, not quitting with active connections, and the Linux tray icon failing to load
- Mac App Store builds being blocked by the single instance lock
- Untranslated text in toasts and other parts of the UI
- Several dependency security advisories

<!-- /BUG_FIXES -->
