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
- **B7 (tunnels):** `enable_tunnel` and `tunnel_connections` are still live
  `ssh_data` columns; only the copy-into-plugin-settings migration shipped
  (`tunnels-settings-migration.ts`), and the plugin reads its host settings
  now. Core still carries the columns through the host routes, the
  encrypt/decrypt round trip, `SidebarTree.tsx`'s host duplicate payload, the
  quick-connect mapping and the `Host`/`SSHHost` types, none of which the
  plugin reads any more. Dropping them in lockstep (`schema.ts`, `db/index.ts`,
  a drizzle migration per dialect, `schema:generate`) is the same follow-up the
  B6 file-manager line above describes. Owner: a dedicated follow-up step, or D0.
- **B7 (tunnels):** host export/import, host duplicate, the Hosts panel
  feature filter and the bulk enable/disable menu all work off `ssh_data`
  columns, so none of them can see a plugin's host settings. For tunnels the
  "Tunnel" filter and the bulk enable/disable entries were removed, and the
  export's "Tunnels" group became "Proxy" (SOCKS5 fields only) since
  `tunnelConnections` there is now stale. Bringing these back needs a way for
  core to read and write host-scope plugin settings generically (keyed off
  `contributes.settings.host` or `hostCapability`) rather than per column.
  Owner: D1.
- **B7 (tunnels):** the tunnel tab no longer writes a recent-activity entry:
  `logActivity` is a core `@/main-axios` call and the plugin imports nothing
  from `@/`. Old "tunnel" entries still reopen the tab through the plugin's
  `activityTypes`. An `app.logActivity` (or equivalent bridge member) would
  restore it for this plugin and let docker, file-manager and host-metrics drop
  their own `@/main-axios` import for it too. Owner: D1.
- **B7 (tunnels):** on the desktop app, tunnel statuses from a connected
  remote server are no longer merged into the tab: the old code polled the
  remote tunnel service through `getRemoteTunnelApi()`, and the SDK has no
  remote-origin plugin API client. `subscribeTunnelStatuses` already takes a
  `fetchRemote` and merges with local statuses winning, so it only needs a
  client for `/plugin-api/tunnels/status` on the remote server. Owner: D1.
- **B8 (web-endpoint):** `enable_web_ui` and `web_ui_config` are still live
  `ssh_data` columns; only the copy-into-plugin-settings migration shipped
  (`web-endpoint-settings-migration.ts`). Unlike B6/B7, this step DID convert
  every core read/write of those two fields (`host.ts`'s create/update and
  export routes, `host-normalizers.ts`, `host-bulk-routes.ts`,
  `database.ts`'s encrypt/decrypt round trip is the one exception - it copies
  whatever is already in the column for the raw DB export/backup tool, which
  needs no change since nothing reads that copy through `pluginSettings`).
  Dropping the columns in lockstep (`schema.ts`, `db/index.ts`, a drizzle
  migration per dialect, `schema:generate`) is the only remaining piece.
  Owner: a dedicated follow-up step, or D0.
- **B8 (web-endpoint):** added the first generic cross-plugin hook for core
  routes that touch host-scope plugin settings without importing a plugin:
  `ctx.registry.provide("<id>.hostImportNormalizer", fn)` plus
  `applyPluginHostImportSettings` in `host-plugin-settings.ts`, called from
  `host-bulk-routes.ts`'s Termix-JSON import path. Only import validation is
  covered; B7's TODO above about the Hosts panel feature filter and the bulk
  enable/disable menu (`hostCapability`-driven, not import-driven) is
  unrelated and still open. Owner: D1 for extending the same pattern there.
- **B8 (web-endpoint):** noticed while sanity-checking with `npm run lint`
  (not required by this step): `eslint.config.mjs`'s
  `globalIgnores(["dist", ...])` only matches a top-level `dist/` folder, not
  nested `packages/*/dist` or `plugins/*/dist`, so `npm run lint` fails on
  bundled output repo-wide with "Definition for rule X was not found"
  errors. Pre-existing, not introduced by this or any single plugin step.
  Owner: whoever next needs a clean `npm run lint`, or D0.
