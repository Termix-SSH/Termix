# SSH Terminal

The interactive SSH terminal, packaged as a first-party plugin.

## Why this plugin runs in-process

Every other plugin runs in a `worker_threads` worker and reaches the server
through a structured-clone `postMessage` boundary. That boundary is what makes
the capability gate and the audit trail mean anything: a worker plugin cannot
hold a db handle, an ssh2 `Client` or a live socket, so every privileged action
has to go through the broker.

This plugin cannot work that way. It _is_ the SSH transport rather than a
consumer of one:

- it owns a `WebSocketServer` on port 30002,
- it holds long-lived `ssh2.Client` objects and PTY streams,
- it needs plaintext host credentials to connect at all.

None of those can cross a structured-clone boundary, and `ctx.hosts` returns a
13-field allowlist that deliberately excludes `password`, `key` and
`keyPassword`. So `ssh-terminal` runs on the main thread instead, under the
`process:transport-owner` tier.

Membership in that tier is a hardcoded allowlist in
`src/backend/plugins/first-party.ts`. A manifest cannot ask for it: declaring
`process:transport-owner` without being on the list is a validation error. The
tier has no capability gate and no audit interception, which is only defensible
because nothing installable can enter it.

## What lives where

The terminal's implementation stays in `src/backend/hosts/terminal/`. Only the
lifecycle lives here. Two reasons it was not copied in:

- `session-manager.ts` has six consumers outside the terminal (terminal routes,
  open-tabs, user-image-storage, collab, and session-sharing twice). It is
  shared infrastructure, not plugin-private code.
- host key verification (`host-key-verifier.ts`), jump host chaining
  (`jump-host-chain.ts`) and host resolution (`host-resolver.ts`) each have
  around eight consumers already. They keep working by _not_ moving.

The SSH connection pool also stays in core. The terminal never used it: it
calls `new Client()` directly. The pool's consumers are metrics, tmux, tunnel,
fleet routes, AI tools, automations and `ctx.ssh` itself, so moving it here
would have made all of them depend on the terminal being enabled.

Only `SSHAuthManager` is terminal-exclusive.

## WebSocket: still port 30002, not /plugin-api/

The terminal WS was deliberately left on its own port and path.

`/plugin-api` has no auth middleware, so routing terminal auth through it would
be a regression. Beyond that, `/ssh/websocket/` is mapped in both nginx configs,
three frontend call sites build that URL (`Terminal.tsx`, `SharedSessionView`,
`CollabRoomTab`), Electron's `buildOriginWsUrl` pins `localPort: 30002`, and the
8-attempt reconnect plus detach/reattach buffering all depend on the current
path.

The plugin owns the port's lifecycle instead: enabling it calls
`startTerminalServer()`, disabling it calls `stopTerminalServer()`, which closes
live sessions and frees the port.

## Disabling

Disabling behaves like any other plugin. No confirmation dialog, no special
casing. The terminal tab stops being offered from the host list, command
palette and quick connect, the port stops listening, and every other feature
(metrics, docker, tunnels, file manager) keeps working off its own connections.
