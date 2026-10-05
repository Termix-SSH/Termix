# Contributing to Snippets

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
npm run validate   # check manifest.json
npm run format     # format the code with Prettier
```

## Settings

### User

- **Collapse folders by default:** start each folder closed in the Snippets panel
- **Show commands:** show the first line of each command under its name
- **Confirm before running:** ask before a command snippet runs in a terminal

## Permissions

- `snippets.view`: see your own and shared snippets. Admins and users have it by default.
- `snippets.create`: create snippets, notes and folders. Admins and users have it by default.
- `snippets.edit`: change snippets and folders. Admins and users have it by default.
- `snippets.delete`: delete snippets and folders. Admins and users have it by default.
- `snippets.share`: share snippets and folders. Admins and users have it by default.
