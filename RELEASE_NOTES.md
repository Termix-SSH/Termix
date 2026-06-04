<!-- SUMMARY -->

Bug fixes and new features including host-to-host file transfer, OIDC improvements, UI/UX updates, and numerous stability and security patches.

<!-- /SUMMARY -->

<!-- YOUTUBE -->

https://youtu.be/At8iDk6-Q_s

<!-- /YOUTUBE -->

<!-- UPDATE_LOG -->

- Added in-line buttons on host name row when using click to expand hosts in hosts list
- Expose admin_group via OIDC_ADMIN_GROUP env var
- Sync appearance preferences
- Support native OIDC callbacks
- Add portal Desktop DBUS permission for Flatpak URL opening
- Restore host password copy
- Support for single-host direct tunnels (ssh -L)
- Host to host file transfer in file manager
- Show ip/username without having to hover over hosts
- Updated credential list UI to match UI/UX of host list
- Restore rename host folder UI
<!-- /UPDATE_LOG -->

<!-- BUG_FIXES -->

- Several security vulnerabilities
- Allow navigating away from split-view to non-pane tabs
- Restore SSH keepalive internal to use 30s to prevent random disconnects
- Apply guacamole-lite protocol patch in Docker builds
- Show correct icons for network interface types
- Resolve sudo password for shared host users
- Use jump hosts for online status check and metric collection
- Broaden sudo prompt detection for newer distros
- Recalculate terminal layout after web fonts load
- Improve terminal cwd detection and initial directory command
- Decode base64 file content as UTF-8 in file manager
- Normalize lazy import default export for iOS compatibility
- Prevent RDP display from snapping back after container resize
- Removed unused code and fixed PR checks and lint warnings
- Send name instruction for protocol >= 1.3.0 (guacd 1.5.0/1.1.0 errors)
- Wire up OIDC to password link dialog with submit/visibility
- Pass through command completion
- Resolve terminal jump hosts server-side
- Auto allow SSL certs for private network hosts
- Removed deprecated host management button from command palette
- Command palette opening wrong protocol
- Export/import failing for ssh key hosts
- Docker ssh2 native crypto not compiling in Docker
- Persisted terminal tabs attempt SSH on RDP hosts afater migration
- Credentials not appearing in host manager until refresh
<!-- /BUG_FIXES -->
