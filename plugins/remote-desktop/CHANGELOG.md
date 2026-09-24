# Changelog

## 1.0.0

Bundled with Termix 2.9.0.

- Runs entirely through the plugin SDK: no imports from Termix core.
- Remote Desktop's admin switch and guacd URL, each user's RDP defaults and
  every host's RDP, VNC and Telnet options are this plugin's settings now,
  moved over on upgrade.
- The user's RDP defaults now apply to saved hosts too, not only Quick Connect.
- Provides `sessions.live` for RDP, VNC and Telnet, so these sessions can be
  shared and presented in collab rooms.
- Jump host tunnels and the macOS VNC proxy close with their session instead
  of after an hour.
- Opening the Windows Remote Desktop client goes through the desktop app's
  backend.
