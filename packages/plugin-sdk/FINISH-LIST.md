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
- **B5 (proxmox):** `runAdaptivePolling` and `cn` are duplicated in
  `plugins/proxmox/src/frontend/stats/` rather than shared with core's
  `src/ui/lib/` originals. `useConnectionRetry` (the third duplicate B5 left
  here) is resolved: **B6** promoted it into `@termix/plugin-sdk/frontend`
  once file-manager became its fourth caller (after proxmox, docker,
  host-metrics, remote-desktop) and switched proxmox's own copy over too.
  host-metrics's own conversion needs `runAdaptivePolling` for its stats tab,
  so promote it into `@termix/plugin-sdk/frontend` (and `cn` into
  `@termix/plugin-sdk/ui`) the next time either is touched. Owner: D1, or
  host-metrics's Phase B step if it lands first.
- **B5 (proxmox):** `runDueProxmoxAutoSyncs` in
  `plugins/proxmox/src/backend/routes.ts` still reaches
  `createCurrentPluginSettingsRepository`/`createCurrentHostRepository` by
  relative import instead of `ctx`, because it needs to scan every host's
  Proxmox settings across every user before it knows which actor to run each
  sync as, and neither `ctx.settings` nor `ctx.hosts` expose a cross-user
  bulk read today. A `ctx.settings.listHostsWithKey` or similar SDK addition
  would close this, if a second plugin's background scan ever needs the same
  shape. Owner: D1.
- **B6 (file-manager):** `plugins/file-manager/src/frontend/components/PdfPreview.tsx`
  runs pdfjs without a worker (main-thread parsing) because `termix-plugin
build`'s esbuild step has no static-asset-copy pipeline the way core's Vite
  build resolves a `?url` import to a hashed `/assets/` file. Fine for the
  small files this preview usually opens; restoring a real worker needs the
  CLI (`packages/plugin-sdk/cli/commands/build.mjs`) to gain a way to emit an
  extra file into `dist/` and have the frontend reference it by its served
  `/plugin-assets/<id>/` path. Owner: D1, or whichever step first needs a
  worker or other static asset from a plugin bundle.
- **B6 (file-manager):** `transfer-tuning.ts`'s adaptive-tuning profile still
  persists to a JSON file under `DATA_DIR` rather than `ctx.kv`, and
  `HostFilesTab.tsx`'s `t()` calls plus the manifest's `contributes.settings.host`
  `labelKey`s deliberately point at two different key paths (`hosts.*` and
  `settings.host.*`) for the same three fields, both carrying the same English
  text - a minor duplication from keeping the host editor's exact existing
  section verbatim (`registerHostEditorSection`) instead of switching it to
  the schema-driven settings form. Neither blocks anything; flagging for
  whoever next touches this plugin's settings UI.
- **B6 (file-manager):** `TabContext.tsx`'s `computeUniqueTitle` compares
  `tabType === "file_manager"` (an activity-log type string, not a tab type -
  the real tab type has always been `"files"`), so that branch has never
  matched and silently falls through to the terminal title. Pre-existing,
  unrelated to the conversion; noted rather than fixed per the lean-mode
  rules. Owner: whoever next touches tab title logic.
- **B6 (file-manager):** `enable_file_manager`, `default_path` and
  `scp_legacy` are still live `ssh_data` columns; only the copy-into-plugin-
  settings migration shipped (`file-manager-settings-migration.ts`). Every
  core read site the earlier exploration found (`host.ts`,
  `host-normalizers.ts`, `host-bulk-routes.ts`, `credentials.ts`,
  `host-internal-routes.ts`, `database.ts`'s encrypt/decrypt round trip,
  `plugins/host-view.ts`, `ctx-hosts.ts`, plus the frontend's
  `HostEditorData.ts`/`HostManagerData.ts`/`SidebarTree.tsx`/quick-connect
  mapping) still reads the column directly rather than
  `ctx.settings.getHost`. Switching every one of those and then dropping the
  column in lockstep (`schema.ts`, `db/index.ts`, a drizzle migration per
  dialect, `schema:generate`) is real, separate work this step didn't
  attempt, since none of those reads block the plugin conversion itself.
  Owner: a dedicated follow-up step, or D0.
