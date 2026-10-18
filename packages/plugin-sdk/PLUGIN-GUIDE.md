# Termix plugin guide

SDK 1.0.11 | Plugin API 1.3.0

This guide is for anyone, person or AI coding tool, building a Termix plugin. It ships inside
`@termix-ssh/plugin-sdk`, so the copy in your `node_modules` always matches the SDK you have installed.
Run `npm update @termix-ssh/plugin-sdk` to get the newest one.

If this guide and the SDK's TypeScript types disagree, the types are right. They live next to this file
in `dist/*.d.ts`. The long form of everything here is at https://docs.termix.site/develop, and the raw
Markdown of each page is at
`https://raw.githubusercontent.com/Termix-SSH/Docs/main/develop/<page>.md` (for example
`develop/backend.md`), which is easier for tools to read than the site.

## What a plugin is

Termix is self-hosted, plugin-based server management. Core keeps hosts, credentials, users, sharing and
the shell. Everything else, even the SSH terminal, is a plugin built with this SDK.

A plugin is:

- `manifest.json`: what it is, what it adds and what it may do. Termix reads it without running any code.
- A backend, `src/backend/index.ts`, run inside the Termix server process. It exports `activate(ctx)`.
- A frontend, `src/frontend/index.tsx`, run in the browser in the same page as Termix. It exports
  `activate(app)`.

There is no sandbox. Capabilities make a plugin honest and easy to audit, but code runs with the server's
rights. Write it as if an admin will read every line, because reviewers do.

## Hard rules

Break one of these and the plugin fails to load, fails validation or gets rejected in review.

1. Import only `@termix-ssh/plugin-sdk/*`, your own files and npm packages. Never import Termix's own code.
2. Create everything inside `activate`. No servers, timers, sockets or connections at the top of a module.
   Disable then enable runs `activate` again on the same module, and it must work without a restart.
3. Clean up what you make yourself with `ctx.disposables.add(fn)` (backend) or `app.onDispose(fn)`
   (frontend). Things made through `ctx` and `app` are cleaned up for you.
4. Never call `process.exit` or touch signals.
5. Never open your own SSH connection. Use `ctx.ssh` so jump hosts, proxies, host keys, every auth type and
   sharing work the way the user set them up.
6. Outbound HTTP goes through `ctx.fetch` (needs `network:outbound`), not a raw `fetch` or axios.
7. Ask for the fewest capabilities you can. A call that needs one you didn't list throws
   `PluginCapabilityError`.
8. Never take a user id from a request body or a service caller. Use `ctx.currentActor()`.
9. Check permissions on the backend. Frontend checks only hide UI.
10. Call `await ctx.db.persist()` after every database write. On SQLite a write without it can be lost on
    restart.
11. Never use `.returning()` in a query. MySQL doesn't have it. Read a new row back by a key you chose.
12. Never edit a migration that has shipped. Termix checks a checksum and refuses to start the plugin. Add a
    new one.
13. Never index a `text()` or `json()` column. Use `varchar(n)` for anything you index.
14. Never hard code UI text. Every string goes in `locales/en.json` and is read with `t()`.
15. The plugin `id` never changes once released. It names your tables, routes and permissions.
16. The version in `manifest.json`, `package.json` and the newest `CHANGELOG.md` section must match.
17. Put an `@openapi` JSDoc block above every route.
18. No obfuscated or minified source, and no code downloaded and run at runtime.
19. No tracking, telemetry or network calls the user didn't ask for. If you need one, make it off by
    default and explain it in your docs.

## Project layout

```
manifest.json            what the plugin is, adds and may do
package.json             npm scripts and dependencies
CHANGELOG.md             release notes, one section per version
README.md                the repo front page
AGENTS.md                notes for AI tools working on this plugin
docs/index.md            the plugin's docs page (more pages next to it)
src/backend/index.ts     activate(ctx), runs in the Termix server
src/backend/tables.ts    table definitions, exports `tables`
src/backend/routes.ts    HTTP routes
src/frontend/index.tsx   activate(app), runs in the browser
locales/en.json          every string the plugin shows
locales/translated/      other languages, like de_DE.json (optional)
migrations/              sqlite/, postgres/, mysql/ and snapshot.json, made by npm run migrations
tests/backend/           backend tests (Node)
tests/frontend/          frontend tests (jsdom)
vitest.config.ts         uses the SDK preset
.github/workflows/       ci.yml and release.yml, calling shared workflows in Termix-Registry
dist/                    build output, never commit it
```

## Commands

```bash
npm install
npm run build        # termix-plugin build: dist/backend.js, dist/frontend.js, CSS, openapi.json
npm test             # termix-plugin test: Vitest
npm run typecheck    # tsc
npm run validate     # termix-plugin validate: manifest, files, migrations, changelog, docs
npm run migrations   # termix-plugin migrations: write migrations after changing tables.ts
npm run pack         # termix-plugin pack: write <id>-<version>.tmxplug (with LICENSE and NOTICE)
npm run format       # Prettier
npm run format:check
```

## Done checklist

Before you call a change finished:

