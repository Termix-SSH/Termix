# Contributing to Tmux Monitor

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
npm run validate   # check manifest.json
npm run format     # format the code with Prettier
```

## Settings

### Host

- **Enable Tmux Monitor:** show this host in the monitor and add its tmux actions to the sidebar
- **Enable tmux mouse support:** turn on mouse support when attaching or creating a session

## Permissions

- `tmux-monitor.use`: browse and control tmux sessions on hosts with the monitor on. Admins and users have it by default.
