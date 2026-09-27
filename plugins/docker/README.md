# Docker

Manage Docker and Podman containers over SSH, with logs and a container console.

## Features

- List, inspect, start, stop, restart, pause and remove containers.
- Read and download container logs.
- Open an interactive console inside a container.
- Works with Docker or Podman.
- Adds a Docker widget to the homepage.

## Settings

### Host

- Enable Docker: show the Docker tab for this host.
- Container Runtime: Docker or Podman.

## Permissions

- `docker.use`: Use Docker. Admins and users have it by default.

## Services

Provides to other plugins:

- `docker.containers`: list containers and start, stop, restart, pause, unpause or remove them.
- `docker.events`: get notified when a container starts, exits, restarts or turns unhealthy.

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
```

See `packages/plugin-sdk/ARCHITECTURE.md` for the plugin contract.