- [ ] `npm test` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run validate` passes with no warnings you can fix
- [ ] `npm run build` passes
- [ ] `npm run format:check` passes
- [ ] `npx termix-plugin migrations --check` passes (you ran `npm run migrations` after changing tables)
- [ ] New strings are in `locales/en.json`, and `plugin.name` / `plugin.description` match the manifest
- [ ] New routes have an `@openapi` block and a test, including without the permission
- [ ] New env vars are listed in `env` in the manifest
- [ ] `docs/` and the "About this plugin" section of `AGENTS.md` still match what the plugin does
- [ ] User facing changes are in `CHANGELOG.md` under the version they will ship in

## Manifest

```json
{
  "$schema": "./node_modules/@termix-ssh/plugin-sdk/schema/manifest.schema.json",
  "id": "hello",
  "name": "Hello",
  "version": "1.0.0",
  "description": "Says hello and keeps a few notes.",
  "author": { "name": "You", "url": "https://example.com" },
  "license": "Apache-2.0",
  "repository": "https://github.com/you/termix-plugin-hello",
  "docs": "https://github.com/you/termix-plugin-hello/tree/main/docs",
  "category": "Productivity",
  "icon": "Hand",
  "features": ["A tab from the sidebar", "Notes per user"],
  "engine": { "termix": ">=26.10.0", "api": "^1.2" },
  "capabilities": ["db:own", "network:serve", "ui:surface"],
  "env": [],
  "contributes": {
    "tabs": [
      {
        "id": "hello",
        "titleKey": "tab.title",
        "icon": "Hand",
        "openFrom": ["rail"]
      }
    ],
    "permissions": [
      {
        "name": "use",
        "titleKey": "permissions.use.title",
        "descriptionKey": "permissions.use.description",
        "defaultRoles": ["admin", "user"]
      }
    ]
  },
  "locales": "locales",
  "platforms": ["linux", "win32", "darwin"]
}
```

Unknown fields are refused at every level, so a typo fails validation. The schema at
`node_modules/@termix-ssh/plugin-sdk/schema/manifest.schema.json` has every field.

| Field                                  | Notes                                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `id`                                   | Lowercase, starts with a letter, 2 to 40 characters, letters, numbers and dashes. Can't be an official plugin's id. |
| `version`                              | Semver. Betas are `X.Y.Z-beta.N`.                                                                                   |
| `category`                             | One of: Terminal, Files & Transfer, Infrastructure, Monitoring, Networking, Access & Security, Productivity.        |
| `icon`                                 | A [Lucide](https://lucide.dev/icons/) icon name, like `Hand`.                                                       |
| `features`                             | Up to 20 short lines shown on the plugin's page.                                                                    |
| `docs`                                 | An https link to your docs.                                                                                         |
| `engine.termix`                        | Termix versions you work with, like `>=26.10.0`.                                                                    |
| `engine.api`                           | Plugin API range, like `^1.2`. A major bump of the API is breaking.                                                 |
| `capabilities`                         | What your code may do. See the reference at the end.                                                                |
| `dependencies`, `optionalDependencies` | Other plugins, `{ "snippets": "^1.0.0" }`. You must keep working without optional ones.                             |
| `provides`, `requires`                 | Services you offer and use.                                                                                         |
| `env`                                  | Every environment variable your backend reads. `validate` warns about unlisted `process.env.X`. Prefer settings.    |
| `desktop`                              | `mirror` (default), `local` or `server`: how a linked desktop app treats the plugin.                                |
| `nativeDependencies`                   | npm packages with `.node` bindings. Avoid them: community plugins can't count on them.                              |

`contributes` holds `tabs`, `panels`, `dashboardCards`, `actions`, `actionSlots`, `permissions`,
`settings`, `protocols`, `auth`, `syncEntities`, `keybindingActions`, `http`, `guest`, `guestViews`,
`uiPresets` and `uses`. Frontend `register*` calls need their ids declared here first.

Capabilities and permissions are different things. A capability (`hosts:read`, with a colon) is what your
code may reach. A permission (`hello.use`, with a dot) is what a user may do.

## Backend

```ts
import type { Router } from "express";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import { notes } from "./tables.js";
import { registerRoutes } from "./routes.js";

export async function activate(ctx: PluginContext) {
  const notesTable = await ctx.db.define(notes);
  registerRoutes(ctx.http.router<Router>(), ctx, notesTable);
}

