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
- **B5 (proxmox):** `runAdaptivePolling` and `cn` are duplicated in
  `plugins/proxmox/src/frontend/stats/` rather than shared with core's
  `src/ui/lib/` originals. `useConnectionRetry` (the third duplicate B5 left
  here) is resolved: **B6** promoted it into `@termix/plugin-sdk/frontend`
  once file-manager became its fourth caller (after proxmox, docker,
  host-metrics, remote-desktop) and switched proxmox's own copy over too.
  `runAdaptivePolling` and `cn` are exported from `@termix/plugin-sdk/ui`
  now (B9), and host-metrics uses them there (B16); only proxmox's copies are
  left to switch. Owner: D1.
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
  `tunnelConnections` there is now stale. **B15** removed the "Docker" filter
  and the bulk Docker toggles the same way. Bringing these back needs a way for
  core to read and write host-scope plugin settings generically (keyed off
  `contributes.settings.host` or `hostCapability`) rather than per column.
  Owner: D1.
- **B7 (tunnels):** the tunnel tab no longer writes a recent-activity entry:
  `logActivity` is a core `@/main-axios` call and the plugin imports nothing
  from `@/`. Old "tunnel" entries still reopen the tab through the plugin's
  `activityTypes`. An `app.logActivity` (or equivalent bridge member) would
  restore it for this plugin and let file-manager drop its own
  `@/main-axios` import for it too (host-metrics and docker use the
  `logActivity` the ui entry exports). Owner: D1.
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
  **B14** gave remote desktop its own `enableToolbar` host setting, copied
  from `enable_terminal_toolbar`, so nothing else holds the column up. Drop
  all three the B14 way (see "Order at boot" in ARCHITECTURE.md). Owner: D0.
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
- **B11 (serial):** `plugins/serial/src/frontend/Serial.tsx` uses a small
  hardcoded light/dark xterm palette and a generic monospace font stack
  instead of the app's real terminal theme system
  (`resolveTermixThemeColors`, `DEFAULT_TERMINAL_CONFIG`, `TERMINAL_FONTS`,
  font loading), which is still core-only (`src/ui/features/terminal/`,
  `src/ui/lib/terminal-themes.ts`) and not yet exposed through the SDK. The
  serial console therefore does not match a user's chosen terminal theme or
  font. Promoting that system into `@termix/plugin-sdk/ui` is really
  ssh-terminal's own Phase B step's call to make (it is the plugin that
  currently owns the terminal component itself, per the "Known specifics"
  note above), so this line just points at the gap rather than building a
  premature shared surface for one caller. Owner: ssh-terminal's own Phase B
  step, or D1.
- **B11 (serial):** shipping a plugin's own native dependency (`serialport`)
  works for this repo's three bundled deployments only because they all
  install the whole npm workspace at once and copy/rebuild one shared
  `node_modules` - see "Native dependencies" in ARCHITECTURE.md for the full
  reasoning. A community plugin installed later from a tarball has no such
  shared `node_modules` to land in, so it cannot ship a native dependency the
  same way. No fix attempted here; the honest workarounds are listed in that
  section. Owner: whoever designs the 3.0.0 install flow (prebuild-per-platform
  packaging, or a documented "avoid native code" rule for community plugins).

- **B12 (session-sharing):** `allow_session_sharing` is still a live `ssh_data`
  column. The copy into the plugin's host setting shipped
  (`session-sharing-settings-migration.ts`) and nothing in core reads or
  writes it any more; drop it in lockstep (`schema.ts`, `db/index.ts`, a
  drizzle migration per dialect, `schema:generate`). Owner: D0.
- **B12 (session-sharing):** the legacy `session_sharing_globally_enabled`
  settings row is left in place for a release; nothing reads it. Delete it in
  3.0.0. Owner: D0 to decide.
- **B12 (session-sharing):** room audit lines go through `ctx.audit.record`,
  which records the actor but not the request's IP address and user agent the
  old `logAudit` calls carried. Adding those to `ctx.audit.record` would
  restore them. Owner: D1.
- **B12 (session-sharing):** the share button lives in the terminal and remote
  desktop toolbars now; the tab bar's share button is gone, so a host with the
  terminal toolbar switched off has no share button. A generic tab-menu slot
  would bring it back if that matters. Owner: D1, if wanted.
