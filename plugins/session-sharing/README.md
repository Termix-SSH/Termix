# Session Sharing

Share a live terminal or remote desktop session by link or with another user,
and present sessions to a group in collaboration rooms.

Bundled with Termix and enabled by default. It imports only
`@termix/plugin-sdk`.

## What it does

- **Shares**: a link for anonymous guests, or a grant for one user, read-only
  or read-write, with an expiry. The share button sits in the terminal and
  remote desktop toolbars.
- **Rooms**: members watch one stage, the live session the presenter shows.
  The presenter or host can hand input control to a member, and a room can
  have an anonymous guest link.
- **`sessions.sharing`**: member joins and room events for the terminal
  socket. Guest joins go through `sessions.sharing.guests` on `ctx.registry`,
  because a guest has no user for a service's permission check.

It reaches live sessions only through the `sessions.live` service, keyed by
session type: ssh-terminal provides `ssh`, remote desktop provides `rdp`,
`vnc` and `telnet`.

## Layout

    manifest.json         id, capabilities and what this plugin contributes
    src/backend/          activate(ctx), routes, the room hub, the services
    src/frontend/         share dialog, guest views, rooms panel and tab
    migrations/           one .sql per dialect, generated from src/backend/tables.ts
    tests/                backend (node) and frontend (jsdom)