export async function deactivate() {
  // Everything registered through ctx is disposed by core.
}
```

Bundled as ESM for Node 22+ into `dist/backend.js`. Backend imports of your own files use `.js`.

### What ctx has

| Member                 | Capability                       | What it does                                                   |
| ---------------------- | -------------------------------- | -------------------------------------------------------------- |
| `pluginId`, `manifest` | none                             | Your id and manifest                                           |
| `log`                  | none                             | Log lines tagged with your plugin                              |
| `db`                   | `db:own`                         | Your own tables                                                |
| `kv`                   | `kv:own`                         | Small key value state                                          |
| `files.dataDir()`      | `files:own`                      | A folder of your own                                           |
| `settings`             | none                             | Your settings                                                  |
| `secrets`              | `secrets:own`                    | Encrypted values per user, `seal`/`unseal` for your own tables |
| `http`, `ws`           | `network:serve`                  | Routes and sockets                                             |
| `rbac`                 | none                             | Check the actor's permissions                                  |
| `hosts`                | `hosts:read`, `hosts:write`      | List, read, create, update and share hosts as the actor        |
| `ssh`                  | `ssh:connect`, `credentials:use` | Connect to hosts through Termix's SSH pipeline                 |
| `credentials`          | varies                           | The actor's saved keys, and protocol logins                    |
| `services`             | per service                      | Call other plugins and offer your own                          |
| `events`               | `events:core` for core topics    | Emit and listen for events                                     |
| `notify`               | `notify:send`                    | Send alerts to the Alerts inbox                                |
| `fetch`                | `network:outbound`               | Outbound HTTP with SSRF protection                             |
| `process`              | `process:spawn`                  | Run programs on the server                                     |
| `schedule`             | none                             | Timers that stop on disable and never overlap                  |
| `audit.record`         | none                             | Write your own audit line                                      |
| `sync`                 | none                             | Sync your tables to a linked desktop                           |
| `auth`                 | `auth:provide`                   | Login methods, second factors, SSH auth types                  |
| `auth.issueUserToken`  | `users:impersonate`              | A short-lived session for calling Termix's API as a user       |
| `users.getLocale`      | `users:read`                     | A user's UI language                                           |
| `system`               | `system:tls`                     | The server's HTTPS certificate                                 |
| `plugins.list()`       | `plugins:read`                   | Which plugins are installed                                    |
| `asUser(userId, fn)`   | always audited                   | Run background work as a user                                  |
| `currentActor()`       | none                             | The user the current call runs for                             |
| `disposables.add(fn)`  | none                             | Extra cleanup on disable                                       |

### The actor

In a route the actor is the signed-in user, set by Termix. `ctx.currentActor()` returns it. Background
work with no request (a timer, an event) uses `ctx.asUser(userId, fn)`, which is audited and still applies
that user's permissions.

Background work that must call Termix's own HTTP API (the Termix CLI, say) asks for a session with
`ctx.auth.issueUserToken(userId, { purpose, ttlSeconds })` and sends it as `Authorization: Bearer <token>`.
It needs `users:impersonate` and `engine.api` `^1.3`, lasts 300 seconds by default and 900 at most, and is
audited as `plugin_user_token_issued`. The user's permissions apply, and it is refused on routes that change
their password, second factors, API keys or linked logins. `ctx.users.getLocale(userId)` gives the user's
UI language, like `zh_CN`, or null, for writing to them in it.

### Routes

Routes live at `/plugin-api/<id>/`, sockets at `/plugin-ws/<id>/`, on the main Termix port. You never need
your own port or an nginx change. Before your handler runs, Termix checks sign in, sets the actor, answers
503 if the plugin is off, parses JSON up to 2 MB and catches errors.

```ts
router.use(ctx.rbac.require("use") as never);

/**
 * @openapi
 * /plugin-api/hello/notes:
 *   post:
 *     summary: Add a note for the signed-in user
 *     tags:
 *       - Hello
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               text:
 *                 type: string
 *     responses:
 *       201:
 *         description: Note added
 *       400:
 *         description: Missing or empty text
 */