- **B13 (session-recording):** `enable_session_logging` is still a live
  `ssh_data` column; only the copy-into-plugin-settings migration shipped
  (`session-recording-settings-migration.ts`). The legacy default was `true`;
  the plugin's enable switch defaults to `false` like every other plugin's, so
  the migration copies every host's value rather than only the ones that
  turned it off - a fresh host created after 2.9.0 defaults to recording off,
  a real behaviour change from the old column default, made once here rather
  than silently. `ssh-terminal/src/backend/terminal-socket.ts` still reads
  `resolvedHostData?.enableSessionLogging ?? hostConfig.enableSessionLogging`
  off the resolved SSH host instead of `ctx.settings.getHost` (remote desktop
  asks `recordings.writer.enabledFor` since B14), and `HostEditorData.ts`,
  `HostManagerData.ts`, `quick-connect-host.ts` and the export/import sample
  all still read the column directly. The General tab's checkbox was removed
  from `HostEditor.tsx` (the schema-driven Plugins group replaces it); the
  data plumbing above was not switched over. Dropping the column in lockstep
  (`schema.ts`, `db/index.ts`, a drizzle migration per dialect,
  `schema:generate`) needs every one of those switched first. Owner: a
  dedicated follow-up step, or D0.
- **B13 (session-recording):** `accessId` (the legacy `access_id` column,
  referencing the now-core-only `host_access` table) is carried in the
  adopted table's shape as a plain unreferenced integer, since the SDK's
  `defineTable` has no builder for a foreign key into an arbitrary core
  table beyond `refUser()`/`refHost()`. Nothing has ever populated it (true
  in core before this step too). Owner: none needed unless a future step
  wants to actually use it.

- **B14 (remote-desktop):** the moved columns stay in the database, unused:
  `ssh_data.enable_rdp`, `enable_vnc`, `enable_telnet`, `rdp_port`,
  `vnc_port`, `telnet_port`, `rdp_security`, `rdp_ignore_cert`, `security`,
  `ignore_cert`, `guacamole_config`, and `user_preferences.rdp_defaults`.
  Their drizzle migrations are `SELECT 1;` on purpose (the copy runs after
  drizzle on Postgres and MySQL). Drop them physically in 3.0.0, once every
  install has booted 2.9.0. The legacy `guac_enabled` and `guac_url` rows in
  `settings` are left too. **B15** did the same with `ssh_data.enable_docker`
  and `docker_config` (copied by `docker-settings-migration.ts`). Owner: 3.0.0.
- **B14, found in B5 (proxmox):** `drizzle/postgres/0036_redundant_ender_wiggin.sql`
  and `drizzle/mysql/0035_clumsy_leech.sql` really `DROP COLUMN` the four
  proxmox host columns. On Postgres and MySQL that runs at boot before
  `runProxmoxSettingsMigration` copies them, so an upgrade there loses every
  host's Proxmox settings. Since nothing has shipped, rewrite those two files
  to the `SELECT 1;` pattern (keeping their journal entries). Owner: D0.
- **B14, found in B5 to B13:** every earlier host-column copy
  (`proxmox`, `file-manager`, `tunnels`, `web-endpoint`, `ssh-terminal`,
  `tmux-monitor`, `session-sharing`, `session-recording` settings migrations)
  reads the old columns with `getDb().all(sql...)`, which only exists on
  SQLite. On Postgres and MySQL the call throws, the migration's catch logs a
  warning and nothing is copied. Switch them to `selectRows` from
  `utils/crypto-migration/raw-rows.ts`, which B14 added and uses. Owner: D0.
- **B14, found in B13:** `session-recording-settings-migration.ts` writes
  `row.enable_session_logging !== false`, but SQLite returns `0`, so a host
  that had recording off migrates as on. Its test only uses real booleans.
  Owner: D0.
- **B14 (remote-desktop), for D2:** host payloads carry every plugin's host
  settings after the sharing sanitizers, so a connect-level recipient now
  receives remote desktop's `guacamoleConfig`, which can hold an RDP gateway
  password in plain text. A view-level recipient saw it before B14 too.
  Decide whether plugin host settings need a per-field sharing level, or make
  the gateway password its own secret field. Owner: D2.
