# SSH Terminal

SSH terminal sessions with jump hosts, host key checks, command history and a local terminal in the desktop app.

## Features

- SSH terminal sessions with jump hosts and host key checks.
- Keeps a session alive on the server after a disconnect, so reopening the tab picks up where you left off.
- Command history with autocomplete.
- A toolbar docked to the terminal with host tools and live stats.
- Paste or upload images to the host from the terminal.
- A local terminal in the desktop app.
- Attaches to tmux sessions when Tmux Monitor is on.

## Settings

### Admin

- Keep sessions after disconnect and Terminal Session Persistence: keep a disconnected terminal alive, and for how long.
- Command History and Command history for new hosts: allow history, and whether new hosts start with it on.
- Touch Input: options for using the terminal on a touch screen.
- Image Storage: where pasted and uploaded images are kept, and how many and how large.

### Host

- Enable Terminal: offer an SSH terminal for this host.
- Enable Terminal Toolbar: show the toolbar for this host.
- Command History: record commands run on this host.

## Permissions

- `ssh-terminal.sessions`: Let other features, like session sharing and recording, reach your live terminal sessions. Admins and users have it by default.
- `ssh-terminal.history`: Read command history. Admins and users have it by default.

## Services

Provides to other plugins:

- `sessions.live` as `ssh`: find a live terminal session so it can be shared.
- `terminal.history`: read a user's command history.

Uses from other plugins:

- `tmux.sessions` to attach to tmux. Optional.
- `sessions.sharing` for shared sessions. Optional.
- `recordings.writer` to record sessions. Optional.

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
```

## Reconnecting a workspace

Use **Reconnect all disconnected terminals** from a tab's context menu or the command palette after a network interruption. It retries mounted SSH terminal tabs, including hidden tabs and split panes, through their existing manual reconnect flow. Connected terminals and terminals already connecting or waiting for an automatic retry are skipped. Invoking the action again does not interrupt an in-flight connection; failures in one tab do not stop the others. The notification counts reconnect attempts started, not successful connections.

This is a manual workspace action. It does not add automatic SSH-error retries, resume/network listeners, tmux-session restoration or scrollback preservation. Existing authentication prompts, host-key validation and manual-reconnect behavior still apply. Other session plugins participate only if they expose the SDK's optional `reconnectIfDisconnected` handle method.