router.post("/notes", async (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) return res.status(400).json({ error: "text is required" });
  const db = await ctx.db.client<BetterSQLite3Database>();
  await db
    .insert(notesTable)
    .values({ userId: ctx.currentActor() as string, text });
  await ctx.db.persist();
  res.status(201).json({ success: true });
});
```

- The `@openapi` path is the full path, starting with `/plugin-api/<id>/`. `build` turns these into
  `dist/openapi.json` and the docs site renders them.
- `ctx.http.router({ public: ["/webhook/:token"], bodyLimit: "20mb", rawBody: false })`. Public routes
  have no actor: check their token yourself. Core allows 120 public requests a minute per address;
  `publicRateLimit` raises that for a proxied page that loads its own assets.
- `ctx.http.baseUrl(req)` is the public address, for callback URLs.
- `ctx.ws.route("/live", (socket, conn) => ...)`. Long lived sockets should check
  `conn.isDataUnlocked()` per message.
- `ctx.rbac.require("manage")` on a single route, `await ctx.rbac.has("manage")` in code. A full id like
  `hosts.edit` checks a core permission.
- Host access: `ctx.hosts.checkAccess(hostId, "connect" | "view" | "edit" | "manage")`.

### Errors

Errors from routes, sockets, listeners and timers count against an error budget. Five in a minute and
Termix turns the plugin off (state `failed`). A 4xx you send on purpose doesn't count. Validate input and
send 400s instead of throwing.

### SSH

```ts
const { client, dispose } = await ctx.ssh.connect(hostId, {
  purpose: "hello",
  profile: "background",
});
try {
  // use the ssh2 client
} finally {
  dispose();
}
```

`ctx.ssh.withConnection(hostId, { pool, purpose }, fn)` borrows a pooled connection for frequent short
commands. `@termix-ssh/plugin-sdk/host-commands` has helpers to detect the OS and run package manager and
sudo commands. Hosts from `ctx.hosts` never carry secrets. Pass the host or its id to `ctx.ssh`.

### Events, timers, alerts, services

```ts
ctx.events.on("host.deleted", ({ hostId }) => cleanUp(hostId)); // core topics need events:core
ctx.events.emit("plugin.hello.greeted", { name }); // your own: plugin.<id>.<name>
ctx.schedule.every(60_000, () => refresh(), { jitterMs: 5_000 });
```

- Alerts go through `ctx.notify.send` (`notify:send`). Never build your own notification system.
- Offer a service: declare it in `provides` with a version and a permission, then
  `ctx.services.provide("hello.greetings", impl)`. The name starts with your id. Methods read the caller
  from `ctx.currentActor()`.
- Use a service: declare it in `requires`, then `ctx.services.get<T>("snippets.access")`. It returns
  nothing while no provider runs, so always handle that.

### Shared packages

These come from Termix and are never bundled: `@termix-ssh/plugin-sdk`, `express`, `ssh2`, `ws`, `multer`,
`cookie-parser`, `axios`, `drizzle-orm`, `sharp` and every Node builtin. List the ones you use in
`peerDependencies`. Any other npm package is bundled.

### Workers and WebAssembly

Heavy work (decoding, encoding, parsing) belongs in a worker thread so it never blocks the server. Name
each worker entry in `package.json`:

```json
"termix": { "workers": { "engine": "src/backend/engine/worker.ts" } }
```

`build` bundles it alone into `dist/workers/engine.js`; start it with
`new Worker(new URL("./workers/engine.js", import.meta.url))`. A worker bundles everything it imports and
can't use the shared packages above, so it must not import `@termix-ssh/plugin-sdk`. Talk to it with
`postMessage`.

Importing a `.wasm`, `.ttf` or `.otf` file gives its bytes as a `Uint8Array`, in `build` and in tests, so a module ships
inside the bundle with no file to find. Compile it once on the main thread with `new WebAssembly.Module`
and post that to each worker. Add `declare module "*.wasm" { const bytes: Uint8Array; export default bytes; }`
to a `.d.ts` in the plugin.

## Database

Needs `db:own`. Define tables once in TypeScript, generate migrations for SQLite, PostgreSQL and MySQL,
query with [Drizzle](https://orm.drizzle.team/).

```ts
// src/backend/tables.ts
import {
  defineTable,
  id,
  refUser,
  text,
  timestamp,
} from "@termix-ssh/plugin-sdk/db";

export const notes = defineTable(
  "notes",
  {
    id: id(),
    userId: refUser(),
    text: text().notNull(),
    createdAt: timestamp().notNull().defaultNow(),
  },
  { indexes: [{ name: "idx_p_hello_notes_user_id", columns: ["userId"] }] },
);

export const tables = [notes]; // termix-plugin migrations reads this
```

The table is stored as `p_<id with dashes as underscores>_notes`. Index names should use the same prefix.

| Builder                                        | Type                                                                        |
| ---------------------------------------------- | --------------------------------------------------------------------------- |
| `id()`                                         | Auto increment key                                                          |
| `text()`                                       | Any length string. Not indexable                                            |
| `varchar(n)`                                   | String up to `n` (255 default). Indexable                                   |
| `integer()`, `bigint()`, `real()`, `boolean()` | Numbers and booleans                                                        |
| `timestamp()`                                  | A time, stored as text                                                      |
| `json()`                                       | JSON stored as text. Not indexable                                          |
| `encryptedText()`                              | Text encrypted with the owning user's key                                   |
| `refUser()`                                    | A user id. Rows are deleted with the user and included in their data export |
| `refHost()`                                    | A host id. Rows are deleted with the host                                   |

Modifiers: `.notNull()`, `.unique()`, `.primaryKey()`, `.default(value)`, `.defaultNow()`.

After any change to `tables.ts`, run `npm run migrations` and read the three new files. Renames and type
changes are refused rather than guessed: write those by hand, for all three databases. A migration may only
touch your own tables. `createTestDb` applies them in tests, so a broken one fails `npm test`.

Query through `const db = await ctx.db.client()`, then `await ctx.db.persist()` after writes
(`persist({ lazy: true })` for frequent low value writes). `ctx.db.dialect` says which database runs.

Other storage: `ctx.kv` for a few values, `ctx.settings` for settings, `ctx.secrets` for secrets,
`ctx.files.dataDir()` for files. To sync a table to a linked desktop, use `ctx.sync.registerEntity` and
`contributes.syncEntities`. The entity name is part of the protocol and never changes.

## Frontend

```tsx
import {
  useTranslation,
  type TabProps,
  type TermixApp,
} from "@termix-ssh/plugin-sdk/frontend";
import { EmptyState, PanelShell } from "@termix-ssh/plugin-sdk/ui";
import { Hand } from "lucide-react";

function HelloTab(_props: TabProps) {
  const { t } = useTranslation();
  return (
    <PanelShell icon={<Hand className="size-4" />} title={t("tab.title")}>
      <EmptyState title={t("tab.empty")} />
    </PanelShell>
  );
}

