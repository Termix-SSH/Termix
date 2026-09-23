# Finish list

Running list of things intentionally left unfinished by a Phase B/C step,
so D0 (or an earlier owner named below) can pick them up. Remove a line once
it's done.

- **B3 (tailscale):** `ManagerCardShell`/`ManagerSearch`-equivalent presentation
  is duplicated as `TailscaleManagerShell`/`TailscaleManagerSearch` in
  `plugins/tailscale/src/frontend/TailscaleManagerShell.tsx` rather than
  shared with host-metrics's originals. Promote a shared version into
  `@termix/plugin-sdk/ui` once a second manager-card plugin needs one, per the
  contract's "add to the SDK when a second plugin needs it" rule. Owner: D1.
- **B3 (tailscale):** `plugins/tailscale/src/backend/host-metrics-manager.ts`
  and `routes.ts` still resolve hosts and access through core's
  `PermissionManager`/`resolveHostById`/`DataCrypto` by relative import
  instead of `ctx.hosts`, which **B4** built. Same debt every other
  host-metrics manager already carries; not new, but tailscale now carries it
  too. Owner: host-metrics's own Phase B step (it and every manager plugin
  convert together).
- **B4 (fleets/host-metrics):** `src/backend/hosts/metrics-shared/` (platform
  detection, package commands, exec-elevated) is still core's own copy, used
  by host-metrics, which has not converted yet. `@termix/plugin-sdk/host-commands`
  is the SDK copy fleets now uses; core's copy was left in place rather than
  turned into a re-export, since host-metrics's own conversion step is where
  its imports should move wholesale. Owner: host-metrics's Phase B step.
- **B5 (proxmox):** `useConnectionRetry`, `runAdaptivePolling` and `cn` are
  duplicated in `plugins/proxmox/src/frontend/stats/` rather than shared with
  core's `src/ui/lib/` originals, matching the same "add to the SDK once a
  second plugin needs it" call B3 made for `ManagerCardShell`. host-metrics's
  own conversion needs the same two hooks for its stats tab, so promote both
  into `@termix/plugin-sdk/frontend` (and `cn` into `@termix/plugin-sdk/ui`)
  the next time either is touched. Owner: D1, or host-metrics's Phase B step
  if it lands first.
- **B5 (proxmox):** `runDueProxmoxAutoSyncs` in
  `plugins/proxmox/src/backend/routes.ts` still reaches
  `createCurrentPluginSettingsRepository`/`createCurrentHostRepository` by
  relative import instead of `ctx`, because it needs to scan every host's
  Proxmox settings across every user before it knows which actor to run each
  sync as, and neither `ctx.settings` nor `ctx.hosts` expose a cross-user
  bulk read today. A `ctx.settings.listHostsWithKey` or similar SDK addition
  would close this, if a second plugin's background scan ever needs the same
  shape. Owner: D1.
