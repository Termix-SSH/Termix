# Contributing to SSH Terminal

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
npm run validate   # check manifest.json
npm run format     # format the code with Prettier
```

## Settings

### Admin

- **Keep sessions after disconnect and Terminal Session Persistence:** keep a disconnected terminal alive, and for how long
- **Command History:** allow command history at all
- **Touch Input:** options for using the terminal on a touch screen
- **Image Storage:** where pasted and uploaded images are kept, and how many and how large

### User

- **Command Autocomplete:** show suggestions from your history while you type

### Host

- **Enable Terminal:** offer an SSH terminal for this host
- **Enable Terminal Toolbar:** show the toolbar for this host
- **Command History:** record commands run on this host
- **Appearance:** theme, colors, font, cursor and syntax highlighting
- **Behavior:** Auto-Tmux, Auto-Mosh, local echo, auto reconnect, password and sudo auto-fill, and scrollback size

## Permissions

- `ssh-terminal.sessions`: let other features, like session sharing and recording, reach your live terminal sessions. Admins and users have it by default.
- `ssh-terminal.history`: let other features, like the AI assistant, read your command history. Admins and users have it by default.
