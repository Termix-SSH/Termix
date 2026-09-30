# Tmux Monitor

Browse and control tmux sessions, windows and panes across your hosts.

## Features

- See the tmux sessions, windows and panes on every host with the monitor on.
- CPU, memory and GPU use for each pane, and search across pane history.
- Create, rename and close sessions and windows, and split and close panes.
- Attach a terminal to any pane.
- Tag sessions with your own labels.

## Unified monitor

Open Tmux Monitor from a host action or the command palette. **All hosts**
shows an expandable tree for each SSH host with the monitor enabled. Filter
by host name or address, or choose **Single host** to use one host at a time.
Click a session name or pane to switch the live preview. The tree actions
continue to target the host containing that session, even when two hosts
have identical session names or pane IDs. The toolbar and output search
operate on the selected host.

The monitor remembers its mode, filter, collapsed hosts, expanded sessions,
last host and selected pane locally. An explicit host action takes precedence
over the saved host and clears the filter. A saved pane is restored only if
it still exists in the host's latest overview.

Expanded background hosts poll overview and resource metrics independently,
with at most four background hosts loading at once. Collapsing or filtering
out a background host stops its polling; switching away from the monitor
stops all overview/metrics polling. The selected host keeps polling while
its preview is active, including when its tree is collapsed. These controls
use the existing SSH APIs and require only tmux on the remote hosts, not
Auto Tmux.

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
