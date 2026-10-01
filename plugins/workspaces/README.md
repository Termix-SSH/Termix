# Workspaces

Save and restore named tab and split layouts.

## Features

- Save your open tabs and split layouts as a named workspace.
- Open a workspace later to bring every tab back.
- Tabs from a feature that is turned off are kept as placeholders.
- Saved workspaces sync between the desktop app and a server.

## Permissions

- `workspaces.use`: Use workspaces. Admins and users have it by default.

## Services

Provides to other plugins:

- `workspaces.saved`: list a user's saved workspaces.

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
```
