# Termix plugin architecture

This is the contract between Termix core and a plugin. It is the reference for
anyone writing a plugin and the specification the runtime in
`src/backend/plugins/` implements.

Status: the redesign lands across several steps. Everything marked **A1** is
built today. Later markers name the step that delivers the rest.

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

| Entry                             | Contents                                                   |
| --------------------------------- | ---------------------------------------------------------- |
| `@termix/plugin-sdk/backend`      | `PluginContext`, `definePlugin()`, `PluginCapabilityError` |
| `@termix/plugin-sdk/db`           | `defineTable()`, the column builders, the legacy-table map |
| `@termix/plugin-sdk/ddl`          | The per-dialect DDL emitter, shared with the CLI           |
| `@termix/plugin-sdk/frontend`     | The `app` object types (stubs until A7)                    |
| `@termix/plugin-sdk/manifest`     | Manifest types, validation, the JSON schema                |
| `@termix/plugin-sdk/capabilities` | The capability catalog                                     |
| `@termix/plugin-sdk/testing`      | Test helpers, incl. `createFakeContext()`                  |

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

A plugin declares short names in `contributes.permissionGroup`. Core registers
them, groups them under the plugin in the role editor, and only lets a plugin
set defaults for its own namespace: a `defaultForRole` entry naming a
permission the plugin does not declare is a validation error, not a silent
escalation. Permissions stored in a role survive the plugin being disabled.

Role defaults are applied once and the fact is recorded, so an admin who
revokes one does not get it handed back on the next restart.

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
(`fleets` -> `p_fleets_fleets`) rather than copied, so nothing is duplicated
and no row is migrated one at a time. `LEGACY_TABLE_OWNERS` maps each legacy
table to the one plugin allowed to adopt it, enforced by the CLI at build time
and by the runner at activation, because a plugin installed from a tarball
never ran the CLI.

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

### 6. HTTP and WebSockets

Plugin routes live under `/plugin-api/<id>/` and sockets under
`/plugin-ws/<id>/`, served by the main backend with core auth. No plugin gets
its own port or nginx block.

**A4** delivers this. In A1 `/plugin-api` is mounted and auth-gated but has no
routes registered, so it returns 404. The bundled plugins still keep their
original URLs through the dispatchers in `src/backend/database/routes/*-dispatch.ts`,
and four still own ports of their own.

### 7. Settings

Plugins declare settings fields in the manifest with scope `admin`, `user` or
`host`. Core renders them from the schema (with an optional custom component),
stores values in `plugin_settings`, and encrypts secret fields. One Settings
screen has a Plugins section with a page per plugin; host settings render in
the host editor. **A6.**

### 8. UI

A plugin frontend is a built ESM bundle loaded at runtime by the core loader.
It registers everything through the `app` object: rail items, panels, tabs,
host editor sections, host actions and badges, context menu items, palette
entries, dashboard cards, homepage widgets, settings components, action slots,
login/2FA UI, SSH auth editors. The shell contains no plugin ids. **A7.**

### 9. Cross-plugin use

Through `ctx.services` (typed, versioned, RBAC-checked per call), `ctx.events`,
and frontend actions and slots. Dependencies are declared in the manifest:
`dependencies` are hard, `optionalDependencies` are soft. The loader activates
in dependency order. A plugin must keep working when an optional dependency is
missing.

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
not care about the gates, and `renderWithApp()` for frontend tests (**A7**
finishes it).

### 12. Auth