export function activate(app: TermixApp) {
  app.registerRailItem({
    id: "hello",
    icon: Hand,
    titleKey: "tab.title",
    kind: "tab",
    permission: "use",
  });
  app.registerTab("hello", HelloTab, {
    icon: Hand,
    titleKey: "tab.title",
    singleton: true,
    hostless: true,
  });
}
```

Every `register*` returns an undo function, and everything is undone on disable. Each component runs in
your plugin's error boundary and Suspense.

| Member                                                                             | What it does                                                      |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `registerRailItem`                                                                 | A sidebar rail button                                             |
| `registerTab`, `registerPanel`                                                     | A tab type or sidebar panel (id in `contributes.tabs` / `panels`) |
| `registerDashboardCard`                                                            | A dashboard card (`contributes.dashboardCards`)                   |
| `registerHostAction`                                                               | A host button, palette entry or default connect                   |
| `registerHostEditorSection`                                                        | Your own host editor section (host settings get one for free)     |
| `registerHostProtocol`                                                             | A connection protocol next to SSH                                 |
| `registerHostBadge`, `registerHostContextMenuItem`                                 | Badges and menu items on host rows                                |
| `registerPaletteEntry`, `registerPaletteGroup`                                     | Command palette entries                                           |
| `registerKeybindingAction`, `registerKeybindingDefault`                            | Bindable actions                                                  |
| `registerSettingsComponent`                                                        | A component for a `custom` settings field                         |
| `registerAction`, `invokeAction`                                                   | Actions across plugins                                            |
| `registerSlotContribution`, `declareActionSlot`                                    | Fill or own a UI slot                                             |
| `registerComponent`, `registerExtension`                                           | Offer a component by id, add to an extension point                |
| `registerOnboardingStep`                                                           | A first run setup step                                            |
| `registerLoginMethod`, `registerSecondFactorUI`, `registerSshAuthEditor`           | Sign in UI                                                        |
| `api`                                                                              | Axios client for your `/plugin-api/<id>/` routes, auth included   |
| `fetch(path)`, `wsUrl(path)`                                                       | Raw fetch for streams, socket URL and auth                        |
| `docs`, `tabs`, `confirm`, `listHosts`, `getHost`, `t`, `hasPermission`, `desktop` | Helpers                                                           |
| `onSettingsChanged`, `onDispose`                                                   | Hooks                                                             |

Hooks from `@termix-ssh/plugin-sdk/frontend`: `useTranslation`, `usePermission`, `useSettings`, `useHost`,
`useHosts`, `usePluginApi`, `useCurrentUser`, `useTheme`, `useToast`, `useDocsUrl`, `useTabs`,
`useSlotContributions`, `useSshAuthTypes`, `useExtensions`.

Shared from Termix and never bundled: `react`, `react-dom`, `i18next`, `react-i18next`, `sonner` and the
SDK's `frontend` and `ui`. Anything else, like `lucide-react`, is bundled. A host your code gets only carries
your own host settings, under `host.pluginSettings[<id>]`.

Slots you can fill include `terminal.toolbar`, `terminal.toolbarStatus`, `terminal.sidePanel`,
`terminal.overlay`, `dashboard.counters`, `dashboard.hostMetrics`, `admin.userTabs`, `hosts.importMenu`,
`hosts.panel`, `credentials.badges`, `shell.overlay`, `shell.rightEdge` and `tab.menu`. See
https://docs.termix.site/develop/more-extension-points.

## Looking native

Build UI from `@termix-ssh/plugin-sdk/ui` so it matches Termix and follows the theme. The full list of
exports with props is `ui.api.txt` in the Termix repo
(https://github.com/Termix-SSH/Termix/blob/main/packages/plugin-sdk/ui.api.txt).

- Square: panels, cards and containers have no rounded corners. Small controls may stay rounded.
- Flat: borders, not shadows. Use theme tokens like `border-border`, `bg-background`,
  `text-muted-foreground`, `text-destructive`. One accent, `text-accent-brand`. Don't add colors.
- Small type: most text 11 to 13px.
- No new modal dialogs. Ask with `useConfirm()`, open views in place with `InlineView`, and use
  `PanePrompt` for small prompts.
- Every tab or panel sits in `PanelShell`. Lists use `PanelList` and `ListRow`, add with `AddButton`,
  forms end with `FormFooter`, empty lists show `EmptyState`.
- Forms: `TextField`, `NumberField`, `SelectField`, `SwitchRow`, `SecretField`, `SettingRow` and friends.
- Host sessions use `ConnectionGate` for the whole connect flow (host keys, TOTP, passphrases, errors).
- Mobile: check `useIsMobile()` and give small screens a layout that works. The desktop app always uses the
  desktop layout.
- Tailwind classes work. `build` compiles the ones you use against Termix's theme.
- Link to your docs with `DocsLink` or `PanelShell`'s `docs` prop, never a hard coded URL.

## Settings

Declare them in `contributes.settings` and Termix draws the form, stores values, encrypts secrets and
checks saves. You don't build settings UI.

- Scopes: `admin` (for everyone), `user` (each person), `host` (a section in the host editor, with an
  `enableKey` switch first).
- Types: `boolean`, `string`, `number`, `select`, `multiselect`, `secret`, `textarea`, `json`, `custom`.
- Options: `labelKey`, `descriptionKey`, `placeholderKey`, `default`, `options`, `min`, `max`, `requires`,
  `group`, `permission`, `hidden`, `component`.
- Read: `ctx.settings.get(key)`, `getUser(userId, key)`, `getHost(hostId, key)`. Write: `set`, `setHost`.
  React: `ctx.settings.onChange`. Check: `ctx.settings.onValidate("admin", values => ({ key: "message" }))`.
- Frontend: `useSettings("user")` gives values and `save`.

Prefer settings to environment variables. Use an env var only for something needed before Termix starts.

## Permissions

Declare short names in `contributes.permissions`. Termix registers them as `<id>.<name>`. `defaultRoles`
gives them to the built in `admin` and `user` roles on first install. You can't claim a core group
(`hosts`, `credentials`, `admin`) or another plugin's. Labels are locale keys.

## Translations

Every string goes in `locales/en.json`, nested by area. Manifest keys (`titleKey`, `labelKey`) and `t()`
read it from your own namespace. Unknown keys fall back to Termix's shared strings like `common.save`.
Plurals use `_one` and `_other` with `t("hosts", { count })`. Other languages go in
`locales/translated/<code>.json` (like `de_DE.json`) with the same keys. Keep `{{placeholders}}` as they are.
Untranslated strings show in English.

Termix shows your plugin's name and description in the plugin manager, the setup picker and settings.
Put them in `locales/en.json` as `plugin.name` and `plugin.description`, with the same text as `name` and
`description` in the manifest, so they get translated too. Without them, the English manifest text shows in
every language.

```json
{
  "plugin": {
    "name": "Host Metrics",
    "description": "Live CPU, memory, disk, network and GPU stats."
  }
}
```

## Docs

`docs/index.md` is the first page: what the plugin does in a sentence or two, how to turn it on, how to use
it. More pages sit next to it with `title` and `order` front matter. Plain Markdown, no MDX. Images go in
`docs/img/`.

Don't write by hand what is generated: features, settings, permissions, capabilities, env vars, services,
the API reference (from `@openapi`) and the changelog. Write short sentences in plain words and name
buttons exactly as the UI does.

## Auth and protocols

Login methods, second factors and SSH auth types need `auth:provide`, which is high risk and reviewed
closely. Declare ids in `contributes.auth` and register them with `ctx.auth.registerLoginMethod`,
`registerSecondFactor` or `registerSshAuthProvider`. Connection protocols go in `contributes.protocols`
and `app.registerHostProtocol`. Read https://docs.termix.site/develop/auth before starting one.

## Testing

```ts
// vitest.config.ts
import { pluginVitestConfig } from "@termix-ssh/plugin-sdk/vitest-preset";
export default pluginVitestConfig(import.meta.url);
```

Backend tests go in `tests/backend/` (Node), frontend tests in `tests/frontend/` (jsdom). Never next to the
source.

Backend, from `@termix-ssh/plugin-sdk/testing`:

```ts
const db = await createTestDb(pluginDir); // in memory SQLite, your migrations, stub users/ssh_data/roles
let router: Router | null = null;
const mock = createMockCtx({
  pluginId: manifest.id,
  manifest,
  capabilities: manifest.capabilities, // calls outside these throw, like the real thing
  db: db.database,
  router: () => (router = express.Router()),
  permissions: ["hello.use"], // leave out to allow everything
});
await activate(mock.ctx);
mock.setActor("user-1");
```

`createMockCtx` also takes `hosts` and `services`. `createFakeContext()` is a looser double that skips the
capability checks. The template's `tests/backend/routes.test.ts` serves the router with Express and calls
it with `fetch`: start from it.

Frontend:

```tsx
import { renderWithApp } from "@termix-ssh/plugin-sdk/testing";
import * as plugin from "../../src/frontend/index.js";

