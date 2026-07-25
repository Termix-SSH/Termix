<!-- SUMMARY -->

Standalone-first Electron desktop app with optional remote sync, shared/multiplayer terminal and remote desktop sessions, SSH MFA support, custom key shortcuts, expanded host and credential sharing, plus 20+ bug fixes across terminal, RDP/VNC, mobile, and auth.

<!-- /SUMMARY -->

<!-- YOUTUBE -->

https://youtu.be/c3UD4q2jW_8

<!-- /YOUTUBE -->

<!-- UPDATE_LOG -->

- Added simple telemetrics to PostHog (user count, total hosts across users, and version metrics)
- Reworked Electron desktop app to run standalone-first with a now optional sync to a remote Termix server
- Added support for starting connections locally or from the remote server on desktop app
- Added support for custom key shortcuts
- Added support for more MFA types (SSH-only)
- Added multiplayer/shared sessions for terminals and remote desktop (share via link or user)
- Added support for logging into SSH hosts that require multi-factor authentication (like Duo or JumpCloud push/TOTP prompts).
- Added custom keyboard shortcuts, so you can set your own key combos instead of being stuck with the defaults.
- Added the option to convert a Quick Connect session into a saved host after connecting.
- Added an export option for sharing host entries without credentials, so a host list can be shared without leaking passwords or keys.
- Unified the folder picker across hosts, credentials, and snippets so they all use the same searchable, create-in-place selector.
- Allowed pasting into the key recording field from the clipboard.
- Allowed sharing hosts that use authentication type "none".
- Allowed setting authentication type "none" on RDP hosts.
- Added the option to show two or more sidebar panels open at the same time.
- Added global custom themes that can be applied across all hosts instead of per host.
- Added a button to quickly create a Credentials entry from a host's existing authentication details.
- Added persistent split screen, so your layout and assigned tabs are restored after closing and reopening the app.
- Added tag matching to host search, so searching now matches tags as well as hostnames.
- Brought back the ability to collapse snippets.
- Added the ability to assign login credentials to an entire folder of hosts instead of one at a time.
- Added the ability to share terminal, VNC, and RDP sessions with other users, including read-only and read-write modes.
- Added the ability to share entire folders of hosts with other users instead of sharing hosts one by one.
- Added the ability to make folders of hosts available to specific users instead of everyone recreating them.
- Reworked SSH credentials to support both a password and an SSH key on the same credential, with an option to auto fill the password when prompted.
- Added an option to add a custom background image to the terminal window.
- Added a custom group claim option for OIDC login, useful for identity providers like Zitadel that don't use a plain "groups" claim.
<!-- /UPDATE_LOG -->

<!-- BUG_FIXES -->

- Fixed the Add Channel dialog failing with "config is required" when adding Webhook or ntfy alert channels.
- Fixed font size and UI scaling being too small even at the largest setting on high resolution displays.
- Fixed the Docker integration not working on hosts using authentication type "none".
- Fixed the latest Russian translation updates from Crowdin not being included in the app.
- Fixed missing Nerd Font symbol support in the Android app.
- Fixed credential changes on RDP hosts not saving properly.
- Fixed credential folders not showing up in the folder dropdown when editing a credential.
- Fixed RDP hosts not using their stored credential and falling back to a direct connection.
- Fixed Cmd + scroll on Mac resizing the terminal instead of scrolling.
- Fixed text repeating itself in the terminal when typing with a wireless keyboard on Android.
- Fixed RDP connections failing when going through a jump host.
- Fixed SSH connections failing when going through a jump host in some setups.
- Fixed OIDC login failing with a database error when the identity provider didn't return a client ID.
- Fixed SSH client-to-server tunnels failing with an authentication error.
- Fixed Host Metrics disk usage only showing the root filesystem and ignoring other mounted disks.
- Fixed Android navigation buttons covering the terminal's top bar keys.
- Fixed Proxmox discovery importing DHCP LXC containers with an IP of 0.0.0.0 instead of their real address.
- Fixed VNC connections to macOS Screen Sharing hanging after the handshake instead of connecting.
- Fixed File Manager delete still failing on Windows hosts running PowerShell 5.1.
- Fixed the terminal dropping characters while typing on iOS.
- Fixed SSH lines like "[username@host]" being wrongly highlighted as a log level and breaking output formatting.
- Fixed RDP touch mode on Android not registering taps as clicks.
- Fixed VNC connections still failing due to a guacd protocol version mismatch.
- Guacamole tab showing "connecting" instead of rendering the desktop
- Fixed tmux not using Tailscale when starting connections
- Fixed an invalid websocket frame from causing code 10006 crash triggering restart loop
<!-- /BUG_FIXES -->
