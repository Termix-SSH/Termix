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