- **B14 (remote-desktop):** core still holds some locale keys that look dead
  after this step but may be built dynamically: `hosts.guac.noCredential`,
  `authType*`, `recording*`, `saveHostFirst`, `sharingOptionsAfterSave`,
  `permissionLevel`, `typeHeader`, `targetHeader`, `permissionHeader`,
  `hosts.connectRdp/Vnc/Telnet`, `hosts.copy*UrlAction`, `hosts.telnet` and
  `homepage.connType_*`. Owner: whoever next cleans up `src/ui/locales/en.json`,
  or D0.
- **Pre-existing, found in B14:** `npm run test -w plugins/web-endpoint`
  fails "answers 503 while the tunnels plugin is not available": the route
  expects `ctx.services.get` to throw for a missing service, but since B12
  the runtime and the test doubles hand back an empty handle, so the route
  calls an undefined `forward` and answers 500. Check `typeof forward` the
  way remote desktop does. Owner: D0.
- **Pre-existing, found in B14:** each plugin's own `typecheck` script
  (`tsc -p tsconfig.json`) fails with the SDK's `tsconfig.plugin.json`
  (node16 resolution wants `.js` on relative imports and cannot resolve
  `@termix/plugin-sdk/ui`), workspaces included. `npm run type-check` covers
  plugins through `tsconfig.plugins*.json` and passes. Owner: D0.

- **B16 (host-metrics):** Termix-Mobile read `statsConfig` on each host
  (`statusCheckEnabled`, `enabledWidgets`) and the host status from the
  metrics API. The host payload now carries `statusCheckEnabled` and
  `statusCheckInterval` at the top level, the metrics options under
  `pluginSettings["host-metrics"]`, and statuses come from `GET /host/status`.
  The mobile app needs the matching change, or the host payload a
  `statsConfig` built from those fields for one release. Owner: D1.
- **B16 (host-metrics):** a host's status is only checked once its owner has
  asked for statuses (opened the app) since the server started: a user who
  only has a host shared with them sees no dot for it until then. This was
  already true before B16 (the first user to load the host list started
  polling for their own hosts only). Starting checks for the owners of every
  host a requester can see would fix it. Owner: D1.
- **B16 (host-metrics):** the host JSON export does not carry host-metrics's
  host settings (it did carry `statsConfig`); import reads both the old
  `statsConfig` and `pluginSettings["host-metrics"]` through the plugin's
  import normalizer. Same gap as the B7 line about exporting plugin host
  settings generically. Owner: D1.
- **B16 (host-metrics):** the CPU and network collectors keep their last
  sample per host in module-level maps (`widgets/cpu-collector.ts`,
  `widgets/network-collector.ts`) to compute rates. The poller clears them on
  deactivate and per host, so nothing leaks, but they are still module state
  rather than per-activation. Owner: D1.
- **B15 (docker), for D2:** the console socket `/plugin-ws/docker/console`
  is a public route with `optionalAuth`. The handler refuses a socket with no
  signed-in user or without `docker.use` and checks the data key per connect
  message, but review it with the rest of the public routes.
- **B15 (docker):** `ssh_data.show_docker_in_sidebar` (and its siblings for
  terminal, files, tunnels and server stats) are dead columns nothing reads;
  only the raw database export still copies them. Drop them the B14 way.
  Owner: D0.
- **B15 (docker):** the Docker manager's card or table layout is still an
  override on core's Appearance presets (`types/ui-preferences.ts` declares a
  `docker` area, as it does `hostMetrics`), reached through the ui entry's
  `useAreaPreferences` and `useUiPreferencesContext`. A plugin cannot declare
  its own area yet. Owner: D1.
- **B15 (docker):** the raw SQLite database import (`database.ts`) no longer
  brings `enable_docker` across, the same gap every earlier column move left
  there: it writes host rows only and never plugin settings. Owner: D1, with
  the generic host-settings export and import.

