# Remote Desktop

RDP, VNC and Telnet remote desktop sessions, packaged as a first-party plugin.

## Why this plugin runs in-process

Every other plugin runs in a `worker_threads` worker and reaches the server
through a structured-clone `postMessage` boundary. That boundary is what makes
the capability gate and the audit trail mean anything: a worker plugin cannot
hold a db handle, an ssh2 `Client` or a live socket, so every privileged action
has to go through the broker.

This plugin cannot work that way:

- it owns a `guacamole-lite` WebSocket server on port 30008,
- its `/connect-host/:hostId` route does multi-step credential and tunnel
  resolution (SSH jump-host tunnels, a macOS VNC compatibility proxy) using
  raw `net.Socket` plumbing,
- it needs plaintext host credentials to connect at all.

None of that can cross a structured-clone boundary, so this plugin runs on the
main thread instead, under the `process:transport-owner` tier, the same as
`ssh-terminal`, `docker` and `host-metrics`.

## guacd is not spawned by this plugin

guacd (the Apache Guacamole proxy daemon that actually speaks RDP/VNC/Telnet)
is a separate, external service reached over plain TCP -- by default a
sibling Docker container, or any network-reachable host configured through the
admin "guacd URL" setting. This plugin does not download, bundle or spawn
guacd as a child process.

That is a deliberate limitation, not an oversight: Apache Guacamole does not
publish prebuilt guacd binaries for any platform (only source tarballs and
their own Docker image), and there is no viable native guacd for Windows at
all. Bundling guacd for Linux and macOS is possible in principle but would
make Termix the ongoing upstream builder and security patcher for guacd plus
FreeRDP/libvncclient/libssh2/libtelnet -- out of scope for this conversion.
guacd's availability is handled as an external dependency with graceful
degradation, exactly as it was before this plugin existed.

## What lives where

Unlike `ssh-terminal` (whose implementation stays in core because
`session-manager.ts` has consumers well beyond the terminal), this plugin's
backend and frontend code is fully relocated here from
`src/backend/hosts/guacamole/` and `src/ui/features/guacamole/`, the same
shape `docker` and `host-metrics` use.

Two pieces of shared infrastructure still reach across the plugin boundary
into this plugin rather than living in core:

- `src/backend/hosts/collab/routes.ts` and
  `src/backend/hosts/session-sharing/` import `token-service.ts` and
  `guacamole-server.ts` directly to resolve and validate live Guacamole
  sessions for collaborative/shared viewing.
- `src/ui/features/collab/` and `src/ui/features/session-sharing/` import
  `GuacamoleDisplay.tsx` directly for the same reason.

This is an accepted, temporary coupling: collab and session-sharing are
expected to become plugins of their own later, at which point these become
real inter-plugin references instead of raw relative imports.

## Disabling

Disabling behaves like any other plugin: the rdp/vnc/telnet tabs stop being
offered from the host list, command palette and quick connect, the
`/guacamole` router 404s, and the WebSocket server on port 30008 is closed.
