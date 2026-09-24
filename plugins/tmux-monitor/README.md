# Tmux Monitor

Browse and control tmux sessions, windows and panes across your hosts.

Bundled with Termix and enabled by default. It imports only
`@termix/plugin-sdk`.

## What it does

- **Overview**: sessions, windows and panes for every host with the monitor
  enabled, refreshed on a poll, with per-pane CPU/memory/GPU metrics and a
  search across pane scrollback.
- **Control**: create, rename and kill sessions and windows, split and kill
  panes, and attach a real terminal to a pane in place.
- **Tags**: per-user labels on a session, saved per host so everyone who
  monitors it can tag it differently.
- **`tmux.sessions`**: a service the ssh-terminal plugin consumes, optionally,
  to detect tmux on connect, attach or create a session, and wait for a new
  one to appear. The terminal keeps working without this plugin; it just
  skips tmux attach.

Every command runs over a pooled connection through `ctx.ssh.withConnection`,
so it gets host key checks, auth providers, proxies and jump hosts like every
other transport.

## Layout

    manifest.json         id, capabilities and what this plugin contributes
    src/backend/           activate(ctx), routes, the tmux exec helpers, the service
    migrations/            one .sql per dialect, generated from src/backend/tables.ts
    src/frontend/          the tab, host action, session tree and pane preview
    locales/en.json        its strings (English only; the rest are translated)
    tests/backend/         vitest, node
    tests/frontend/        vitest, jsdom

## Data

- `p_tmux_monitor_session_tags`, adopted from core's `tmux_session_tags`.
- Host setting `enableTmuxMonitor`, copied from the `ssh_data` column of the
  same name by core's `tmux-monitor-settings-migration.ts`.

See packages/plugin-sdk/ARCHITECTURE.md for the contract this follows.
