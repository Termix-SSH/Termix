# Session Sharing

Share a live terminal or remote desktop session by link or with another user, and present sessions in collaboration rooms.

## Features

- Share a live terminal or remote desktop session by link or with one user.
- Pick read-only or read and write, and set when the share expires.
- Collaboration rooms where a presenter shows a session to a group and can hand control to a member.
- Guest links for people without a Termix account.
- The share button is in the terminal and remote desktop toolbars.

## Settings

### Admin

- Allow Session Sharing: turn sharing on or off for everyone.

### Host

- Allow Session Sharing: allow sharing sessions on this host.

## Permissions

- `session-sharing.use`: Share sessions and join rooms. Admins and users have it by default.

## Services

Provides to other plugins:

- `sessions.sharing`: join a shared session or room from the terminal.

Uses from other plugins:

- `sessions.live` to reach live SSH, RDP, VNC and Telnet sessions.

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
```