- **B8 (web-endpoint):** the isolated-window Electron IPC bridge
  (`src/backend/utils/electron-ipc-bridge.ts`, `ctx.desktop.openIsolatedWindow`)
  is a single request/response channel keyed by a random id with one
  registered backend-request handler (`open-isolated-window`) in
  `electron/main.cjs`. Fine for today's one caller; if a second plugin needs
  to ask Electron's main process for something, extend
  `BACKEND_REQUEST_HANDLERS` there rather than building a parallel channel.
  No owner needed unless a second caller appears.
- **B9 (ssh-terminal):** session sharing has no provider yet. The terminal
  consumes `sessions.sharing` v1 (member joins through `authorizeJoin` and
  `recordJoin`, collab room events through `subscribeRoom`/`unsubscribeRoom`)
  and reads guest link resolution from `ctx.registry` as
  `sessions.sharing.guests` (`resolve`, `recordJoin`), all typed in
  `plugins/ssh-terminal/src/backend/services.ts`. Until something provides
  them, share-link and room guests are refused and in-app joins fail. Core's
  session-sharing, collab and open-tabs code reach the terminal through
  `sessions.live` already. Owner: B12, which provides both from the
  session-sharing plugin (the lookups are the old code in
  `hosts/session-sharing` and `hosts/collab`: share repo, room repo, guest
  rate limit, `canJoinRoomStageShare`, `session_sharing_globally_enabled`,
  host `allowSessionSharing`, `getAuditUsername` for labels, `collabRoomHub`).
  B12 also moves `eventsWsPath` in `collab/routes.ts` and the share dialog the
  shell opens from a tab's `getShareTarget()`.
- **B9 (ssh-terminal), for D2:** the terminal socket is a public route with
  `optionalAuth`, because share-link and room guests authenticate inside the
  handler with their token. Guest auth itself is unchanged; review it with the
  rest of the public routes.