Core keeps password login, sessions, API keys, trusted proxy login, Electron
auto-session and trusted devices, plus the base SSH auth types password, key,
stored credential, agent and none. Every other login method, second factor and
SSH auth method is a plugin through `ctx.auth`. **A8.**

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
  src/frontend/index.tsx   exports activate(app) and deactivate() (A7)
  locales/en.json          English strings; Crowdin translates the rest
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
    "permissionGroup": {
      "group": "example",
      "permissions": ["example.use"],
      "defaultForRole": { "admin": ["example.use"] }, // own namespace only
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

Cross-field rules the JSON schema cannot express, checked by `parseManifest`:

- `engine.api` must match the SDK major version this build implements.
- Every `provides[].permission`, `providesSecret[].permission` and
  `contributes.actions[].permission` must appear in the plugin's own
  `contributes.permissionGroup.permissions`. A permission the catalog never
  sees is one no admin can grant, so the surface would be invisible rather
  than denied.
- `requiresSecret[].plugin` and both dependency maps must not name the plugin
  itself, and a plugin cannot be in both `dependencies` and
  `optionalDependencies`.
- Every `defaultForRole` entry must be a permission the plugin declares.

`contributes.hostCapability`, `provides`, `requires`, `providesSecret` and
`requiresSecret` are carried forward from v1 unchanged because the service and
secret registries read them at activation. A5, A6 and A7 reshape them.

Removed in v2: `permissions` (replaced by `capabilities`), `sidecars`, the
`capabilities.{backend,frontend,electron,platforms}` object (replaced by the
`backend`/`frontend`/`platforms` fields), `contributes.dashboardCards`,
`contributes.settingsPanel`, `contributes.apiPrefix`, and
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
| `auth:provide`       | high     | Add a login method or second factor                            |
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

| Member                                           | Capability                       | Status |
| ------------------------------------------------ | -------------------------------- | ------ |
| `ctx.pluginId`, `ctx.manifest`                   | none                             | **A1** |
| `ctx.log.*`                                      | none                             | **A1** |
| `ctx.events.emit` / `.on`                        | `events:core` for core topics    | **A1** |
| `ctx.kv.get/set/delete/list`                     | `kv:own`                         | **A1** |
| `ctx.registry.*`                                 | none                             | **A1** |
| `ctx.services.provide` / `.get`                  | per-service RBAC                 | **A1** |
| `ctx.secrets.offer` / `.withdraw` / `.getShared` | per-secret RBAC                  | **A1** |
| `ctx.disposables.add`                            | none                             | **A1** |
| `ctx.asUser(userId, fn)`                         | none, always audited             | **A1** |
| `ctx.currentActor()`                             | none                             | **A1** |
| `ctx.db.define` / `.client` / `.refs`            | `db:own`                         | **A3** |
| `ctx.sync.registerEntity`                        | none                             | **A3** |
| `ctx.http.route` / `ctx.ws`                      | `network:serve`                  | A4     |
| `ctx.hosts.*`                                    | `hosts:read` / `hosts:write`     | A4     |
| `ctx.ssh.*`                                      | `ssh:connect`, `credentials:use` | A4     |
| `ctx.settings.*`                                 | `settings:read-core`             | A6     |
| `ctx.notify.*`                                   | `notify:send`                    | A6     |
| `ctx.auth.*`                                     | `auth:provide`                   | A8     |
| `ctx.fetch`                                      | `network:outbound`               | A4     |

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

**Frontend**: `react`, `react-dom`, `react/jsx-runtime`, `@termix/plugin-sdk`,
`i18next`, `react-i18next`, and the UI libraries core provides today
(`lucide-react`, `sonner`, `axios`, `cytoscape`, `react-cytoscapejs`,
`guacamole-common-js`, `react-xtermjs`, `@xterm/*`). **A7** serves these
through the SDK `ui` entry.

The lists live in `packages/plugin-sdk/cli/lib/externals.mjs`.

---

## Legacy core imports: the debt D1 removes

The twelve bundled plugins predate the SDK. They still reach core by relative
path (`../../../../src/backend/...`), which an esbuild plugin,
`packages/plugin-sdk/cli/lib/legacy-core-imports.mjs`, keeps out of the bundle
and rewrites to the compiled output path (`../../../backend/backend/...`, or
`../../../backend/types/...` for shared types). The rewrite is output-relative,
so a source file at any nesting collapses to the same prefix. D1 deletes that
file.

This is expected and temporary. The SDK does not yet expose what they need:
the SSH connection pool, host resolution, the repository layer, the shared
component library. D1 removes the debt once A3 through A8 have given them
supported APIs to move onto.

What the lint fence enforces today, in `eslint.config.mjs`:

| Direction                                        | Severity  | Offenders | Emptied by |
| ------------------------------------------------ | --------- | --------- | ---------- |
| Core importing a plugin backend                  | **Error** | 0         | -          |
| A plugin backend importing frontend code or `@/` | **Error** | 0         | -          |
| The shell importing plugin components            | Warning   | 16 files  | A7         |
| A plugin importing core by relative path         | Warning   | 71 files  | D1         |
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
- Eight plugins keep their original core URLs through the dispatchers in
  `src/backend/database/routes/*-dispatch.ts` rather than `/plugin-api`. A4
  moves them.
- Four plugins own ports directly (ssh-terminal 30002, host-metrics 30005,
  docker 30007 and 30009, remote-desktop 30008). A4 moves them onto the main
  server.
- `src/ui/shell/pluginLoader.ts` still hardcodes plugin ids in
  `BUILT_IN_TABS_BY_PLUGIN` and `applyFirstPartyActions`. A7 removes both.