const app = await renderWithApp(plugin, {
  api: { get: async () => ({ data: [] }) },
});
expect(app.registered.tabs()).toContain("hello");
```

Test every route, with and without the permission. Test that disable then enable works, and that the plugin
works when an optional dependency is missing.

## Running it on a server

1. You need Node 24 and a Termix server (26.10 or newer) you are an admin on. A local Docker one is fine.
2. In Termix, open Settings, General and turn on Plugin developer mode.
3. Make an API key in Settings, API keys.
4. Run `npx termix-plugin dev --server http://localhost:30001 --key tmx_...` (or set `TERMIX_SERVER_URL`
   and `TERMIX_API_KEY`). It builds, installs and reinstalls on every save. Reload the page for frontend
   changes. `--once` installs once.

Or `npm run build && npm run pack` and install the `.tmxplug` from Plugins, Install from file. Dev installs
are marked unverified. You can't use the id of a plugin that ships with Termix, and a registry copy of the
same plugin must be uninstalled first.

## Releasing

Plugins use semver. Work happens on a `dev-X.Y.Z` branch made from `main`, named after the version it will
ship as. `main` only changes when a stable release merges a dev branch into it.

`CHANGELOG.md`, newest first, no `## Unreleased` section and no dates:

```md
# Changelog

## 1.1.0

### Added

- A wave button in the terminal toolbar

### Fixed

- Notes keep their order after a restart
```