- **B9 (ssh-terminal):** recording has no provider yet. The terminal calls the
  optional `recordings.writer` v1 `open(meta)` and gets a sink with
  `append(chunk)` (one call per 300 ms batch, the first starting with the
  asciicast header), `persist(summary)` and `discard()`. Without it nothing is
  recorded and no `session_recordings` row is written. Owner: B13, which
  writes the file under `DATA_DIR/session_logs/<user>/<session>.cast` (mkdir
  and writeFile on the first append, appendFile after, never per chunk, see
  issue #1049) and creates or updates the row as the old session manager did.
- **B9 (ssh-terminal):** `enable_terminal`, `enable_terminal_toolbar` and
  `enable_command_history` are still live `ssh_data` columns. The copy into
  ssh-terminal host settings shipped (`ssh-terminal-settings-migration.ts`)
  and the terminal reads its settings, but core host routes, types, the
  export/import sample and `HostEditorData` still carry the columns.
  `enable_terminal_toolbar` also drives the RDP/VNC/Telnet toolbar
  (`remote-desktop/GuacamoleApp.tsx`), whose host editor switch stays in the
  General tab, so remote-desktop needs its own host setting and copy first.
  Then drop all three in lockstep. Owner: remote-desktop's step for its copy,
  then D0.
- **B9 (ssh-terminal):** the legacy `settings` rows for the terminal
  (`terminal_session_timeout_minutes`, `terminal_session_persistence_enabled`,
  `command_history_enabled`, `touch_input_settings`, `terminal_image_*`) are
  left in place for a release after the move; nothing reads them. Delete them
  in 3.0.0. `sessionPersistence` is carried over but, as before, nothing acts
  on it. Owner: D0 to decide.
- **B9 (ssh-terminal):** the image storage paths used to be rejected at save
  when not absolute; the schema-driven settings form accepts any string and
  the resolver ignores a bad one with a warning. A custom field or a validate
  hook on plugin settings would restore the save-time error. Owner: D1.
- **B9 (ssh-terminal):** `@termix/plugin-sdk/ui` now re-exports a handful of
  core APIs the terminal needs (`logActivity`, `getHostPassword`,
  `patchOpenTab`, `getUserPreferences`, `parseCustomKeybindings`,
  `setHostAutoTmux`, `getCookie`) and the connection helpers. They belong on
  the typed host bridge, which is also where B7's `app.logActivity` line
  above lands. Owner: D1.
- **B9 (ssh-terminal):** `OPKSSHDialog` is exported from
  `@termix/plugin-sdk/ui` so the terminal can show the opkssh sign-in. It
  leaves the ui entry when opkssh becomes a plugin that draws its own UI in
  `terminal.overlay`. Owner: Phase C (opkssh).
- **B9 (host-metrics):** the terminal toolbar's CPU/memory/disk bars
  (`TerminalMetricsStatus`) poll the local backend only; on the desktop app a
  host that lives on a connected remote server shows no bars. Same fix as the
  B7 remote-origin line above. Owner: D1.
- **B9:** the Hosts panel's "Terminal" feature filter was removed along with
  the column reads, the same as B7's tunnel filter. Owner: D1, with the
  generic host-settings filter.
- **B9:** the startup purge of expired open tabs in `db/index.ts` read
  `terminal_session_timeout_minutes` from core settings; it was removed and
  expired tabs are dropped when the tab list is read, against the terminal's
  own timeout (`GET /open-tabs/session-timeout`, 30 while the terminal is
  off). No owner unless the table growth matters.
- **Pre-existing (B8), found in B9:** `node scripts/check-shell-plugin-ids.cjs`
  fails on `src/ui/lib/host-to-ssh-host.ts` spelling `web-endpoint` (the
  `pluginSettings` lookup B8 added). Not allowlisted and not introduced here.
  Owner: D0 (read it through a registry or allowlist it with a reason).
- **B10 (tmux-monitor):** `enable_tmux_monitor` is still a live `ssh_data`
  column; only the copy-into-plugin-settings migration shipped
  (`tmux-monitor-settings-migration.ts`), the same as B6/B7's own columns.
  Every core read site (`host.ts`, `host-normalizers.ts`,
  `host-bulk-routes.ts`, `database.ts`'s encrypt/decrypt round trip) still
  reads the column directly. Dropping it in lockstep (`schema.ts`,
  `db/index.ts`, a drizzle migration per dialect, `schema:generate`) is the
  same follow-up the B6/B7/B8 lines above describe. Owner: a dedicated
  follow-up step, or D0.
- **B10 (tmux-monitor):** `terminalToolbar.openTmuxMonitor` and
  `terminalToolbar.tmuxDetach` are dead locale keys (nothing calls
  `t("terminalToolbar.openTmuxMonitor")` or `t("terminalToolbar.tmuxDetach")`
  anywhere in the tree; the terminal's own live detach button uses
  `terminalToolbar.detachTmux`/`detachTmuxDescription` instead). Pre-existing,
  not introduced by this step; sibling dead keys
  (`copyTerminalUrlAction`/`copyDockerUrlAction`/`copyHostMetricsUrlAction`,
  `terminalUrlCopied`/`dockerUrlCopied`/`hostMetricsUrlCopied`) are the same
  vintage, from before the generic `hosts.copiedToClipboard`/
  `copyViewUrlAction` replaced them. Owner: whoever next cleans up
  `src/ui/locales/en.json`, or D0.
- **B10 (tmux-monitor):** no plugin contributes an "Open Tmux Monitor" (or
  "Open Docker" / "Open Tunnel" / "Open Host Metrics") quick link into
  `terminal.toolbar` today; that whole quick-link row was dropped when the
  toolbar was rebuilt as a generic action slot (`ai` is the only real
  `terminal.toolbar` contributor, for its assistant button) and never
  replaced per-feature. Adding tmux-monitor's own link is straightforward
  (`app.registerSlotContribution("terminal.toolbar", ...)` plus
  `app.registerAction` opening the singleton tab) but is a shared gap across
  four plugins, not specific to this step. Owner: D1, or whoever revisits the
  toolbar's quick-link row.

## Manual checks after 2.9.0

- SSH terminal: password auth, key auth (and an encrypted key's passphrase
  prompt), TOTP keyboard-interactive, a jump host, Warpgate, split view,
  snippets sent to a terminal, reconnect after a network drop and after a
  page reload (session reattach), and the local terminal in the desktop app.
