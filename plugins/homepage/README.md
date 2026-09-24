# Homepage

A customizable widget canvas (clock, notes, host status, RSS feeds, an
embedded terminal, and more) plus the dashboard's service link buttons.

Bundled with Termix and enabled by default. It imports only
`@termix/plugin-sdk`.

## What it does

- **The canvas**: a pannable, zoomable grid of widgets, opened as its own
  tab (singleton, `?view=homepage`) or from the command palette. Widgets
  save their own layout and config.
- **Widget types**: clock, notes, markdown notes, folders, host status,
  host grid, bookmarks, weather, iframe embed, RSS feed, ping status,
  recent activity, Termix uptime, system overview, an embedded SSH terminal,
  quick connect, calendar, countdown, search bar, text banner, image,
  custom API, service grid, dashboard links, search shortcuts and link
  trees. Other plugins (docker, tunnels, file-manager, host-metrics) add
  their own widget types through `app.registerHomepageWidget`; the widget
  type registry itself lives in core
  (`src/ui/plugin-host/homepage-widget-registry.ts`) so those widgets keep
  working with this plugin disabled.
- **Dashboard cards**: `service_links` (clickable service URL buttons) and
  `homepage_preview` (a read-only scaled preview of the canvas), both
  offered in the dashboard's card tray. The dashboard's "Dashboard /
  Homepage" toggle is a contribution to core's generic
  `dashboard.secondaryView` slot.
- **Outbound requests**: the favicon, RSS, ping and custom-API widgets fetch
  through `ctx.fetch`, which keeps the SSRF guard (private and loopback
  addresses refused, no redirects, DNS pinned) every other plugin's outbound
  call gets.
- **`homepage.items`**: a service the AI assistant reads optionally, to list
  a user's homepage tiles.

## Layout

    manifest.json         id, capabilities and what this plugin contributes
    src/backend/           activate(ctx), routes, the outbound proxy routes
    src/frontend/           the canvas, widgets, dialogs and dashboard cards
    migrations/             one .sql per dialect, generated from src/backend/tables.ts
    locales/en.json         its strings (English only; the rest are translated)
    tests/backend/          vitest, node
    tests/frontend/         vitest, jsdom

## Data

- `p_homepage_homepage_items`, `p_homepage_homepage_layouts` and
  `p_homepage_dashboard_service_links`, adopted from core's `homepage_items`,
  `homepage_layouts` and `dashboard_service_links`.

Core's own uptime, recent-activity and database-health routes are unrelated
to the canvas and stay on the main server
(`src/backend/database/routes/dashboard-routes.ts`, mounted at
`/dashboard`).

See packages/plugin-sdk/ARCHITECTURE.md for the contract this follows.
