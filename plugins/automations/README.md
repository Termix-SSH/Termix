# Automations

Run actions on your hosts on a schedule or when something happens, like a host going down or a metric crossing a limit.

## Features

- Triggers: a schedule, a host going up or down, a metric crossing a limit, a health check change, a container event, a Termix event or an incoming webhook.
- Steps: send an alert, call a URL, run a snippet or command, control a container or tunnel, wake a host, wait, set a variable, branch with if / otherwise, run another automation or stop.
- Run an automation on the host that triggered it or on any host or fleet you pick.
- See the output and errors of each step for every run.

## Permissions

- `automations.view`: See automations and their runs. Admins and users have it by default.
- `automations.create`: Create automations. Admins and users have it by default.
- `automations.edit`: Change automations. Admins and users have it by default.
- `automations.delete`: Delete automations. Admins and users have it by default.
- `automations.run`: Run automations by hand. Admins and users have it by default.

## Services

Provides to other plugins:

- `automations.access`: list and run automations.

Uses from other plugins:

- `snippets.access` for the run snippet step. Required.
- `fleets.access`, `tunnels.access`, `docker.containers`, `docker.events`, `host-metrics.viewers` and `wake-on-lan.send` for their steps and triggers. Each one is optional.

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
```

See `packages/plugin-sdk/ARCHITECTURE.md` for the plugin contract.
