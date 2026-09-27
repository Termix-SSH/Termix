# Network Topology

Show your hosts and how they connect as an interactive graph.

## Features

- Show your hosts and the links between them as an interactive graph.
- Put hosts into groups, and groups inside other groups.
- Import and export the graph as JSON.
- Add the graph to the dashboard as a card.
- Each user's graph is saved and syncs between the desktop app and a server.

## Permissions

- `network-topology.use`: Use the network graph. Admins and users have it by default.

## Services

Provides to other plugins:

- `network-topology.graph`: read a user's graph.

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
```
