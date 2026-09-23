# Termix plugin architecture

This is the contract between Termix core and a plugin. It is the reference for
anyone writing a plugin and the specification the runtime in
`src/backend/plugins/` implements.

Status: the redesign lands across several steps. Everything marked **A1** is
built today. Later markers name the step that delivers the rest. Phase B
converts one feature per step by following
[Converting a feature into a plugin](#converting-a-feature-into-a-plugin).

---

## The shape of it

### 1. One tier

Every plugin, official or community, runs in-process in the Termix server and
in the browser. There is no first-party allowlist, no worker tier, and no
special case keyed on a plugin id anywhere in core.

This is not a sandbox. See [What this protects](#what-this-protects-and-what-it-does-not).

### 2. SDK only

A plugin imports `@termix/plugin-sdk`, its own files and its own npm
dependencies. Entry points:

| Entry                              | Contents                                                   |
| ---------------------------------- | ---------------------------------------------------------- |
| `@termix/plugin-sdk/backend`       | `PluginContext`, `definePlugin()`, `PluginCapabilityError` |
| `@termix/plugin-sdk/db`            | `defineTable()`, the column builders, the legacy-table map |
| `@termix/plugin-sdk/ddl`           | The per-dialect DDL emitter, shared with the CLI           |
| `@termix/plugin-sdk/table-builder` | `buildTable()`, a definition as a queryable Drizzle table  |
| `@termix/plugin-sdk/frontend`      | The `app` object types, the hooks, `invokeAction()`        |
| `@termix/plugin-sdk/ui`            | Core's shared components, a fixed public list (see UI)     |
| `@termix/plugin-sdk/manifest`      | Manifest types, validation, the JSON schema                |
| `@termix/plugin-sdk/capabilities`  | The capability catalog                                     |
| `@termix/plugin-sdk/settings`      | Settings field types and the shared value validator        |
| `@termix/plugin-sdk/testing`       | Test helpers: `createMockCtx()`, `createTestDb()` and more |

Plugins never import from `src/` or `@/`, and core never imports from
`plugins/`. Anything a plugin needs from core becomes a typed, documented SDK
API. Enforced by lint, with the exceptions recorded under
[legacy core imports](#legacy-core-imports-the-debt-d1-removes).

The SDK holds the contract: types, the catalog, and pure helpers. The ctx
implementation lives in core (`src/backend/plugins/ctx.ts`) and is injected at
activation, so a plugin cannot reach around it.

### 3. Capabilities are what a plugin's code may do

Declared in the manifest's `capabilities` array using `domain:action` names
from one catalog in the SDK. Every privileged SDK call checks the capability
and writes an audit line naming the plugin and the acting user.

Two things must both be true, and a grant for something the manifest never
declared is ignored rather than honoured:

1. the manifest declares it, and
2. it is granted in `plugin_permission_grants`.

That means widening a plugin's reach always requires a new manifest the user
can see. In 2.9.0 bundled plugins are granted everything they declare
automatically, with `source: "bundled"`.

Adding a capability is one catalog entry (id, risk, i18n title and consequence
text) plus the SDK method that checks it.

### 4. User permissions are what a user may do

These stay in core RBAC and keep their dotted spelling (`hosts.view`), so they
can never be confused with colon-separated capabilities.

**A5 delivered this.** A plugin declares short names in
`contributes.permissions`, and core registers each as `<pluginId>.<name>`. The
plugin never writes the prefix, so it cannot claim a core group or another
plugin's namespace: `parseManifest` refuses a name starting with `hosts`,
`snippets`, `credentials`, `admin` or the plugin's own id, and the runtime
re-checks against every namespace already in the catalog, because the validator
cannot know which other plugins exist.

The ids are unchanged by the move. `ai` + `use` is `ai.use`, which is exactly
what the core catalog held before, so no role had to be migrated when `ai.*` and
`automations.*` left `PERMISSION_CATALOG` and `SYSTEM_ROLE_DEFAULTS`.

**A permission outlives its plugin.** Core records every id it has ever
registered in `rbac_known_permissions`, loaded at boot before any request is
served and backfilled from what roles already hold. Disabling a plugin now only
marks its group `enabled: false`: the group stays in the catalog so the role
editor can grey it, and `PUT /rbac/roles/:id` keeps accepting it. Previously the
group was unregistered outright, so an admin could not save _any_ change to a
role that still held one of these while the plugin was off. A permission nobody
has ever registered is still rejected.

**Defaults apply once.** `defaultRoles` names the seeded system roles (`admin`,
`user`) and nothing else. Each application is recorded in
`rbac_applied_defaults`, a core table with no foreign key to `plugins`, so an
admin who revokes a default does not get it handed back on the next boot or by
reinstalling the plugin. That ledger used to live in `plugin_storage`, which
cascades with the plugin row.

Both tables are deliberately unlinked from `plugins`: the whole point is
surviving the plugin being gone.

`ctx.rbac` is the plugin-side view: `has(permission)` for the current actor,
`hasFor(userId, permission)`, and `require(permission)` as route middleware. All
three resolve a bare short name against this plugin's prefix and take a full id
belonging to a core group or another plugin as given, which is what makes a
cross-plugin check expressible. `require` additionally refuses anything the
plugin does not declare itself, at registration time, and denies with the same
`401`/`403` bodies `requirePermission()` sends.

### 5. Data

Plugins own their tables. A plugin declares them with `defineTable()` from
`@termix/plugin-sdk/db` and ships migrations for `sqlite`, `postgres` and
`mysql` under `migrations/<dialect>/NNNN_name.sql`. Table names are prefixed
`p_<id with - as _>_`, which `defineTable` adds. `ctx.kv` is for small
key/value state. Core `schema.ts` ends up holding only core tables.

**One table object, three DDL emitters.** The sqlite-core definitions already
encode correctly on every engine at query time, which is why core's own 44
repositories use `schema.ts` on all three. Only DDL genuinely differs, and
that mapping lives in `@termix/plugin-sdk/ddl` so `termix-plugin migrations`
and the server's runner cannot drift into disagreeing.

**MySQL cannot index TEXT.** Any column carrying a key becomes
`varchar(255)`, and `defineTable` refuses an index on `text()` or `json()`
outright rather than silently truncating it.

**Migrations are applied at activation**, before `activate()` runs, so a
plugin's first query never meets a missing table. Applied migrations are
recorded in `plugin_migrations` with a checksum, which makes them immutable:
editing one that already ran blocks that plugin rather than leaving two
installs with quietly different schemas. A migration that throws marks its
plugin failed and core keeps booting.

**Adoption** is how a feature keeps its rows when it moves out of core. The
legacy table is renamed into the plugin's namespace
(`user_workspaces` -> `p_workspaces_workspaces`) rather than copied, so nothing
is duplicated and no row is migrated one at a time. `LEGACY_TABLE_OWNERS` maps
each legacy table to the one plugin allowed to adopt it, enforced by
`adoptLegacyTable`, by the CLI at build time and by the runner at activation,
because a plugin installed from a tarball never ran the CLI.

A plugin marks a definition with `adoptLegacyTable("user_workspaces",
defineTable(...))` and `termix-plugin migrations` writes the adoption for all
three dialects. A plain SQL file cannot ask whether the legacy table exists, so
the migration creates it when it is missing (a fresh install), creates the
definition's indexes on it with `IF NOT EXISTS`, and then renames it. Both
paths end with the same table. Two rules follow:

- **Keep the legacy column and index names** in the definition. The rename
  carries the old indexes across, and a matching name is what makes
  `IF NOT EXISTS` skip them instead of adding a second copy.
- **MySQL gets no index statements** in an adoption, because it has no
  `CREATE INDEX IF NOT EXISTS`. That is safe for every legacy table core ever
  shipped to MySQL, since core's drizzle migrations already created its indexes.

A MySQL `TEXT` column cannot take a literal default, so the emitter writes one
as an expression (`DEFAULT ('{}')`), the way it already did for
`CURRENT_TIMESTAMP`.

**Write through `ctx.db.client()`, then call `ctx.db.persist()`.** On SQLite the
database lives in memory and reaches its encrypted file only when something
asks, which core's repositories do after every write. A plugin write that skips
`persist()` can be lost on restart. It is a no-op on Postgres and MySQL, needs
`db:own`, and is not audited, because it follows a `client()` call that was.
`ctx.db.dialect` says which engine is running. The table object encodes the
same on all three, but MySQL has no `RETURNING`, so portable code reads a new
row back by a key it chose (a sync id) rather than relying on `.returning()`.

**Anything DDL-only in `db/index.ts` is SQLite-only.** `alert_rules`,
`alert_rule_channels` and `alert_firings` were created only there and never
declared in `schema.ts`, so they never existed on Postgres or MySQL at all.
Automations replaced them and A3 drops them. A core table needs all three
artifacts in lockstep: the `schema.ts` declaration, the `index.ts` DDL, and the
regenerated `schema.pg.ts`/`schema.mysql.ts` plus drizzle migrations.

**Sync entities are registered, not hardcoded.** `ctx.sync.registerEntity`
adds an entity to remote sync; core registers its own ten the same way in
`database/routes/sync-entities.ts`. The wire names are unchanged, because
existing tombstones and rows on the far side match on those strings. The
Electron client asks the server for the ordered list and falls back to its
frozen array for a server that predates the endpoint.

`shouldSync(row)` leaves rows out in both directions: they are not pulled, and
a push, update or tombstone aimed at one is refused with 400. It exists for
state that belongs to one install, such as the workspaces plugin's "Last
Session" row, which would otherwise leave a user with one from each side.

### 6. HTTP and WebSockets

Plugin routes live under `/plugin-api/<id>/` and sockets under
`/plugin-ws/<id>/<path>`, served by the main backend with core auth. No plugin
gets its own port or nginx block.

**A4 delivered this.** A plugin calls `ctx.http.router(options)` and gets an
Express Router core mounts at `/plugin-api/<id>/`, or `ctx.ws.route(path,
handler)` for a socket. Core runs the same middleware in front of every plugin:

1. **Auth**, unless the path is listed in `options.public`. A public path is
   audited when the router is registered and logged on every request, because
   "this plugin opened a hole in auth" should be findable later. It matches the
   full path, with `:param` segments allowed, so declaring `/webhook/:token`
   public cannot open `/webhook/:token/anything`.
2. **The actor**, from the user core authenticated, never from the request body.
3. **An enabled check** returning 503 while the plugin is disabled. That is a
   different fact from 404 ("no such plugin") and a caller can act on it.
4. **Body limits**, defaulting to the 2mb core itself accepts. `database.ts`
   skips its own global parser for `/plugin-api` so a plugin's `bodyLimit`
   actually applies; `rawBody` turns the parsers off for a router that parses
   its own (multer, a raw body for signature checks).
5. **An error wrapper** that logs against the plugin, never leaks a stack, and
   feeds the error budget.

`ctx.rbac.require(permission)` adds a per-route RBAC gate, and a plugin may only
require a permission it declares itself.

Both surfaces need `network:serve`. The declaration is checked when the router
or route is created; the **grant** is checked per request and per upgrade,
because it lives in the database and `router()` has to be synchronous. A revoked
grant therefore takes effect on the next request without a restart: HTTP answers
403, an upgrade is refused 403.

Sockets are served from the main server's `upgrade` event, on both the HTTP
server and the direct HTTPS one. Auth is the same `utils/ws-auth.ts` path every
other Termix socket uses, and a token still awaiting TOTP is refused exactly as
it is for HTTP. Binary frames and backpressure are untouched. Everything a
plugin registered is disposed on deactivate, and live sockets are **closed**,
not merely unrouted: a terminal session must not outlive the plugin that owns it.

`ctx.ws.upgrade(path, handler)` hands over the raw upgrade, after core has
authenticated it, for a library that insists on owning its own WebSocketServer.
guacamole-lite is why it exists. Three routes are public because they
authenticate themselves in a way core cannot: the terminal (a share-link guest
arrives with a share token), the Docker console (per-message auth), and the
Guacamole display (a single-use encrypted connection token in the query, minted
by an authenticated route).

### 7. Settings

Plugins declare settings fields in the manifest with scope `admin`, `user` or
`host`. Core renders them from the schema, stores values in `plugin_settings`,
and encrypts secret fields.

**A6 delivered this.** A field is `{ key, type, labelKey, ... }`, with types
`boolean`, `string`, `number`, `select`, `multiselect`, `secret`, `textarea`,
`json` and `custom`. `requires` names a boolean in the same scope that gates
it, `group` is a section heading, and `permission` is who may write it: admin
fields fall back to `admin.plugins.manage`, and a short name resolves against
the plugin's own permissions exactly as `ctx.rbac` does.

`type: "custom"` names a component the frontend registered, for the few things
a schema cannot express (a device browser, a provider list). It is deliberately
narrow: a plugin supplies data everywhere else, so it cannot ship its own form
styling and drift from the rest of the app, and a page disappears cleanly when
its plugin does.

**One service, two callers.** `src/backend/plugins/settings.ts` is behind both
`ctx.settings` and the HTTP routes, so validation, encryption and redaction are
decided once. Two implementations would drift, and the one that drifted would
be the one writing to the database.

**The manifest is the schema.** A read is driven by the declared fields, not by
the stored rows: an unwritten field comes back with its `default`, and a row
for a field the plugin has since dropped is ignored rather than handed to the
UI. A write to a key the manifest never declared is refused, which is what
stops a PUT from filling a plugin's namespace with arbitrary keys.

**Secrets never leave the server.** A `secret` field is encrypted with
`encryptSystemSecret` (the installation key, not a user DEK: these have to be
readable before any user is unlocked) and every HTTP read replaces it with
`{ set: boolean }`. Sending that marker back is a no-op, so saving a form
cannot clear a key it was never shown. Clearing one writes null rather than an
encrypted empty string, so it reads back as unset.

**Storage.** `plugin_settings(plugin_id, scope, scope_id, key, value,
encrypted, updated_at)`, unique on the first four. `scope_id` is null for
admin, a user id for user and a host id as text for host. It is polymorphic, so
it carries no foreign key and the engine cannot cascade it: `UserRepository`
and `HostRepository` delete these rows explicitly, with tests that fail if
those calls ever go. The foreign key to `plugins` is real, so uninstalling
leaves nothing.

**Routes**, all with core auth: `GET|PUT /plugins/:id/settings/admin`
(`admin.plugins.manage`, or the field's own permission), `/settings/user`
(always the caller, never a user id from the body) and
`/settings/host/:hostId` (needs edit access to that host). A rejected PUT
returns `400 { errors: { <key>: message } }` per field, so a form shows every
problem at once.

**Host payloads carry them.** Host list and get responses include a
`pluginSettings` map, enabled plugins only and secrets redacted, built in one
query for the whole list rather than one request per plugin per host. It is
attached after the sanitizers, because the connect-level projection of a shared
host reduces it to an allowlist.

`ctx.settings` is `get/set`, `getUser/setUser`, `getHost/setHost`, `getAll`,
`onChange` (disposed with the plugin) and `readCore`. **Reading and writing a
plugin's own settings needs no capability**: the manifest already declares
every field, and a plugin that had to ask permission to read its own
configuration would be useless. Only `readCore`, which reaches outside the
plugin's namespace, is gated on `settings:read-core`, and it serves a short
allowlist (`CORE_SETTINGS_ALLOWLIST`) rather than the whole settings table.

### 8. UI

A plugin frontend is a built ESM bundle, `dist/frontend.js`, exporting
`activate(app)` and optionally `deactivate()`. The shell has no plugin ids and
no imports from `plugins/`; everything a plugin shows goes through the `app`
object. `scripts/check-shell-plugin-ids.cjs` (run by lint) fails on a quoted
plugin id in `src/ui` outside tests, apart from the entries in
`scripts/shell-plugin-id-allowlist.json`, each with a reason (host protocol
data like `rdp`, which Phase B moves).

#### The loader

`src/ui/plugin-host/loader.ts` runs after login and again whenever plugin
state may have changed: the `termix:plugins-changed` window event (the admin
toggle fires it) and window focus, throttled to 30 seconds. There is no push
channel yet. Each pass:

1. Fetches `GET /plugins` (`frontend`, `css`, `assetVersion`, `locales`,
   `dependencies` and `contributes` per plugin).
2. Loads every plugin's locales into the i18next namespace `<id>`, enabled or
   not, because the role editor and the plugin list need disabled plugins'
   titles.
3. Orders enabled plugins by dependencies. A plugin whose hard dependency is
   missing or off is skipped.
4. For each plugin with a frontend: injects `frontend.css`, imports
   `/plugin-assets/<id>/frontend.js?v=<assetVersion>` and calls `activate(app)`.
   In dev the workspace plugins are imported from
   `plugins/<id>/src/frontend/index.tsx` through Vite, so HMR works.
5. Deactivates plugins that went away: runs `deactivate()` then every
   disposer. No reload.

A plugin that throws while importing or activating is marked failed, its
partial registrations are disposed, and the rest of the app carries on. The
same `assetVersion` is not retried until it changes.

Anonymous shared-session and collab pages have no session. They load only
plugins whose manifest sets `contributes.guest: true`, from the public
`GET /plugins/public`, and `app.guest` is true there.

The login screen runs a smaller pass before anyone signs in: it activates only
enabled plugins that contribute `loginMethods` or `secondFactors`, listed by
the public `GET /plugins/public-manifest`. They stay active after login, and
the full pass does not load the same bundle twice. See Auth below.

#### Shared modules and the import map

A bundle keeps `react`, `react-dom`, `react-dom/client`, `react/jsx-runtime`,
`i18next`, `react-i18next`, `sonner`, `@termix/plugin-sdk/frontend`,
`@termix/plugin-sdk/ui` and `@termix/legacy-core/*` as bare imports. Core's
Vite build (`scripts/vite-plugin-termix-plugins.mjs`) emits one entry per
shared module, writes a stable unhashed shim for each at
`dist/shared/<name>.js`, and injects an import map into `index.html` mapping
the bare names to those shims. In dev the map points at Vite's virtual
modules instead. The map is inline, so both nginx configs allow it by hash in
`script-src`; `scripts/check-importmap-csp.cjs` (run by lint) fails when the
hash is out of date and `--write` updates it. The map changes only when the
list of shared modules does, which includes the legacy-core modules plugins
import.

Electron loads `index.html` from `file://`. The map uses relative URLs, and
plugin bundles come from the embedded backend
(`http://localhost:30001/plugin-assets/...`), which is why `/plugin-assets`
sends `Access-Control-Allow-Origin: *`.

#### Serving bundles

`GET /plugin-assets/<id>/<path>` serves the directory holding a plugin's
frontend bundle and its `locales/` directory, nothing else: never
`backend.js`, never a path outside those two, only `.js`, `.css`, `.json` and
`.map`. It is unauthenticated like `/assets`, since `import()` cannot send the
bearer header and bundles are not secret. With `?v=` the response is cached
as immutable; without it, `no-cache`. nginx has a `^~ /plugin-assets/` block.

#### The app object

Every `register*` call returns a disposer and is also disposed automatically
when the plugin deactivates. Every registered component is wrapped in the
plugin's scope (so the hooks know which plugin they belong to), an error
boundary and Suspense.

| Member                                              | What it does                                                                                                                                        |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registerRailItem`                                  | A rail button, hidden from users without its `permission`. Hideable items show in Appearance > Sidebar > Navigation. The id must be a declared view |
| `registerPanel`                                     | A rail panel, id in `contributes.panels` or `contributes.tabs`                                                                                      |
| `registerTab`                                       | A tab type, id in `contributes.tabs`. Options cover persistence, layouts, singletons and host needs                                                 |
| `registerHostEditorSection`                         | A host editor tab in the top strip or the SSH group, with `form`, `setField` and `updateForm`                                                       |
| `registerHostAction`                                | A connect or open action on a host: sidebar row, palette, dashboard, default connect                                                                |
| `registerHostBadge`, `registerHostContextMenuItem`  | Host row badges and context menu entries                                                                                                            |
| `registerPaletteEntry`                              | A global or per-host command palette entry                                                                                                          |
| `registerDashboardCard`                             | A dashboard card, id in `contributes.dashboardCards`                                                                                                |
| `registerHomepageWidget`                            | A homepage widget, with an optional edit form                                                                                                       |
| `registerSettingsComponent`                         | A component a `type: "custom"` settings field names                                                                                                 |
| `registerAction`, `declareActionSlot`               | Frontend actions and the slots a plugin owns                                                                                                        |
| `registerSlotContribution`, `invokeAction`          | Fill a slot with a `button` or a `component`, with an optional `when`; call an action and get its result                                            |
| `registerSshAuthEditor`                             | An SSH auth method's editor in the host editor                                                                                                      |
| `registerLoginMethod`, `registerSecondFactorUI`     | Login screen UI for a method and a second factor challenge (plus an optional `enrollment` section)                                                  |
| `api`, `wsUrl(path)`                                | axios on `/plugin-api/<id>/` and the plugin's WebSocket URL                                                                                         |
| `t`, `hasPermission`                                | The plugin's strings and a permission check, for code outside a component (a toast from `activate`)                                                 |
| `tabs.open`, `getLayout`, `applyLayout`, `onChange` | Tab control, used by workspaces                                                                                                                     |
| `guest`, `info`, `onDispose`                        | Guest mode flag, plugin info, extra cleanup                                                                                                         |

Hooks: `useTranslation` (the plugin's namespace), `usePermission` (a short
name resolves to `<id>.<name>`), `useSettings`, `useHost`, `useHosts`,
`useCurrentUser`, `useTheme`, `useToast`, `usePluginApi`, `useTabs`,
`useSshAuthTypes` (every SSH auth type the server knows, with its plugin). The SDK
has no runtime dependencies: the hooks delegate to a host bridge core installs.

Slots core owns: `terminal.toolbar`, `terminal.dock`, `terminal.overlay`
(declared by ssh-terminal), `onboarding.steps`, `onboarding.features`,
`onboarding.workflow`, `hosts.importMenu`, `hosts.panel`, `proxmox.hostEditor`
and `session.remoteDisplay`. Cross-plugin frontend calls go through actions:
`automations.list`, `fleets.list`, `session.remoteDisplay.token`.

#### View ownership

Who owns a tab, panel or card comes from manifests, so it is known even for a
disabled plugin whose code never loaded. A saved tab or dashboard card whose
plugin is disabled, failed, still loading or not installed renders "This
needs the <name> plugin" (`PluginViewPlaceholder`) and is never dropped from
the saved layout. Tab restore waits for the first plugin pass, so a restored
tab does not race its plugin.

The same holds when a saved layout is applied (a workspace): a tab type no
running plugin has registered is reopened as that placeholder rather than
skipped, and it stays in the next snapshot (`isUnregisteredPluginTabType` in
`src/ui/shell/shell-layout.ts`). Only a tab whose host was deleted is skipped.

#### The `ui` entry

`@termix/plugin-sdk/ui` is public API, implemented by
`src/ui/plugin-host/sdk-ui.ts`. Adding to it is a contract change; removing
from it is a breaking one. Today it exports: alert, alert-dialog, badge,
button, card, checkbox, dialog, dropdown-menu, input, label, password-input,
select, select2, separator, switch, textarea, tooltip, section-card,
metric-card, charts, the card grid, `ConnectionScreen` and the connection
status helpers, `SnippetVariablesDialog`, `FullScreenAppWrapper`, the
connection log context, `TOTPDialog`, `SSHAuthDialog`, `WarpgateDialog`,
`useTabs`/`useTabsSafe`, `ActionSlot`, `ComponentSlot` and `FOLDER_COLORS` (the
colour swatches folders and workspaces pick from). Publishing its
`.d.ts` for plugins outside this repo is a follow-up for the repo split.

#### Strings

A plugin's strings live in `plugins/<id>/locales/en.json` and load into the
`<id>` namespace, with core's `translation` as the fallback, so a plugin can
still use `common.*`. Manifest keys (`titleKey`, `labelKey`) resolve in the
plugin namespace; `pluginKey(id, key)` in core returns `<id>:<key>`.
Translations go to `plugins/<id>/locales/translated/<xx_YY>.json`, which is
where Crowdin writes them. Only `en.json` is edited by hand.

#### Type checking

`tsconfig.plugins.frontend.json` checks every plugin frontend and its tests
with bundler resolution, and is part of `npm run type-check`.

### 9. Cross-plugin use

Through `ctx.services` (typed, versioned, RBAC-checked per call), `ctx.events`,
and frontend actions and slots. Dependencies are declared in the manifest:
`dependencies` are hard, `optionalDependencies` are soft. The loader activates
in dependency order. A plugin must keep working when an optional dependency is
missing.

A service call runs as the user its permission was checked for, so the
provider reads that user from `ctx.currentActor()` and takes no user id from
the caller. The workspaces plugin provides `workspaces.saved` (`list()`), which
the AI assistant's `list_workspaces` tool reaches through an optional entry in
its `requires`, answering `unavailable: true` while workspaces is off.

### 10. Lifecycle

`activate(ctx)` creates all state. Everything registered through `ctx` or `app`
is disposed automatically on deactivate. See [Lifecycle rules](#lifecycle-rules).

### 11. Tests

Each plugin has `plugins/<id>/tests/backend` (node) and
`plugins/<id>/tests/frontend` (jsdom), run by its own vitest config:

```ts
// plugins/<id>/vitest.config.ts
import { pluginVitestConfig } from "@termix/plugin-sdk/vitest-preset";

export default pluginVitestConfig(import.meta.url);
```

The preset supplies both projects, the shared setup file
(`@termix/plugin-sdk/testing/setup`, which core's `vitest.setup.ts` re-exports
so there is one copy) and the `@/` alias the frontends still use.

`npm run test` runs core only, `npm run test:plugins` runs every plugin and
`npm run test:all` runs both. Core tests (`src/backend/tests`, `src/ui/tests`)
never test plugin code; they may test the plugin runtime with fixture plugins,
which is why `src/backend/tests/plugins/` still holds the loader, manifest,
capability, registry, service, secret and shutdown suites.

`@termix/plugin-sdk/testing` provides `createMockCtx()`, which enforces
capabilities the way the runtime does, `createFakeContext()` for tests that do
not care about the gates, `createTestDb(pluginDir)` for a real database, and
`renderWithApp(plugin, options)` for frontend tests.

`createTestDb(pluginDir, { before })` opens an in-memory SQLite with stub
`users` and `ssh_data` tables and foreign keys on, runs `before` (seed a legacy
table there to test an adoption), then applies the plugin's own
`migrations/sqlite` with the runner's splitter. Pass its `database` to
`createMockCtx({ db })`: `define` builds the real table, `client` is Drizzle, and
`persisted` counts `persist()` calls. The mock also takes `router` (for example
`() => express.Router()`, so routes are served for real), `permissions`
(enforced by `ctx.rbac`, answering 403 like core; omit it to pass everything),
and returns `setActor(userId)` for a test middleware and `services` for what the
plugin provided. `plugins/workspaces/tests/backend/helpers.ts` is the worked
example.

`renderWithApp` also takes `api` (a stub for `app.api` and `usePluginApi()`),
`layout` (what `app.tabs.getLayout()` returns) and `ready` (fire
`app.tabs.onReady`). `app.tabs.applyLayout` is recorded in `shellCalls` and runs
the shell's real restore rules, `openedTabs()` lists what it opened, and
`renderOpenedTab(i)` renders one the way the shell would, placeholder included. `renderWithApp` activates the plugin against core's real registries,
records what it registered and the shell calls it made, renders any tab,
panel, card, host editor section, settings component or slot, and
`deactivate()` disposes it all. Every bundled plugin has a
`tests/frontend/activate.test.tsx` built on it.

### 12. Auth

Core keeps password login, sessions, API keys, trusted proxy login, Electron
auto-session and trusted devices, plus the base SSH auth types password, key,
stored credential, agent and none. Every other login method, second factor and
SSH auth method is a plugin through `ctx.auth`.

In 2.9.0, OIDC (and GitHub, Google), LDAP, passkeys, TOTP, OPKSSH, Step-CA,
Vault, Tailscale and Warpgate still live in core. They register through the
same interfaces from `src/backend/auth/legacy-providers.ts` and
`src/ui/auth/legacy-auth-ui.tsx` with `pluginId: "core"`. Phase C moves each
one into its plugin by moving its block out of those two files; D1 deletes them.
Nothing else in core branches on those type names.

#### One SSH connect pipeline

Every SSH connection, core's and plugins', goes through
`src/backend/hosts/connect/`:

1. `resolveHostById` resolves the host for the acting user: RBAC, owner-key
   decryption, shared-host overrides and shared agent, and `op://` external
   secret references.
2. `buildConnectConfig` builds the ssh2 config: the defaults for the
   connection's purpose (terminal, file-manager, tmux, metrics, fleet, docker,
   ...), the host key verifier, then the auth provider's `prepare`.
3. `openSshTransport` does port knocking, the Cloudflare Access tunnel, the
   jump host chain (every hop through steps 1 and 2) or SOCKS5.
4. `connectHost` connects with a keyboard-interactive handler: a prompt channel
   when a person can answer (terminal, file manager, docker), otherwise the
   stored password for password prompts and nothing else.

Keyboard-interactive rounds are classified once (`classifyKeyboardInteractive`):
an interceptor first (Warpgate), then push MFA, TOTP, and plain input. The
transport decides how to ask.

A host whose `authType` has no provider fails with
`This host uses <type>, which needs the <plugin> plugin` (the plugin is found
from `contributes.auth.sshAuthTypes`, including disabled plugins), and the host
editor shows the same notice.

#### SSH auth providers

```ts
ctx.auth.registerSshAuthProvider({
  type: "corp-ca", // stored in ssh_data.auth_type
  labelKey: "authType",
  requiresSecret: false, // shared hosts: does a recipient need a secret
  needsUserInteraction: true, // a browser sign-in or a person at the keyboard
  supportsBackground: false, // can metrics and fleets poll it unattended
  credentialType: false, // also offered as a stored credential type
  interaction: "corp-ca", // what its outcomes call the browser step
  fields: [/* settings fields */],
  connectOptions: (host, purpose) => ({/* config overrides */}),
  prepare: async (config, host, env) => {
    // fill config (env.client is the ssh2 Client, for certificate patching)
    return { status: "ready" };
    // or { status: "interaction-required", interaction: "corp-ca", message }
    // or { status: "error", code: "missing-secret", message }
  },
  onKeyboardInteractive: (round, host) => null, // claim a prompt style
  onAuthFailed: (host, env, context) => undefined, // clear caches, retry once
  startInteraction: async (request) => {}, // start the browser step
});
```

The type must be listed in `contributes.auth.sshAuthTypes`, and the plugin
needs `auth:provide`. The grant is checked on every `prepare`. `fields` are the
plugin's own host settings (declare them in `contributes.settings.host` too):
the host editor renders them when the plugin registered no editor, and
`prepare` reads them with `ctx.settings.getHost(host.id, key)`. A frontend can
instead draw its own editor with `app.registerSshAuthEditor`.

A transport that can show a browser step sends `<interaction>_auth_required`
and later calls the provider's `startInteraction` for `<interaction>_start_auth`.

#### Login methods and second factors

```ts
ctx.auth.registerLoginMethod({
  id: "corp-sso",
  labelKey: "signIn",
  kind: "redirect",
  describe: async () => [{ id: "main", label: "Corp", enabled: true }],
  start: async (request, instanceId) => ({ redirectUrl }),
  callback: async (request) => ({
    kind: "external",
    provider: "corp",
    subject: "123",
    email,
    name,
    groups,
    isAdmin,
    allowedUsers,
    returnTo,
    rememberMe,
  }),
});
ctx.auth.registerSecondFactor({
  id: "pin",
  labelKey: "pin",
  isEnrolled: async (userId) => true,
  challenge: async (userId) => ({/* for the UI */}),
  verify: async (userId, body) => body.pin === "1234",
  reset: async (userId) => {},
});
await ctx.auth.recordEnrollment(userId, "pin"); // and removeEnrollment
```

A method never issues a session. It returns an identity: an existing user id,
or an external identity. Core then:

1. finds the user through `user_external_identities` (provider, subject), or
   provisions one with the core rules: first user is admin, the allowed-users
   list is checked on every sign-in, provisioning needs SSO auto-provisioning,
   admin approval is a hook that is off today, the admin group and role map
   are kept in step;
2. unlocks the data key (the password for password logins);
3. runs second factors: every row in `user_second_factors` plus any factor
   that reports itself enrolled. **Fail closed:** a row whose plugin is
   disabled or gone refuses the login ("contact an admin"). A trusted device
   or a method that already proved a factor (a verified passkey) skips the step;
4. issues the JWT, cookie, trusted device and the `login` audit line.

Routes, all under `/users/auth`: `GET methods` (public), `GET :methodId/start`,
`GET|POST :methodId/callback`, `POST :methodId/verify`,
`POST second-factor/:factorId/challenge`, `POST second-factor/:factorId/verify`.
A redirect method's provider must send the browser back to
`/users/auth/<methodId>/callback`. The older routes (`/users/login`,
`/users/totp/verify-login`, `/users/oidc/*`, `/users/ldap/login`,
`/users/webauthn/authenticate/verify`) are thin wrappers over the same pipeline.

An admin clears a user's factors, including orphaned ones, with
`DELETE /users/admin/:userId/second-factors` (audited as
`admin_reset_second_factors`).

Password login is always a method. The admin "allow password login" setting
still turns it off, but only while another method (an enabled SSO instance,
or trusted proxy login) can sign someone in; otherwise it stays on with a
warning so nobody is locked out.

#### Login UI before sign-in

The login screen loads the frontends of enabled plugins that contribute login
methods or second factors from the public `GET /plugins/public-manifest`
(ids, versions, asset info and `contributes.auth` only), before anyone signs
in. `app.registerLoginMethod` draws a button or form for a method the server
lists (props: `instances`, `rememberMe`, `submit`, `startRedirect`,
`complete`); a redirect method with no UI gets one button per instance.
`app.registerSecondFactorUI` draws the challenge (props: `verify`,
`challenge`, `cancel`) and, with `enrollment`, a section in Settings >
Security. At activation before sign-in `app.api` calls fail with 401, so do
nothing there but register.

### 13. Where plugins live

Official plugins live in `plugins/<id>/` as npm workspace packages in this
monorepo for all of 2.9.0, and get split into their own repos later. Every
plugin is enabled by default in 2.9.0; there is no install UI until 3.0.0.

The layout is fixed, and the directory name must equal the manifest `id`:

```
plugins/<id>/
  manifest.json            id, capabilities, contributions
  package.json             @termix-plugin/<id>, private, scripts call the CLI
  tsconfig.json            extends @termix/plugin-sdk/tsconfig.plugin.json
  vitest.config.ts         one line, the SDK preset
  src/backend/index.ts     exports activate(ctx) and deactivate()
  src/frontend/index.tsx   exports activate(app) and deactivate()
  locales/en.json          English strings; Crowdin writes locales/translated/
  migrations/{sqlite,postgres,mysql}/  owned tables, one .sql per dialect
  migrations/snapshot.json        diff basis for the generator
  src/backend/tables.ts           defineTable() definitions
  tests/backend/           vitest, node
  tests/frontend/          vitest, jsdom
  README.md  CHANGELOG.md
  dist/                    build output, gitignored
```

### 14. Upgrades must be lossless

Every move of data, settings or host columns into a plugin comes with a
migration for all three dialects and a test proving existing data survives.

#### Moving a host column into a plugin

A6 built the host-scope settings path but moved no columns; each Phase B step
moves its own. `ssh_data` still holds `enable_docker`, `stats_config`,
`web_ui_config`, `enable_proxmox`, `enable_rdp`, `mac_address` and the rest,
and the hardcoded host editor tabs still read them. The order matters, because
dropping a column before its data has moved loses it:

1. Declare the fields in the plugin's `contributes.settings.host`, keeping the
   key names the form already uses so the editor tab can be deleted rather than
   rewritten.
2. Write a boot migration that copies each row's column into host-scope
   `plugin_settings` for that plugin, keyed by the host id as text. Make it
   idempotent by checking for an existing row first, the way
   `tailscale-settings-migration.ts` does, and cover it with a test that runs
   it twice.
3. Switch the plugin's backend to `ctx.settings.getHost` and delete the
   hardcoded editor tab; the schema-driven Plugins group replaces it.
4. Only then drop the column, in lockstep across all four artifacts: the
   `schema.ts` declaration, the `db/index.ts` bootstrap DDL, a drizzle
   migration per dialect, and `npm run schema:generate` for the pg and mysql
   variants. The two bootstrap guard tests fail if these disagree.

A column that is still read anywhere in core is not ready to be dropped. Ship
the copy and the switch first, and drop it in a later step if that is safer.

---

## Manifest v2 reference

`plugins/<id>/manifest.json`. The directory name must equal `id`. Unknown
fields are rejected at every level: a typo'd `contribute` used to validate
clean and be silently dropped, which made a manifest describe something it did
not do.

```jsonc
{
  "id": "example", // ^[a-z][a-z0-9-]{1,39}$, equals the directory name
  "name": "Example",
  "version": "1.0.0", // semver
  "description": "What it does.",
  "author": { "name": "You", "url": "https://..." },
  "license": "MIT",
  "repository": "https://...", // optional
  "category": "Productivity", // see the enum below
  "icon": "Sparkles", // optional: Lucide name or a bundled icon.svg

  "engine": {
    "termix": ">=2.9.0", // display only, never enforced
    "api": "1", // the real compatibility gate
  },

  "capabilities": ["kv:own", "ui:surface"],

  "dependencies": { "other-plugin": "^1.0.0" }, // missing one blocks activation
  "optionalDependencies": { "maybe": "^1.0.0" }, // missing one is normal

  "provides": [
    {
      "service": "example.thing",
      "version": "1.0.0",
      "permission": "example.use",
    },
  ],
  "requires": [
    { "service": "other.thing", "versionRange": "^1.0.0", "optional": true },
  ],
  "providesSecret": [
    { "key": "api-key", "permission": "example.secrets.share" },
  ],
  "requiresSecret": [
    { "plugin": "other-plugin", "key": "api-key", "optional": true },
  ],

  "contributes": {
    "tabs": [
      {
        "id": "example",
        "titleKey": "nav.example",
        "icon": "Sparkles",
        "openFrom": ["rail"],
      },
    ],
    "actions": [
      {
        "id": "example.open",
        "titleKey": "k",
        "handler": "open",
        "permission": "example.use",
      },
    ],
    "actionSlots": [{ "id": "example.toolbar", "accepts": ["button"] }],
    "permissions": [
      {
        "name": "use", // registered as "example.use"
        "titleKey": "permissions.use.title", // plugin-relative
        "descriptionKey": "permissions.use.description",
        "defaultRoles": ["user"], // system roles only, applied once
      },
    ],
    "auth": {
      // each needs "auth:provide" in capabilities
      "sshAuthTypes": ["corp-ca"], // host auth types this plugin handles
      "loginMethods": ["corp-sso"],
      "secondFactors": ["pin"],
    },
    "settings": {
      "admin": [
        {
          "key": "apiKey",
          "type": "secret", // encrypted at rest, never sent to a browser
          "labelKey": "settings.apiKey.label",
          "descriptionKey": "settings.apiKey.description",
          "placeholderKey": "settings.apiKey.placeholder",
          "group": "settings.group.api", // section heading
        },
        {
          "key": "retries",
          "type": "number",
          "labelKey": "k",
          "min": 0,
          "max": 5,
          "default": 3,
        },
        {
          "key": "browser",
          "type": "custom", // a registered component, for what a schema cannot express
          "component": "devices",
        },
      ],
      "user": [
        {
          "key": "advanced",
          "type": "boolean",
          "labelKey": "k",
          "permission": "tweak", // one of this plugin's own permissions
        },
      ],
      "host": {
        "enableKey": "enableExample", // boolean rendered first, gating the rest
        "enableLabelKey": "k",
        "fields": [
          {
            "key": "port",
            "type": "number",
            "labelKey": "k",
            "requires": "enableExample",
          },
        ],
      },
    },

    "hostCapability": {
      "key": "enableExample",
      "labelKey": "k",
      "editorTab": "general",
    },
  },

  "backend": "dist/backend.js", // default
  "frontend": "dist/frontend.js", // default
  "locales": "locales", // default
  "platforms": ["linux", "win32", "darwin"], // optional
}
```

`category` is one of: Terminal, Files & Transfer, Infrastructure, Monitoring,
Networking, Access & Security, Productivity.

`openFrom` is one of: rail, host-context-menu, palette.

Field types are `boolean`, `string`, `number`, `select`, `multiselect`,
`secret`, `textarea`, `json` and `custom`. `labelKey` is required for every
type but `custom`, which needs `component` instead; `options` is required and
non-empty for `select` and `multiselect` and rejected elsewhere; `min`/`max`
belong to `number` alone; and `requires` must name a boolean field in the same
scope, which includes the host section's `enableKey`.

Cross-field rules the JSON schema cannot express, checked by `parseManifest`:

- `engine.api` must match the SDK major version this build implements.
- Every `provides[].permission`, `providesSecret[].permission` and
  `contributes.actions[].permission` must appear in the plugin's own
  `contributes.permissions`, compared against the qualified `<pluginId>.<name>`
  form. A permission the catalog never sees is one no admin can grant, so the
  surface would be invisible rather than denied.
- `requiresSecret[].plugin` and both dependency maps must not name the plugin
  itself, and a plugin cannot be in both `dependencies` and
  `optionalDependencies`.
- Every `contributes.permissions[].name` must be unique, must not start with a
  core group (`hosts`, `snippets`, `credentials`, `admin`) or with the plugin's
  own id, and every `defaultRoles` entry must be `admin` or `user`.
- A `contributes.settings` field `permission` written as a bare short name must
  appear in the plugin's own `contributes.permissions`. A dotted id is taken as
  given, because the validator cannot know which other plugins exist.

`contributes.panels` and `contributes.dashboardCards` (each `{ id, titleKey,
icon? }`) declare the views a plugin owns besides its tabs; the app object
refuses to register a view the manifest does not declare. `contributes.guest`
opts a plugin into anonymous guest pages. Action contributions and slots
accept the kinds `button` and `component`.

`contributes.auth` lists the ids a plugin registers through `ctx.auth`. A
register call for an id not listed here throws. Core also reads
`sshAuthTypes` from disabled plugins, to say which plugin a host needs.

`contributes.hostCapability`, `provides`, `requires`, `providesSecret` and
`requiresSecret` are carried forward from v1 unchanged because the service and
secret registries read them at activation. Phase B reshapes them.

Removed in A5: `contributes.permissionGroup` and its `defaultForRole`, replaced
by `contributes.permissions`. A plugin no longer picks its own group name.

Removed in v2: `permissions` (replaced by `capabilities`), `sidecars`, the
`capabilities.{backend,frontend,electron,platforms}` object (replaced by the
`backend`/`frontend`/`platforms` fields), the v1 shape of
`contributes.dashboardCards`, `contributes.settingsPanel`, `contributes.apiPrefix`, and
`process:transport-owner` (the marker for the tier that no longer exists).

---

## Capability catalog

Colon-separated, ordered worst first. The i18n keys resolve under
`plugins.capabilities.<id>.title` and `.consequence` in
`src/ui/locales/en.json`, and the copy describes the consequence to the person
deciding, not the mechanism.

| Capability           | Risk     | Meaning                                                        |
| -------------------- | -------- | -------------------------------------------------------------- |
| `credentials:read`   | critical | See plaintext secrets for any reachable host                   |
| `ssh:connect`        | high     | Run commands on hosts it is connected to                       |
| `process:spawn`      | high     | Run programs on the Termix server                              |
| `users:write`        | high     | Create and change user accounts                                |
| `auth:provide`       | high     | Add a login method, second factor or SSH auth type             |
| `system:tls`         | high     | Request and replace the server certificate                     |
| `hosts:write`        | medium   | Create and change hosts                                        |
| `credentials:use`    | medium   | Connect using a host's stored credentials, without seeing them |
| `network:outbound`   | medium   | Make outbound requests                                         |
| `network:serve`      | medium   | Open a listening port                                          |
| `users:read`         | medium   | See usernames and roles, never hashes or 2FA state             |
| `events:core`        | medium   | Subscribe to and emit core events carrying other users' data   |
| `notify:send`        | medium   | Send notifications through configured channels                 |
| `audit:read`         | medium   | Read the audit log                                             |
| `desktop:window`     | medium   | Open desktop windows (Electron only)                           |
| `hosts:read`         | low      | See the host list it can already see                           |
| `db:own`             | low      | Own tables                                                     |
| `kv:own`             | low      | Small key/value state                                          |
| `secrets:own`        | low      | Its own encrypted secrets                                      |
| `settings:read-core` | low      | Read core server settings                                      |
| `ui:surface`         | low      | Contribute tabs, panels and settings                           |

### Rules

- One catalog, in `packages/plugin-sdk/src/capabilities.ts`. Nothing else
  defines a capability.
- Adding one is an entry here plus the SDK method that checks it. A capability
  nothing checks is decoration, and v1 shipped nineteen of those.
- A capability is checked where the privileged thing happens, not at
  activation. Activation-time checks say what a plugin might do; call-time
  checks say what it did.
- `events:core` is the exception that proves the shape: without it a plugin may
  only emit under `plugin.<its id>.`, because otherwise it could publish
  `host.status` and drive the automations engine as though core had.

---

## The ctx surface

Built per plugin in `src/backend/plugins/ctx.ts` and passed to `activate`.

| Member                                           | Capability                           | Status |
| ------------------------------------------------ | ------------------------------------ | ------ |
| `ctx.pluginId`, `ctx.manifest`                   | none                                 | **A1** |
| `ctx.log.*`                                      | none                                 | **A1** |
| `ctx.events.emit` / `.on`                        | `events:core` for core topics        | **A1** |
| `ctx.kv.get/set/delete/list`                     | `kv:own`                             | **A1** |
| `ctx.registry.*`                                 | none                                 | **A1** |
| `ctx.services.provide` / `.get`                  | per-service RBAC                     | **A1** |
| `ctx.secrets.offer` / `.withdraw` / `.getShared` | per-secret RBAC                      | **A1** |
| `ctx.disposables.add`                            | none                                 | **A1** |
| `ctx.asUser(userId, fn)`                         | none, always audited                 | **A1** |
| `ctx.currentActor()`                             | none                                 | **A1** |
| `ctx.db.define` / `.client` / `.refs`            | `db:own`                             | **A3** |
| `ctx.db.persist` / `.dialect`                    | `db:own` (persist only)              | **A9** |
| `ctx.sync.registerEntity`                        | none                                 | **A3** |
| `ctx.http.router` / `ctx.ws.route` / `.upgrade`  | `network:serve`                      | **A4** |
| `ctx.rbac.has` / `.hasFor` / `.require`          | own permissions only                 | **A5** |
| `ctx.hosts.*`                                    | `hosts:read` / `hosts:write`         | B      |
| `ctx.ssh.*`                                      | `ssh:connect`, `credentials:use`     | **A8** |
| `ctx.settings.*`                                 | `settings:read-core` (readCore only) | **A6** |
| `ctx.notify.*`                                   | `notify:send`                        | A6     |
| `ctx.auth.*`                                     | `auth:provide`                       | **A8** |
| `ctx.fetch`                                      | `network:outbound`                   | B      |

`ctx.ssh` was pulled forward from B so plugin transports go through core's
connect pipeline instead of importing ssh2 helpers from core:

- `connect(hostOrId, { purpose, pool? })` returns `{ client, dispose }`.
- `withConnection(host, { pool, purpose }, fn)` borrows a pooled connection.
- `jumpChain(jumpHosts, { forHost? })` returns a client at the end of a jump
  chain, for forwarding to something that is not SSH.
- `prepare(host, { client, purpose })`, `openTransport`,
  `classifyKeyboardInteractive` and `autoResponses` are the lower level for a
  transport with its own prompt flow (docker's console, host metrics).
- `requiresSecret(authType)` and `supportsBackground(authType)` ask the
  provider.

Each new connection is audited and runs as the current actor; pooled reuse is
not. Connections and pool entries are closed on deactivate.

### The actor

Never comes from plugin code. It is held in `AsyncLocalStorage` and set two
ways, with no third:

- **A request.** A4's HTTP and WebSocket middleware runs the handler as the
  user core already authenticated.
- **`ctx.asUser(userId, fn)`** for background work with no request behind it.
  Always audited, and every core API inside still applies that user's RBAC.

A plugin cannot pass a user id to a guarded method and have it believed. This
is what closes the forged-caller bug the old worker broker had, where a worker
could set `callerUserId` on its own messages.

---

## Lifecycle rules

1. **Everything is created inside `activate`.** No servers, timers, listeners
   or connections at module scope. ESM caches modules, so disable-then-enable
   re-runs `activate` against the same module object: anything created at
   module scope is already torn down by the second call and never comes back.
2. **Everything is released on deactivate.** Registrations made through `ctx`
   are tracked automatically. Anything the plugin creates itself goes in
   `ctx.disposables.add(fn)`. A plugin that keeps a port after deactivate makes
   "disabled" a lie and makes re-enabling fail on a port it still holds.
3. **Disposal does not depend on the plugin behaving.** The runtime empties the
   disposable bag even when the plugin's `deactivate()` throws or does not
   exist, in reverse registration order, isolating each disposer.
4. **A failed `activate` is still cleaned up**, and the plugin's own
   `deactivate()` is _not_ called: it never finished starting, so it has no
   state to tear down.
5. **Plugins never touch process signals or `process.exit`.** Core calls
   `deactivate` on shutdown: `gracefulShutdown` in `src/backend/starter.ts`
   calls `shutdownPlugins()`, which stops every plugin in reverse activation
   order. A plugin that installs its own `SIGTERM` handler and exits skips the
   rest of that sequence, including other plugins and the database flush.
6. **Enable, disable, enable must work without a restart.**

### States

`enabled`, `disabled`, `blocked` (a hard dependency is missing, recoverable),
`failed` (activation threw, a dependency cycle, or the error budget tripped).
`lastError` carries the reason.

### Error budget

Core wraps plugin callbacks it invokes. Five failures inside 60 seconds (both
configurable) marks the plugin `failed` and deactivates it, because a plugin
throwing on every call is worse than one that is off.
`POST /plugins/:id/retry` clears the budget and starts it again.

---

## What this protects, and what it does not

Be precise about this, because it is easy to overclaim and the previous
architecture did.

**What the capability system gives you**

- Every privileged thing a plugin can do through `ctx` is declared in a
  manifest you can read before installing it.
- Every privileged call is checked against what was granted, and refused if it
  was not.
- Every privileged call, allowed or refused, leaves an audit line naming the
  plugin and the acting user. You can answer "what did this plugin do, and on
  whose behalf".
- A plugin cannot name a user and be believed, so it cannot act as someone it
  was not invoked by.
- Removing a capability from a manifest revokes the grant on the next boot.

**What it does not give you**

- **Containment.** A plugin runs in the server process. It can
  `import("node:fs")` and read whatever the server user can read, open its own
  sockets, spawn processes, and reach core modules directly. Guarding `ctx`
  does not change any of that.
- **Protection from malicious code.** A plugin that wants to bypass the gate
  can. Nothing here stops it.

`ctx.db` is a clear example. It hands back a handle scoped to the plugin's own
tables, and the `p_<id>_` prefix, the CLI check and the runner's check all say
a plugin may only touch its own. None of that is enforced by the engine: a
plugin holding that handle can write any table in the database, and `ctx.db.refs`
hands it `users` and `ssh_data` outright. The prefix, the capability, the audit
line, lint and review are the contract. The engine is not.

So the honest boundary is: capabilities stop accidental and casual overreach,
and make every privileged call auditable. What stops malicious code is
**signing, review and the kill list** - the same trust model as any other
software you choose to install on a server.

The old worker tier claimed more than this, and the claim was not true either:
`worker_threads` shares the process, so a worker plugin could already reach
anything core could. The honest options for real containment are a child
process with `--permission`, or a WASM isolate. Neither is on the roadmap, and
until one is, this document does not pretend otherwise.

---

## Building a plugin

`termix-plugin`, the CLI the SDK ships, is the only build a plugin needs. It
runs from the plugin's own directory, so a plugin that moves to its own repo
keeps working unchanged.

| Command                    | What it does                                                                                                                                                                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `termix-plugin build`      | esbuild bundles `src/backend/index.ts` to `dist/backend.js` (ESM, node22) and `src/frontend/index.tsx` to `dist/frontend.js` (ESM, browser), then copies `locales/` and `migrations/` into `dist/`. Imported CSS lands in `dist/frontend.css`.                   |
| `termix-plugin validate`   | Runs the SDK's `parseManifest`, checks the files the manifest names exist, and checks that migrations only touch this plugin's tables and exist for every dialect.                                                                                               |
| `termix-plugin migrations` | Diffs `src/backend/tables.ts` against `migrations/snapshot.json` and writes one `.sql` per dialect. `--check` fails when a definition changed without a migration. A rename or a type change is refused rather than guessed at, because that is a data decision. |
| `termix-plugin test`       | Runs the plugin's vitest suite.                                                                                                                                                                                                                                  |
| `termix-plugin pack`       | Writes a `.tgz` of the manifest, `dist/`, locales, migrations and README. **D3** adds signing.                                                                                                                                                                   |

`npm run build:plugins` builds every plugin and stages the result in
`dist/plugins/<id>/`, which is what `getBundledPluginsDir()` resolves to and
what Docker and electron-builder package. `npm run build`, `build:backend` and
`dev:backend` all call it.

TypeScript only type-checks (`tsconfig.plugins.json`, `noEmit`); esbuild does
every emit. Nothing is written next to a source file.

### Host-provided packages

These ship with the Termix server and are never bundled into a plugin, because
a second copy of express or React is a bug, and a second `ssh2` means a second
set of native bindings. A plugin may depend on anything outside these lists,
and that is bundled into its output.

**Backend** (plus every node builtin): `@termix/plugin-sdk`, `express`, `ssh2`,
`ws`, `multer`, `cookie-parser`, `axios`, `jszip`, `guacamole-lite`,
`@anthropic-ai/sdk`, `drizzle-orm`.

**Frontend**: `react`, `react-dom`, `react-dom/client`, `react/jsx-runtime`,
`i18next`, `react-i18next`, `sonner`, `@termix/plugin-sdk/frontend`,
`@termix/plugin-sdk/ui` and `@termix/legacy-core/*`, all resolved through the
import map (see UI). Everything else, including `lucide-react`, `axios`,
`cytoscape` and `guacamole-common-js`, is bundled into the plugin that uses
it.

The lists live in `packages/plugin-sdk/cli/lib/externals.mjs`.

---

## Converting a feature into a plugin

The checklist every Phase B step follows. A9 ran it on workspaces, so
`plugins/workspaces/` is the worked example for each step: read its source and
tests next to this list. Steps are ordered so data is never dropped before it
has moved. Commands run from the repo root unless they start with `cd`.

A conversion is done when the plugin imports nothing from `src/` or `@/`, core
imports nothing of the feature, every piece of existing data survives an
upgrade on all three engines, and the checks in step 15 are green.

### 1. Scaffold

1. Create `plugins/<id>/` with the layout in [Where plugins live](#13-where-plugins-live).
   The directory name is the manifest `id`. If A2 already moved the feature
   there, keep the directory and work through the rest in place.
2. `package.json` is `@termix-plugin/<id>`, private, with the four scripts
   (`build`, `test`, `typecheck`, `validate`) calling `termix-plugin`, and
   `@termix/plugin-sdk` as a dev dependency. `vitest.config.ts` is the one-line
   preset.
3. `tsconfig.json` extends `@termix/plugin-sdk/tsconfig.plugin.json` and has
   **no `paths`** into `../../src`. A path alias is how core imports sneak back.
4. Run `npm install` so the workspace is linked.

### 2. Manifest and capabilities

1. Fill in the manifest (see the [reference](#manifest-v2-reference)). Declare
   every view the frontend registers in `contributes.panels`, `tabs` or
   `dashboardCards`, or `app` refuses to register it.
2. Pick the **smallest** set of capabilities from the
   [catalog](#capability-catalog). Choose by the ctx members the code calls,
   not by what the feature feels like:

   | The code calls                           | Declare                          |
   | ---------------------------------------- | -------------------------------- |
   | `ctx.db.*`                               | `db:own`                         |
   | `ctx.kv.*`                               | `kv:own`                         |
   | `ctx.http.router`, `ctx.ws.*`            | `network:serve`                  |
   | `ctx.ssh.*`                              | `ssh:connect`, `credentials:use` |
   | `ctx.auth.*`                             | `auth:provide`                   |
   | `ctx.settings.readCore`                  | `settings:read-core`             |
   | `ctx.events.emit` outside `plugin.<id>.` | `events:core`                    |
   | anything registered through `app`        | `ui:surface`                     |

   Workspaces needs `db:own`, `network:serve` and `ui:surface`, nothing else.

3. `cd plugins/<id> && npx termix-plugin validate` must print `ok`.

### 3. Backend: replace every core import with the SDK

1. List what the backend reaches in core:
   `grep -rn "src/backend\|src/types" plugins/<id>/src`. Each hit gets replaced.
   A plugin never imports `../../../../src/...`.
2. The usual replacements:

   | Core import                                         | SDK replacement                                                                        |
   | --------------------------------------------------- | -------------------------------------------------------------------------------------- |
   | `AuthManager` middleware, `req.userId`              | nothing: core authenticates `ctx.http` routes; read the user with `ctx.currentActor()` |
   | `requirePermission(...)`                            | `ctx.rbac.require("<short name>")`                                                     |
   | `databaseLogger`, `*Logger`                         | `ctx.log`                                                                              |
   | `createCurrent*Repository()` and `schema.ts` tables | the plugin's own table through `ctx.db` (step 4)                                       |
   | `insertReturning` / `.returning()`                  | insert, then select by a key you set (a sync id)                                       |
   | `DatabaseSaveTrigger`, a repository write hook      | `await ctx.db.persist()` after every write                                             |
   | ssh2 connection code, the pool, `resolveHostById`   | `ctx.ssh.connect` / `withConnection` / `jumpChain`                                     |
   | `getCurrentSettingValue`                            | `ctx.settings.get` for its own keys (step 5), `readCore` for core's                    |
   | another plugin's source                             | `ctx.services.get(...)` (step 10)                                                      |

3. Everything the backend creates lives inside `activate(ctx)`: the table
   (`ctx.db.define`), the repository, the router, timers
   (`ctx.disposables.add`). Nothing at module scope. `deactivate` is usually
   empty.
4. **When the SDK does not have it, add it to the SDK.** Never work around a
   gap with a core import, and never add to
   `src/backend/auth/legacy-providers.ts`. A new ctx member is:
   1. the type and a doc comment in `packages/plugin-sdk/src/backend.ts`;
   2. the implementation in `src/backend/plugins/ctx.ts`, wrapped in `guarded()`
      when it is privileged, so it checks the capability and writes an audit
      line; a new capability is one entry in `src/capabilities.ts` plus its
      i18n title and consequence under `plugins.capabilities.<id>` in
      `src/ui/locales/en.json`;
   3. the same member in `createFakeContext` and a gated one in `createMockCtx`
      (`packages/plugin-sdk/src/testing.ts`);
   4. a core test in `src/backend/tests/plugins/` (allowed and refused);
   5. a row in [The ctx surface](#the-ctx-surface) and a line in the right
      section of this document.

   Then `npm run build:sdk`, because core and the CLI read the SDK's `dist`.
   A9 added `ctx.db.persist`, `ctx.db.dialect`, sync `shouldSync`,
   `createTestDb`, `app.t`, `app.hasPermission` and the rail `permission` this
   way.

### 4. Tables: adopt them, then remove them from core

1. Write `src/backend/tables.ts`. Wrap each definition that replaces a core
   table in `adoptLegacyTable("<legacy name>", defineTable(...))` and export
   `tables`. Keep the legacy column names (camelCase properties become
   snake_case columns) and **the legacy index names**. The table must be listed
   under this plugin in `LEGACY_TABLE_OWNERS` (`packages/plugin-sdk/src/db.ts`).
   Use `refUser()` / `refHost()` for owner columns: they cascade on delete.
2. `cd plugins/<id> && npx termix-plugin migrations adopt_<table>` writes
   `migrations/{sqlite,postgres,mysql}/0001_adopt_<table>.sql` and
   `migrations/snapshot.json`. Read all three files. Never edit one after it
   has shipped; add a new migration instead.
3. Remove the table from core, in this order:
   - `src/backend/database/db/schema.ts`: the table block.
   - `src/backend/database/db/index.ts`: the `CREATE TABLE` bootstrap block and
     any `ALTER` for it. Some of these files use CRLF line endings; keep them.
   - `src/backend/database/db/performance-indexes.ts`: its entries. The adopted
     definition's indexes replace them.
   - `src/backend/database/repositories/factory.ts` and the repository file.
   - `src/backend/database/routes/delete-user-data.ts` and the user/host
     repositories: explicit deletes of the table. A `refUser`/`refHost` column
     cascades on every engine, because the foreign key survives the rename.
     Prefer that cascade. A table that cannot carry such a column needs a
     core "user deleted" or "host deleted" event on `ctx.events`, added to
     the SDK the step 3 way; none exists yet because no plugin needed one.
   - `sync-entities.ts`, if core synced it (step 9).
   - Anything else `grep -rn "<table_name>\|<tableConst>" src` finds, including
     core tests and `src/types`.
4. `npm run schema:generate` (the pg and mysql schema variants), then
   `npm run schema:migrations`. drizzle-kit writes a `DROP TABLE` for each
   removed table in `drizzle/{sqlite,postgres,mysql}/`. **Replace every one of
   those statements with a comment and `SELECT 1;`** (MySQL refuses an empty
   query) and keep the new `meta` snapshots. The drop would run at boot, before
   the plugin's adoption, and delete every row.
5. Why the order is safe: core boots first, runs its drizzle migrations (the
   legacy table is still there, untouched), then the plugin's migration renames
   it. A plugin that is disabled at upgrade time simply leaves the legacy table
   alone until it is enabled.
6. Tests (step 13) prove the adoption with the legacy table present and absent.

### 5. Global settings keys become plugin settings

1. Declare each key in `contributes.settings.admin` (install-wide) or `.user`,
   keeping the key name the frontend already sends where possible, and give it
   a `default`. Secrets are `type: "secret"`.
2. Write a boot migration in `src/backend/utils/crypto-migration/`, modelled on
   `tailscale-settings-migration.ts`: read the old row from `settings` (or the
   per-user source), write it to `plugin_settings` for the plugin **only when
   no row exists there yet**, then leave the old row in place for one release.
   Call it from the boot sequence in `starter.ts` after the plugins table exists.
3. Test it in `src/backend/tests/utils/`: values move, secrets stay encrypted,
   and running it twice changes nothing.
4. Switch the plugin to `ctx.settings.get` / `getUser`, delete the core
   settings route and UI for those keys, and remove the keys from
   `CORE_SETTINGS_ALLOWLIST` if they were there.

### 6. `ssh_data` host columns become host-scope settings

Follow [Moving a host column into a plugin](#moving-a-host-column-into-a-plugin)
exactly: declare `contributes.settings.host`, copy with an idempotent migration
tested by running it twice, switch the plugin to `ctx.settings.getHost` and
delete the hardcoded editor tab, and only then drop the column in lockstep
across `schema.ts`, `db/index.ts`, `schema:generate` and a drizzle migration per
dialect. Copy and drop can ship in different steps; a column core still reads
is not ready to drop.

### 7. Permissions

1. Declare `contributes.permissions` with `titleKey` and `descriptionKey` in the
   plugin's own locales. **Keep existing ids**: core registers `<id>.<name>`, so
   pick the short name that makes the id equal the old core one (`ai` + `use` is
   `ai.use`) and no role needs migrating.
2. Remove those entries from `PERMISSION_CATALOG` and `SYSTEM_ROLE_DEFAULTS` in
   `src/backend/utils/permission-catalog.ts`, and move their i18n.
3. `defaultRoles` are `admin` and/or `user`, applied once.
4. Gate every route. `router.use(ctx.rbac.require("<name>"))` before the routes
   is the simplest way to make sure none is missed; workspaces declares `use`
   and gates the whole router on it.
5. Gate the frontend too: `permission` on the rail item, `usePermission` in
   components, `await app.hasPermission(...)` before background calls (the
   workspaces autosave), so a user without it collects no 403s.

### 8. HTTP, WebSockets and nginx

1. Routes go on `ctx.http.router()` (served at `/plugin-api/<id>/`) and sockets
   on `ctx.ws.route` / `ctx.ws.upgrade` (`/plugin-ws/<id>/<path>`). Route paths
   are relative to the mount point.
2. Update every route's OpenAPI JSDoc path to `/plugin-api/<id>/...`.
3. Delete the feature's own port and server from core: its import in
   `src/backend/starter.ts`, its `listen`, and its `location` blocks in **both**
   `docker/nginx.conf` and `docker/nginx-https.conf`. `/plugin-api/` and
   `/plugin-ws/` are already proxied.
4. Point the frontend at the plugin client (step 11); old paths such as
   `/workspaces` stop existing.

### 9. Sync entities

If core synced the data, or it is personal configuration that should follow a
user between the desktop app and a server, register it in `activate`:
`ctx.sync.registerEntity({ type, table, order, ... })`. Keep an existing wire
name exactly and remove core's registration from `sync-entities.ts`. Leave
`electron/remote-sync-entities.cjs` alone: it is the fallback for servers
older than the entity-types endpoint, which still sync the core entity. Give
an entity that references others a higher `order` than they have. Use `shouldSync` for rows that belong to one
install (workspaces leaves out its `last_session` row).

### 10. Cross-plugin and core callers

1. `grep -rn` the old repository or module across `src/` and `plugins/`. A core
   caller means the feature is not fully out yet: move the logic behind a core
   extension point or into the plugin.
2. Another plugin calling it gets a service: declare it in `provides`
   (`<id>.<noun>`, a version and a permission), `ctx.services.provide` it in
   `activate`, and have the caller declare an optional `requires` entry plus
   `optionalDependencies`. The caller must work when it is absent (catch and
   degrade). Workspaces provides `workspaces.saved` to the AI plugin.

### 11. Frontend

1. List core imports:
   `grep -rn "from \"@/\|src/ui" plugins/<id>/src/frontend`. Replace each:

   | Core import                                     | SDK replacement                                             |
   | ----------------------------------------------- | ----------------------------------------------------------- |
   | `@/components/*`                                | `@termix/plugin-sdk/ui`                                     |
   | `authApi`, `handleApiError` from `@/main-axios` | `app.api` or `usePluginApi()`, paths relative to the plugin |
   | `react-i18next`, `i18next.t`                    | `useTranslation()` in components, `app.t` elsewhere         |
   | `usePermissions`                                | `usePermission` / `app.hasPermission`                       |
   | shell modules (`workspaceUtils`, tab state)     | `app.tabs`, `useTabs`                                       |
   | `@/types/*`                                     | the plugin's own `types.ts`                                 |
   | small helpers (`getErrorMessage`)               | a few lines in the plugin                                   |

   Something the plugin genuinely needs from the shell's component library goes
   into `src/ui/plugin-host/sdk-ui.ts` (a contract change: list it under
   [The `ui` entry](#the-ui-entry)).

2. Register everything in `activate(app)`: rail item (with `permission` when
   there is one), panel, tabs, host editor sections, actions and slot
   contributions. Use `app.onDispose` for timers.
3. Remove the shell's references: imports from the feature, hardcoded ids and
   switch cases, and the matching entries in
   `scripts/shell-plugin-id-allowlist.json`. `node scripts/check-shell-plugin-ids.cjs`
   must pass.
4. The rail item appears in Appearance > Sidebar > Navigation on its own
   because it is registered; confirm it there.
5. No hardcoded text (a relative time is a translated string), no em dashes,
   square containers.

### 12. Locales

1. Move every key the plugin uses from `src/ui/locales/en.json` into
   `plugins/<id>/locales/en.json`, keeping the key paths so the code changes
   only its namespace. Keys still used by core stay in core; a plugin may keep
   using core's `common.*`, which is the fallback.
2. Move the same keys, per language, from `src/ui/locales/translated/<xx_YY>.json`
   into `plugins/<id>/locales/translated/<xx_YY>.json`, so no translation is lost.
   Crowdin already picks up `plugins/*/locales/en.json` (`crowdin.yml`).
3. Manifest keys (`titleKey`, `labelKey`) are plugin-relative.
4. Only `en.json` is edited by hand afterwards.

### 13. Tests

1. Move the feature's tests to `plugins/<id>/tests/backend` and
   `tests/frontend`. **No plugin test imports `src/`**, and no core test imports
   `plugins/`. Delete core tests of code that left core.
2. The minimum a conversion ships:
   - routes against a real database: `createTestDb(pluginDir)` +
     `createMockCtx({ db, router: () => express.Router(), permissions })` +
     `activate`, served on an ephemeral port and called with `fetch`
     (`plugins/workspaces/tests/backend/helpers.ts`);
   - permission denial on every route;
   - the adoption with the legacy table present (rows and indexes survive) and
     absent (fresh table), using `createTestDb`'s `before` hook with the legacy
     DDL copied from `db/index.ts`;
   - activate failing closed without each capability;
   - a frontend `activate.test.tsx` on `renderWithApp`, plus the panel or tab
     rendering against a stubbed `api`.
3. Every settings or host-column migration gets its run-twice test in core.
4. `cd plugins/<id> && npx vitest run` while working; `npm run test:plugins` at
   the end.

### 14. Boundary allowlist

`node scripts/check-plugin-boundaries.cjs --write`, then
`git diff scripts/plugin-boundary-allowlist.json`: the plugin's entries are
gone and **no other line was added**. Update the counts in the table under
[Legacy core imports](#legacy-core-imports-the-debt-d1-removes).

### 15. Build, test and check by hand

```bash
npm run build:sdk
(cd plugins/<id> && npx termix-plugin validate && npx termix-plugin migrations --check)
npm run build:backend
npm run type-check
npm run lint
npm run test
npm run test:plugins
```

Then, with the app running:

1. Boot on an existing SQLite database from before the conversion: the data is
   there, the `p_<id>_` tables exist and the legacy tables are gone.
2. Use every feature path once: create, edit, delete, anything background.
3. Remove the plugin's permission from a role: the rail item disappears and
   the API answers 403.
4. Disable, enable and disable the plugin in admin without a restart: its
   views show the "needs the plugin" placeholder while off and come back after.
5. On Postgres or MySQL if available: `npm run verify:dialect`, then boot.
6. Update this document for anything the step added to the contract.

---

## Legacy core imports: the debt D1 removes

The bundled plugins predate the SDK, apart from workspaces, which A9 rebuilt
as the reference conversion and which imports nothing from core. They still reach core by relative
path (`../../../../src/backend/...`), which an esbuild plugin,
`packages/plugin-sdk/cli/lib/legacy-core-imports.mjs`, keeps out of the bundle
and rewrites to the compiled output path (`../../../backend/backend/...`, or
`../../../backend/types/...` for shared types). The rewrite is output-relative,
so a source file at any nesting collapses to the same prefix. D1 deletes that
file.

Frontends do the same with `@/`: in the browser build, `@/x` and
`../src/ui/x` become the bare `@termix/legacy-core/ui/x` (or
`@termix/legacy-core/types/x`), which core's Vite build exposes as a shared
module so plugin and shell use one instance of each core module. The CLI
refuses the rewrite outside a Termix checkout. Every such import is counted
in the `plugin-frontend-to-core` direction below.

This is expected and temporary. The SDK does not yet expose what they need:
the SSH connection pool, host resolution, the repository layer, the shared
component library. D1 removes the debt once A3 through A8 have given them
supported APIs to move onto.

What the lint fence enforces today, in `eslint.config.mjs`:

| Direction                                        | Severity  | Offenders | Emptied by |
| ------------------------------------------------ | --------- | --------- | ---------- |
| Core importing a plugin backend                  | **Error** | 0         | -          |
| A plugin backend importing frontend code or `@/` | **Error** | 0         | -          |
| The shell importing plugin code                  | **Error** | 0         | -          |
| A plugin frontend importing core through `@/`    | Warning   | 106 files | D1         |
| A plugin importing core by relative path         | Warning   | 68 files  | D1         |
| A plugin importing another plugin's source       | Warning   | 3 files   | B18        |

A warning does not fail a build, so the counts are held by
`scripts/check-plugin-boundaries.cjs`, run by `npm run lint`. Every offender is
listed in `scripts/plugin-boundary-allowlist.json`: a new one fails, and so
does an entry that stopped being an offender, so the list shrinks as each step
lands rather than rotting. `--write` regenerates it. D1 empties it and the two
plugin-side warnings become errors.

The two plugin-backend directions use different rule names
(`no-restricted-imports` and `@typescript-eslint/no-restricted-imports`)
because flat config replaces a rule's options rather than merging them, so one
rule cannot carry both severities on the same files.

Known specifics:

- **TODO(B18):** `plugins/ai/src/backend/tools/executor.ts` imports
  `automations`' `routes.js` directly. It is declared as a hard `dependencies`
  entry so the loader starts automations first and marks `ai` blocked if
  automations is disabled. In B18 `ai` calls automations through an
  `automations` service as an `optionalDependency` and the direct import goes
  away.
- **TODO(B18):** `plugins/host-metrics/src/backend/` reaches `automations`
  twice, for a `MetricsSnapshot` type and a fire-and-forget
  `import("...headless-viewer.js")` that registers a viewer bridge. Both
  degrade silently when automations is absent, so host-metrics declares it as
  an `optionalDependency` (added in A2; it previously declared nothing, and
  the loader had no reason to order the two).
- Core feature servers that are not plugins yet still own ports: tunnel 30003,
  file-manager 30004, dashboard 30006, tmux 30010, serial 30011 and homepage 30012. Each keeps its nginx block until its own Phase B step. No plugin owns
  a port any more (A4).
- The terminal component and `TerminalTabContent` stay in core until the
  terminal's Phase B step (session manager, split view and file-manager
  callbacks). ssh-terminal registers them through the legacy alias.
- Host data columns (`enableDocker`, `enableRdp`, `guacamoleConfig` and so on)
  stay in core types until Phase B moves them. Only UI branches on them left
  the shell.
