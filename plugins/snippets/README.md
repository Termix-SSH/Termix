# Snippets

Save commands and notes, then run or paste them into a terminal. Supports variables and sharing.

## Features

- Save commands and notes and sort them into folders.
- Run a snippet or paste it into a terminal.
- Use variables like `$HOST` and `$INPUT_1` that are filled in when the snippet runs.
- Share snippets and folders with other users or roles.
- Snippets sync between the desktop app and a server.

## Settings

### User

- Collapse folders by default: start each folder closed when you open the Snippets panel.

## Permissions

- `snippets.view`: See your own and shared snippets. Admins and users have it by default.
- `snippets.create`: Create snippets, notes and folders. Admins and users have it by default.
- `snippets.edit`: Change snippets and folders. Admins and users have it by default.
- `snippets.delete`: Delete snippets and folders. Admins and users have it by default.
- `snippets.share`: Share snippets and folders. Admins and users have it by default.

## Services

Provides to other plugins:

- `snippets.access`: read and run snippets.

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
```
