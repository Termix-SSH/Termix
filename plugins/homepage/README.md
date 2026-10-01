# Homepage

A custom widget page and service links for your servers and services.

## Features

- A page of widgets you can move, resize, pan and zoom. Open it from the command palette.
- Widgets for clocks, notes, folders, host status, bookmarks, weather, RSS feeds, ping checks, calendars, countdowns, search, images, custom APIs, an embedded terminal and more.
- Other features can add their own widgets, like Docker, Tunnels, File Manager and Host Metrics.
- Service link buttons and a homepage preview for the dashboard.
- Widgets and service links sync between the desktop app and a server.

## Permissions

- `homepage.use`: Use the homepage. Admins and users have it by default.

## Services

Provides to other plugins:

- `homepage.items`: list a user's homepage widgets.

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
```