Sections: `### Added`, `### Changed`, `### Fixed`, `### Removed`, `### Deprecated`, `### Security`.
`termix-plugin changelog --version 1.1.0` prints one version's notes.

Run the Release workflow by hand from the dev branch on GitHub:

| Choice    | What it does                                                                      |
| --------- | --------------------------------------------------------------------------------- |
| stable    | Tests, builds and publishes `X.Y.Z`, merges the branch into `main` and deletes it |
| beta      | Publishes `X.Y.Z-beta.N`, N counts up on its own                                  |
| overwrite | Releases the manifest version again from this commit                              |
| dry-run   | Builds and packs, publishes nothing                                               |

No secrets are needed. The workflow records GitHub build provenance for the `.tmxplug`, and the run summary
shows the `sha256` for a registry submission. If a dev branch changes `.github/workflows`, add a
`TERMIX_PAT` secret (a token with `repo` and `workflow` scopes). To also sign with your own key, set
`TERMIX_PLUGIN_SIGNING_KEY`. Keep `.github/workflows/release.yml` as the template has it: the community
registry checks provenance from it.

## Submitting to the community registry

Before you submit:

- The repo is public with an open source license, made from the template or using its `release.yml`.
- `npm test`, `npm run typecheck`, `npm run validate` and `npm run build` pass.
- The `id` isn't used by an official plugin or another submission.
- `name`, `description`, `author`, `repository` (your repo) and `docs` (or a README that explains use) are
  set.

Then release a stable or beta version and fork https://github.com/Termix-SSH/Termix-Registry. Add
`community/plugins/<id>.json`:

```json
{
  "$schema": "../../community-submission-schema.json",
  "id": "my-plugin",
  "repository": "https://github.com/you/termix-plugin-my-plugin",
  "maintainers": ["your-github-username"],
  "versions": [
    { "version": "1.0.0", "sha256": "<from the release run summary>" }
  ]
}
```

Open a pull request. The Check submission job downloads the `v<version>` release and checks the `sha256`,
that the manifest inside has your id, version and repo, that it has build provenance from the release
workflow, and that you are a maintainer. Then a person reviews the source at the tag and merges it. The
registry signs it with the community key and lists it a few minutes later.

Reviewers check that:

- The source does what the name and description say, and nothing else.
- Nothing is obfuscated or minified, and no code is downloaded and run at runtime.
- There are no network calls, tracking or telemetry the user didn't ask for.
- Capabilities and permissions are the fewest needed.
- `package.json` scripts and dependencies don't fetch or run anything unexpected at install or build.
- Secrets are only used for what the plugin is for.
- The name and icon don't pretend to be an official plugin.

Every version needs its own PR that adds it to the top of `versions`. Overwriting a reviewed release drops
it from the registry until a new version is submitted. Admins see the plugin once they turn on the community
registry in Plugins, Registries.

To run your own registry instead, see https://docs.termix.site/develop/registries.

## termix-plugin CLI

| Command                        | What it does                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| `build`                        | Bundle `dist/backend.js`, `dist/frontend.js`, workers, CSS, locales, migrations, `openapi.json` |
| `validate`                     | Check the manifest, its files, migrations for every database, the changelog and `package.json`  |
| `test`                         | Apply patches, run Vitest                                                                       |
| `migrations`                   | Write a migration per database from `tables.ts`. `--check` fails when one is missing            |
| `openapi`                      | Write `dist/openapi.json` from `@openapi` blocks                                                |
| `pack`                         | Validate, then write `<id>-<version>.tmxplug`. `--out <dir>`                                    |
| `sign <file>`                  | Sign a `.tmxplug` with `TERMIX_PLUGIN_SIGNING_KEY`                                              |
| `verify <file> --key <base64>` | Check a `.tmxplug` against its `.sig`                                                           |
| `keygen`                       | Write a new signing key pair. `--out <dir>`                                                     |
| `changelog`                    | Print one version's notes. `--version x.y.z`                                                    |
| `patch`                        | Apply the plugin's dependency patches (`build` and `test` do this too)                          |
| `dev`                          | Build, pack and install on a server, again on every change. `--server`, `--key`, `--once`       |

## SDK entry points

