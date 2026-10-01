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

## Host maintenance

Open **Maintenance** from a saved host's actions. Its owner can start maintenance now, record a reason and estimated duration, or add a one-time, weekly or monthly schedule. Viewing requires `automations.view`; changes require `automations.edit`. Active maintenance appears as a host badge. The Automations plugin must remain enabled for maintenance scheduling and suppression to operate.

Schedules use UTC, including through daylight-saving changes. A monthly schedule for a day missing from a month skips that month. Up to 20 plans per host are stored; remove completed one-time plans when no longer needed. Planned windows cannot overlap (touching endpoints are allowed), and recurring conflicts are checked over the Gregorian calendar cycle. Removing a plan cancels future occurrences, not maintenance already in progress.

The estimated completion time is informational. Maintenance **only ends when its owner explicitly ends it**. If work overruns into another scheduled window, the host stays in maintenance and the estimate extends to the later planned end. After server downtime, due plans are caught up without briefly exposing an outage between maintenance windows. Each plan's next occurrence and the active state survive restarts.

While active, maintenance suppresses new host-status, health-check, metric-threshold, container-event and tunnel-disconnection automation runs for that host. This pauses the entire triggered automation, including any remediation steps. Monitoring continues to report the real status; observed status/health baselines still advance and metric dwell windows are reset. Manual runs, schedules, webhooks, security login events and runs already in progress continue normally. Maintenance does not globally silence alerts from unrelated plugins.

An optional overdue reminder uses the estimate plus a configurable grace period (20 minutes by default). It only sends after core has observed the host offline at or after that deadline; an unknown, online or older cached status does not qualify. Enable host status checks to supply those observations. Reminders use the Alerts hub and category `automations.maintenance_overdue`, which can be routed through the user's notification rules. A successful reminder is remembered across restarts; an extended estimate permits another reminder for the new deadline. No reminder automatically ends maintenance.

Maintenance rows reference their owner and host with cascading deletion. SQLite, PostgreSQL and MySQL migrations add only the new maintenance table.
