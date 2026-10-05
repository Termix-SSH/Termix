# Contributing to Fleets

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
npm run validate   # check manifest.json
npm run format     # format the code with Prettier
```

## Permissions

- `fleets.view`: see fleets, their hosts and their inventory. Admins and users have it by default.
- `fleets.manage`: create, edit, delete and share fleets. Admins and users have it by default.
- `fleets.execute`: run commands, package actions and file transfers on a fleet. Admins and users have it by default.