| Import                                                               | What it is                                                            |
| -------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `@termix-ssh/plugin-sdk/backend`                                     | `PluginContext` and the backend types                                 |
| `@termix-ssh/plugin-sdk/frontend`                                    | `TermixApp`, `TabProps` and the hooks                                 |
| `@termix-ssh/plugin-sdk/ui`                                          | The UI kit, served by Termix at runtime                               |
| `@termix-ssh/plugin-sdk/db`                                          | `defineTable` and column builders                                     |
| `@termix-ssh/plugin-sdk/manifest`                                    | `PluginManifest` type and manifest checks                             |
| `@termix-ssh/plugin-sdk/capabilities`                                | The capability catalog                                                |
| `@termix-ssh/plugin-sdk/settings`                                    | Settings field validation                                             |
| `@termix-ssh/plugin-sdk/testing`                                     | `createMockCtx`, `createTestDb`, `renderWithApp`, `createFakeContext` |
| `@termix-ssh/plugin-sdk/vitest-preset`                               | `pluginVitestConfig`                                                  |
| `@termix-ssh/plugin-sdk/host-commands`                               | OS detection, package manager and sudo helpers over ssh2              |
| `@termix-ssh/plugin-sdk/ssh-certs`                                   | `applyCertificateAuth()` for certificate based SSH auth               |
| `@termix-ssh/plugin-sdk/desktop`                                     | The desktop app bridge, typed. Check it exists before use             |
| `@termix-ssh/plugin-sdk/openapi`                                     | `buildOpenApi()`                                                      |
| `@termix-ssh/plugin-sdk/changelog`                                   | Changelog parsing and checks                                          |
| `@termix-ssh/plugin-sdk/docs`                                        | Docs link and env var helpers                                         |
| `@termix-ssh/plugin-sdk/ddl`, `@termix-ssh/plugin-sdk/table-builder` | Table to SQL and Drizzle mapping. You rarely need these               |

## Capabilities

| Capability           | Risk     | What it allows                                          |
| -------------------- | -------- | ------------------------------------------------------- |
| `credentials:read`   | critical | Read stored secrets for hosts the user can reach        |
| `system:tls`         | critical | Replace the HTTPS certificate, answer CA domain checks  |
| `ssh:connect`        | high     | Run any command on hosts, with the user's access        |
| `process:spawn`      | high     | Run programs on the Termix server                       |
| `users:write`        | high     | Add users and change their roles                        |
| `users:impersonate`  | high     | Act as another user, or get a session for them, audited |
| `db:core-refs`       | high     | Query core users, roles and hosts tables (read only)    |
| `auth:provide`       | high     | Add login methods, second factors, SSH auth types       |
| `device:serial`      | high     | Open serial and USB ports on the server                 |
| `notify:hub`         | high     | Receive every alert (the alerts hub only)               |
| `hosts:write`        | medium   | Add and edit hosts                                      |
| `credentials:use`    | medium   | Connect with saved credentials without seeing them      |
| `credentials:write`  | medium   | Save new credentials                                    |
| `network:outbound`   | medium   | Outbound HTTP through `ctx.fetch`                       |
| `network:serve`      | medium   | HTTP routes and sockets                                 |
| `network:broadcast`  | medium   | Local network broadcasts, like Wake-on-LAN              |
| `users:read`         | medium   | Usernames, roles and UI language                        |
| `events:core`        | medium   | Listen to core events                                   |
| `notify:send`        | medium   | Send alerts                                             |
| `audit:read`         | medium   | Read the audit log                                      |
| `desktop:window`     | medium   | Open windows in the desktop app                         |
| `hosts:read`         | low      | Read hosts the user can see                             |
| `db:own`             | low      | Your own tables                                         |
| `kv:own`             | low      | Small key value state                                   |
| `files:own`          | low      | Your own folder on disk                                 |
| `secrets:own`        | low      | Your own encrypted secrets                              |
| `settings:read-core` | low      | Read Termix server settings                             |
| `plugins:read`       | low      | See installed plugins                                   |
| `ui:surface`         | low      | Add tabs, panels and settings                           |

An update that adds a capability waits for an admin to approve it.

## Common mistakes

- Tests fail after `npm install`: usually a missing devDependency (`@testing-library/dom`, `jsdom`,
  `better-sqlite3`) or a newer TypeScript major pulled in by another package. Pin `typescript` to the
  template's range.
- `hello-world`, `hello_world` or `Hello World` left over from the template in `package.json`, locales,
  index names, API paths, tab ids or tests.
- Changed `tables.ts` without running `npm run migrations`, or kept the template's `migrations/` folder
  after renaming the id. Delete it and run `npm run migrations` once on a fresh plugin.
- A rail item or tab id that isn't declared in `contributes`.
- A string typed straight into JSX instead of `t()`.
- Forgetting `await ctx.db.persist()` after a write.
- Frontend changes not showing during `dev`: reload the page.
- An id clash with an official plugin: dev installs and registry submissions are refused.

## Where to look next

- Docs: https://docs.termix.site/develop
- Official plugins are all open source and built the same way. Plugin-Workspaces is a small one to start
  from, Plugin-Docker runs commands on hosts, Plugin-Snippets offers a service, Plugin-Automations uses
  services, Plugin-SSO and Plugin-TOTP add sign in, Plugin-Vault adds an SSH auth type and
  Plugin-Remote-Desktop adds a protocol. All at https://github.com/Termix-SSH.
- Help: the Discord at https://discord.gg/jVQGdvHDrf. SDK bugs go in
  https://github.com/Termix-SSH/Termix/issues.
