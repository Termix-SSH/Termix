# Usage Statistics

Sends a small anonymous report once a day so the Termix developers can see how many instances run and which features get used.

## What is sent

Always, while it is on:

- A random instance ID, the Termix version, and how many users and hosts exist.

Each of these has its own switch in Admin Settings > Usage Statistics:

- Platform info: operating system, CPU architecture, Node.js version, database type, and whether Termix runs in Docker, the desktop app or as a plain server.
- Feature usage: how many times each kind of tab was opened, plus SSH logins and host connections, since the last report.
- Installed features: the ids of the running built-in features.

It never sends usernames, hostnames, IP addresses, credentials or anything else that identifies you or your servers. Admins can preview the exact report before it is sent.

## Turning it off

- Admin Settings > Usage Statistics > Share anonymous usage statistics.
- Each user can leave their own feature usage out in User Profile > Usage Statistics.
- `ENABLE_TELEMETRY=false` turns it off and locks the switch. `ENABLE_TELEMETRY=true` locks it on.

## Environment

- `ENABLE_TELEMETRY`: `true` or `false` overrides the admin switch.
- `POSTHOG_API_KEY`: the PostHog project key. Defaults to the Termix project.
- `POSTHOG_HOST`: the PostHog host. Defaults to `https://us.i.posthog.com`.