- **B17 (automations), for D2:** the ctx table says `ctx.events.on` needs
  `events:core` for core topics, but the runtime only checks `emit`.
  docker, file-manager, host-metrics, session-recording and snippets
  subscribe to core topics (`host.*`, `user.*`) without declaring it.
  Either gate `on` and add `events:core` to those five, or change the doc to
  say subscribing is ungated. Owner: D2.
- **B17 (automations):** the 2.8 webhook URL `/automations/webhook/<token>`
  is kept only by a rewrite in `docker/nginx.conf` and
  `docker/nginx-https.conf`. An install that serves the backend without
  nginx (the desktop app's embedded backend, a hand-rolled proxy) answers
  404 there. Decide whether that matters enough for a generic legacy-path
  alias in the plugin HTTP layer. Owner: D0.
- **B17 (automations):** there are two notification senders now:
  `deliverNotification` (ctx.notify, per-channel private opt-in, throws) and
  the older `sendWebhook`/`sendNtfy`/`sendDiscord` that the channel "test"
  route in `notification-channels-routes.ts` still uses (always applies the
  allowlist, retries once). Point the test route at `deliverNotification`
  and delete the old ones. Owner: D1.
- **B17 (automations):** the scheduler no longer skips a user whose data key
  cannot be resolved (`DataCrypto.canUserAccessData` has no SDK equivalent).
  With system-wrapped DEKs that check was effectively always true; if it
  ever is not, the run now fails on its first SSH step instead of being
  skipped silently. Owner: none unless a background "is this user unlocked"
  check is added to the SDK.
- **B18 (ai):** the "allow read-only diagnostic commands" user setting only
  adds a line to the system prompt. No tool runs a command directly;
  `tools/command-allowlist.ts` (`isReadOnlyCommand`) is tested but unused, so
  every command is still a proposal. Either add the direct tool or drop the
  setting. Owner: D0.
- **B18 (ai):** provider requests now go through `ctx.fetch`, which has no
  outbound proxy support. Before, an admin-allowlisted private provider went
  through `fetchWithProxy` (public ones never did). Decide whether
  `ctx.fetch` should honour the proxy settings. Owner: D0.
- **B18:** `scripts/generate-dialect-schema.cjs` decides varchar or text by
  column name across every table, so removing the ai indexes on
  `created_at`, `updated_at` and `label` turned those columns into `text`
  everywhere in `schema.pg.ts` and `schema.mysql.ts`. drizzle-kit then wrote
  about a hundred type changes, which B18 left out of
  `drizzle/postgres/0048` and `drizzle/mysql/0047` (both a no-op), so real
  databases keep `varchar(255)` while the snapshots say `text`. Key the
  generator per table, regenerate, and check `verify:dialect`. Owner: D0.
- **B18:** saving a plugin setting from the Settings screen tells nobody. The
  ai frontend re-reads its status on `termix:plugins-changed` and on window
  focus (throttled to 30 seconds), so an admin turning it on shows up on the
  next focus. A settings-changed hook on the app object would be cleaner.
  Owner: D1.
- **B18:** tunnels builds its own SSE URL off the axios base instead of the
  new `app.fetch`. Owner: D1.

- **Pre-existing, found in B19:** `createMockCtx`'s `wsRoutes` double (B15)
  records `{ path, raw, handler, options }` per route, but
  `plugins/serial/tests/backend/activate.test.ts`,
  `plugins/ssh-terminal/tests/backend/activate.test.ts` and
  `plugins/tunnels/tests/backend/activate.test.ts` still assert the old
  two-field shape (`{ path, raw }`) and fail on `toEqual`. Not touched by
  this step; update each assertion to match or to check only the fields it
  cares about. Owner: D0.
- **Pre-existing, found in B19:** `src/backend/hosts/file-manager/` (21
  files) is dead code left over from before the file-manager plugin (B6):
  nothing in `src/backend/starter.ts` or elsewhere imports
  `hosts/file-manager/index.ts`, so its own port (30004, still listed in
  `src/backend/utils/swagger.ts`'s server list) never actually starts and
  its `axios.post("http://localhost:30006/activity/log", ...)` calls (now a
  dead port after this step) never run. Delete the directory once confirmed
  nothing else references it. Owner: D0.
- **Pre-existing, found in B19:** `src/ui/main-axios.ts`'s `tmuxMonitorApi`
  still points at `getApiUrl("/tmux_monitor", 30010)`, a port tmux-monitor's
  own B10 step moved off of (per `plugins/tmux-monitor/CHANGELOG.md`) without
  updating this frontend constant to `/plugin-api/tmux-monitor`. Not
  something this step touched or verified further. Owner: D0.
- **Pre-existing, found in B20:** `npm run test:plugins` fails on three tests
  unrelated to wake-on-lan or secret-sources: `ssh-terminal` and `tunnels`
  both assert `mock.wsRoutes` equals `[{ path, raw }]`, but the mock now also
  carries `handler` and `options` (added for **B15**'s doubles, per the
  contract's "Tests" section), so the exact-equality assertion fails; and
  `web-endpoint`'s "answers 503 while the tunnels plugin is not available"
  test gets 502. Confirmed present on `dev-2.9.0` before this step (checked
  by stashing B20's changes and re-running). Owner: D0.
- **C1 (totp):** `totp-migration.ts` moves a user's TOTP secret only when
  their data key opens at boot. A 2.8 user whose key is still a pre-2.5.1
  password wrap keeps their enrolment row (fail closed) but has no secret in
  `p_totp_enrollments` until a boot after their next password login migrates
  the key, so that one login fails at the TOTP step. Likewise, enabling the
  totp plugin for the first time without a restart does not move secrets
  until the next boot. Decide whether either needs handling (a migration run
  on plugin activation, or an admin reset message). Owner: D0.
- **C1 (totp/webauthn):** the `users` columns `totp_secret`, `totp_enabled`
  and `totp_backup_codes` stay in the database (dropped from `schema.ts`, the
  drizzle drop is a no-op) until 3.0.0 removes them, after the boot
  migration has run everywhere. Owner: 3.0.0.
- **C2 (sso/ldap):** `users.is_oidc`, `oidc_identifier`, `sso_provider_id`
  and the 2.8 per-user OIDC columns (`client_id`, `issuer_url`, ...), and
  `sessions.sso_provider_id`, `oidc_sub`, `oidc_sid`, stay in core. Core
  still reads `is_oidc`/`oidc_identifier` for account linking, `/users/me` and
  the `$oidc.preferred_username` placeholder, and still writes them from an
  identity's `legacy` field so a downgrade works. Rename or drop them once
  nothing needs the 2.8 shape. Owner: 3.0.0.
- **C2 (sso/ldap):** `database/routes/auth-compat-routes.ts` keeps the 2.8
  URLs (`/users/oidc/*`, `/users/oidc-config`, `/users/sso-providers`,
  `/users/ldap/login`) and so names the `oidc`/`ldap` method ids and the sso
  plugin's `/plugin-api/sso/` paths. Keep until identity providers have moved
  to the new redirect URI and Termix-Mobile uses `/users/auth/*`. Owner:
  3.0.0.
- **C2 (sso):** the `oidc_auto_provision` and `oidc_silent_login_default`
  settings, their routes and admin toggles are generic (every external
  method, every redirect method) but still carry OIDC in their names and
  i18n. Rename with a settings migration if wanted. Owner: D0.
- **Unrelated, found in C2:** `node scripts/check-shell-plugin-ids.cjs`
  fails on `src/ui/lib/host-to-ssh-host.ts` naming `"web-endpoint"`
  (`h.pluginSettings?.["web-endpoint"]`). The file is untouched since before
  C2. Owner: D0.

- **C3 (opkssh), C4 (step-ca):** `database/routes/host-compat-routes.ts`
  answers the 2.8 redirect URIs `/host/opkssh-callback` and
  `/host/step-ca-callback` with a 307 to the plugins and so names their
  paths. Keep it until identity providers have moved to
  `/plugin-api/opkssh/callback` and `/plugin-api/step-ca/callback` (each
  plugin's admin page shows it, and its `legacyCallback` setting switches
  over). Owner: 3.0.0.
- **C3 (opkssh/warpgate):** `ssh_data.use_warpgate` and the `.opk` folder
  under `DATA_DIR` stay on disk, unused (the drizzle drop is `SELECT 1;`, the
  config is copied, not moved). Remove them in 3.0.0. Owner: 3.0.0.
- **C3 (opkssh):** the Termix docs still describe `DATA_DIR/.opk/config.yml`
  and `/host/opkssh-callback`. They need the new config path
  (`DATA_DIR/plugins/opkssh/config.yml`), the new redirect URI and the
  `legacyCallback` setting. Owner: D0 (docs repo).
- **C3 (warpgate):** Termix-Mobile's file manager and docker clients call
  `/ssh/connect-warpgate` and read `requiresWarpgate`; the plugins answer
  `connect-browser-sign-in` and `requires_browser_sign_in` now (both clients
  were already on paths B6 and B15 moved). The terminal socket keeps
  `warpgate_auth_required` / `warpgate_auth_continue`. Owner: D1, with the
  rest of the mobile client changes.
- **C3:** `host-bulk-routes.ts` still validates imported auth types against a
  fixed list that names plugin types (`opkssh`, `stepca`, `tailscale`,
  `vault`), and the host create/update routes no longer accept a
  `useWarpgate` field inline (the host editor sends plugin settings). The
  bulk list should come from the registered providers plus
  `contributes.auth.sshAuthTypes`. Owner: D1.
- **C4 (step-ca):** the 2.8 `step_ca_url`, `step_ca_fingerprint`,
  `step_ca_provisioner` and `step_ca_private_endpoint_allowlist` rows stay in
  core `settings`, unused, after `step-ca-settings-migration.ts` copies them
  (kept for one release so a downgrade works). Delete them in 3.0.0.
  Owner: 3.0.0.
- **C4 (step-ca):** the admin fields are plain settings now, so a bad CA URL
  or fingerprint is reported when someone signs in (in the terminal dialog)
  instead of when the admin saves, as the 2.8 route did. A settings
  validation hook for plugins would bring the save-time check back.
  Owner: D0.
- **C4 (step-ca):** the Termix docs still describe Step CA under Admin
  Settings and the `/host/step-ca-callback` redirect URI. They need the
  plugin settings page, the new redirect URI and the `legacyCallback`
  setting. Owner: D0 (docs repo).
- **Pre-existing, found in C3:** the Docker `opkssh-downloader` stage's
  `OPKSSH_VERSION` build arg is not passed on at runtime, so building with
  another version gives a prebaked binary the plugin's pinned checksum
  rejects (it then downloads the pinned version instead). Pass
  `OPKSSH_VERSION` and the matching `OPKSSH_SHA256` as `ENV` in the final
  stage. Owner: D0.

## Manual checks after 2.9.0

- SSH terminal: password auth, key auth (and an encrypted key's passphrase
  prompt), TOTP keyboard-interactive, a jump host, Warpgate, split view,
  snippets sent to a terminal, reconnect after a network drop and after a
  page reload (session reattach), and the local terminal in the desktop app.
- Serial: the Electron backend path against a real device path/COM port, and
  the Web Serial browser picker in Chrome or Edge.
- Session sharing: a link share (read-only and read-write) opened in a private
  window, a user share joined from Active Connections, revoke and "end for
  everyone", and a collab room with two members, control hand-off, a guest
  link, rotate and end.
- Session recording: an SSH session recorded end to end (playback matches what
  happened, including a resize mid-session), a host with recording switched
  off records nothing, retention prunes an old recording on schedule, a guacd
  RDP/VNC/Telnet recording still gets a row and plays back, and deleting a
  user anonymizes their recordings instead of removing them.
- Host status and metrics: on a 2.8 database, hosts whose status checks were
  off stay off and a custom interval survives; the host list dot goes
  reachable, then online once the Host Metrics tab or a terminal logs in;
  an RDP-only host on a custom port shows online; the metrics tab, the
  dashboard host bars, the homepage host status widget, the metrics chart
  widget, the terminal toolbar bars and the file manager's disk bar; a
  manager card (services, packages) and a health check; TOTP on the metrics
  connect; the admin metrics interval, history retention and new-host default;
  the temperature unit; disabling host metrics leaves every other plugin's
  SSH working, then enabling it again.
- Remote desktop: an RDP, a VNC and a Telnet host; a host behind one jump
  host (tunnels plugin on and off) and behind a chain of two; macOS Screen
  Sharing over VNC with no username; RDP recording (and none with
  session-recording off or the host's switch off); file transfer through the
  RDP drive, drag and drop included; clipboard both ways; sharing an RDP
  session by link (read-only and read-write) and presenting it in a collab
  room; opening Windows Remote Desktop from the desktop app on Windows;
  changing the guacd URL in admin settings without a restart; turning Remote
  Desktop off in admin (actions disappear, connects answer 403); a 2.8 host
  that only had `connection_type = rdp` comes up as RDP with SSH off; RDP user
  defaults apply to a saved host; Quick Connect over RDP and VNC; the desktop
  app with a host on the remote server and one on This device.
- Docker: a 2.8 host with Docker on (and one on Podman) keeps its switch and
  runtime; list, start, stop, logs, stats and the console on a Linux host;
  TOTP (including a wrong code first) and Warpgate on the connect; a host
  with no stored password asks for credentials; the homepage Docker widget;
  an automation Docker step and a `docker_event` trigger; disable Docker with
  a console open, then enable it and open another.
- Automations: on a 2.8 database the automations, their run history and
  their channel links are there; a schedule fires; a webhook fires on both
  `/plugin-api/automations/webhook/<token>` and the old
  `/automations/webhook/<token>`; a metric threshold on a host nobody has
  open still fires (headless viewers); a `docker_event` trigger and a Docker
  step; a notify step to webhook, ntfy and Discord channels, and to a LAN
  ntfy with the private opt-in plus the admin allowlist; disable Docker and
  the automation shows "Needs docker", its scheduled runs are recorded as
  skipped and the others keep running, then enable it again; the AI
  assistant lists and creates automations, and says they are unavailable
  with automations off.
- Homepage: on a 2.8 database every widget, its layout and every service
  link are there; add, move, resize, edit and delete a widget of each type;
  the favicon, RSS, ping and custom API widgets against a real remote URL,
  and each refuses a private/loopback target; the dashboard's Service
  Links and Homepage Preview cards; the Dashboard/Homepage toggle and its
  copy-link and open-full-view buttons; `?view=homepage`; docker's, tunnels'
  and file-manager's own homepage widgets still work with the homepage
  plugin disabled; the AI assistant lists homepage items and says
  unavailable with homepage off; disable homepage in admin (the tab, its
  dashboard cards and the toggle disappear) then enable it again.
- TOTP and passkeys: on a 2.8 database a TOTP user is still asked for a
  code (and a backup code works once); set up TOTP from Settings > Security,
  add a second device, regenerate backup codes, disable it; enabling signs
  out other sessions; "remember me" skips it next time; disable the totp
  plugin and a TOTP user's login is refused until an admin resets their
  factors; register a passkey, sign in with it with and without a PIN (no
  PIN still asks for TOTP), delete it; existing 2.8 passkeys still sign in.
- SSO and LDAP: on a 2.8 database every SSO provider and LDAP directory is
  there, in Settings > Plugins > Single sign-on and > LDAP; an existing
  provider still signs in through its identity provider without changing
  anything there (its redirect URI shows `/users/oidc/callback`); add the
  new redirect URI at the provider, switch it over and sign in again; a new
  provider, GitHub and Google; an existing SSO user and an existing LDAP
  user land in their old accounts; the env-configured provider; admin group
  and role map; back-channel logout from Keycloak ends the session; the
  desktop app's system browser login and Termix-Mobile's login; silent
  sign-in; a second factor after an external login with the admin setting
  on and off; disable each plugin and its buttons go away and its URLs stop
  signing anyone in, then enable it again.
- OPKSSH and Warpgate: on a 2.8 Docker install with OPKSSH set up, the config
  shows up under the plugin, the admin page shows the old redirect URI and a
  terminal sign-in to an OPKSSH host works through the provider chooser
  without touching the identity provider; switch to the new URI, register
  it and sign in again; a second connect within 24 hours skips the browser;
  an offline Docker install uses the baked binary; disable the opkssh plugin
  and the host says it needs it. A Warpgate host's toggle is on in the host
  editor's Plugins group after the upgrade, and the terminal, file manager
  and docker each show the sign-in dialog and connect after it.
