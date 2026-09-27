# Tmux Monitor

Browse and control tmux sessions, windows and panes across your hosts.

## Features

- See the tmux sessions, windows and panes on every host with the monitor on.
- CPU, memory and GPU use for each pane, and search across pane history.
- Create, rename and close sessions and windows, and split and close panes.
- Attach a terminal to any pane.
- Tag sessions with your own labels.

## Settings

### Host

- Enable Tmux Monitor: show this host in the monitor.

## Permissions

- `tmux-monitor.use`: Use Tmux Monitor. Admins and users have it by default.

## Services

Provides to other plugins:

- `tmux.sessions`: find, attach to and create tmux sessions. The terminal uses this to attach to tmux on connect.

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
```
