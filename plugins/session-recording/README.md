# Session Recording

Records terminal sessions and lets you play them back or download them.

Bundled with Termix and enabled by default. It imports only
`@termix/plugin-sdk`.

## What it does

- **Recording**: an SSH terminal session is recorded as an asciicast, written
  incrementally in 300ms batches as it happens (issue #1049).
- **Playback**: view a recording inline, scrub through it, copy its plain
  text, or download it as a recording file or plain text.
- **Retention**: an admin setting prunes recordings older than a configured
  number of days, checked at startup and every 24 hours.
- **Per-host switch**: recording can be turned off for a host.
- **`recordings.writer`**: a service other plugins consume. `open(meta)`
  starts an incremental recording (ssh-terminal); `createFinished(input)`
  inserts a row for a recording the caller already wrote to disk itself
  (remote desktop's guacd recordings).

Recordings outlive the account they were made under: deleting a user
anonymizes their recordings rather than deleting them, since a recording is
evidence about the host as much as about the person.
