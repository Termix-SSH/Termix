<div align="center">

<img src="https://raw.githubusercontent.com/Termix-SSH/Termix/main/public/icon.svg" width="120" height="120" alt="Termix Logo" />

<h1>Automations</h1>

<p>Make your servers react on their own</p>

</div>

<br />

## Overview

Automations runs steps on your hosts when something happens, like cleaning up a disk when it fills or restarting a container when it stops.

<br />

## Features

- Triggers for metrics, hosts going up or down, health checks, schedules, container events and webhooks
- Steps that run commands and snippets, control containers and tunnels, wake hosts, call URLs and send alerts
- Conditions, waits and variables for more complex flows
- Run on one host, a fleet or every host
- Test runs and a history of every run
- Maintenance windows that pause automations while you work on a host

<br />

## Services

Provides to other plugins:

- `automations.access`: list and run automations

Uses from other plugins:

- `snippets.access` for the run snippet step. Required
- `fleets.access`, `tunnels.access`, `docker.containers`, `docker.events`, `host-metrics.viewers` and `wake-on-lan.send` for their steps and triggers. Each one is optional

<br />

## Support

To report a bug or request a feature, open a [support ticket](https://github.com/Termix-SSH/Support/issues/new/choose). You need to be logged in to GitHub. Please be as detailed as possible, preferably in English.

For discussions and questions, join the [Discord](https://discord.gg/jVQGdvHDrf) server.

<br />

## License

Distributed under the Apache License Version 2.0. See [LICENSE](https://github.com/Termix-SSH/Termix/blob/main/LICENSE) for more information.
