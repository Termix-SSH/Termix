# Changelog

## 1.0.0

Bundled with Termix 2.9.0.

- Session sharing and collaboration rooms moved out of core and now serve
  under `/plugin-api/session-sharing`. The old `/session-sharing` and
  `/collab` routes are gone; guest links (`?view=shared` and
  `?view=collab-guest`) keep working.
- Owns its data: core's `session_shares`, `session_share_participants`,
  `collab_rooms` and `collab_room_members` tables are renamed into this
  plugin on first activation.
- The instance-wide sharing switch and each host's sharing switch moved into
  this plugin's admin and host settings.
- New `session-sharing.use` permission, given to the admin and user roles.
- Provides `sessions.sharing` and the `sessions.sharing.guests` registry entry,
  which the terminal uses for member and guest joins.
- The share button moved from the tab bar into the terminal and remote
  desktop toolbars.
