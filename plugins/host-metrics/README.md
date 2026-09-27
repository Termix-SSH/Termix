# Host Metrics

Live CPU, memory, disk, network and process stats, plus tools to manage services, packages, firewall rules, cron jobs, users and more.

## Features

- Live CPU, memory, disk, network, temperature and process stats.
- History charts for each host.
- Tools to manage services, packages, firewall rules, cron jobs, users, SSL certificates, logs and WireGuard.
- A drag and drop layout you can change per host.
- Other features can add their own tools. Tailscale does.

## Setup

The online dot in the host list comes from Termix itself, not this plugin. A working metrics login is what marks a reachable host as online.

## Settings

### Admin

- Metrics interval (seconds): how often a host is checked while someone views it.
- History retention (days): how long history is kept.
- Metrics on for new hosts: whether new hosts start with metrics turned on.

### User

- Temperature unit: Celsius or Fahrenheit.

### Host

- Collect metrics: turn metrics on for this host.
- Metrics interval (seconds): override the admin interval.
- Enabled widgets: which widgets to show.
- Excluded mounts and Monitored paths: which disks to hide or watch.

## Permissions

- `host-metrics.use`: View metrics and use the host tools. Admins and users have it by default.

## Services

Provides to other plugins:

- `host-metrics.viewers`: read a host's current metrics.

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
```

See `packages/plugin-sdk/ARCHITECTURE.md` for the plugin contract.
