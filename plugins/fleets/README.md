# Fleets

Group hosts into fleets and run commands, package actions and file transfers on all of them at once.

## Features

- Group hosts into fleets by hand or by tag. Hosts with a matching tag join on their own.
- Run a command on every host in a fleet at once and see each result.
- Run package actions, like updates, across a fleet.
- Transfer files to and from every host in a fleet.
- See an inventory of the hosts in a fleet.
- Share fleets with other users or roles.

## Permissions

- `fleets.view`: See fleets, their hosts and inventory. Admins and users have it by default.
- `fleets.manage`: Create, edit, delete and share fleets. Admins and users have it by default.
- `fleets.execute`: Run commands, package actions and file transfers on a fleet. Admins and users have it by default.

## Services

Provides to other plugins:

- `fleets.access`: list fleets and run actions on them.

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
```
