# Termix plugin guide

SDK 2.2.2 | Plugin API 2.2.0

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
6. Outbound HTTP goes through `ctx.fetch` (needs `network:outbound`), not a raw `fetch` or axios. A socket you
   open yourself (net, tls, dgram, http.request) to an address a user typed goes through `resolveTarget()` from
   `@termix-ssh/plugin-sdk/net-guard` (Termix 26.11.2+), and you connect to the address it returns. Fill
   `allowPrivateHosts` from an admin setting or a saved device address, never from the request or the URL itself.
   Values in shell scripts go through `shellQuote()` or base64 on stdin, and secrets never go in argv.
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
authz.json               who may call each route and socket, checked in CI
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
- [ ] New routes and sockets have an entry in `authz.json` (CI fails without one)
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
| `engine.termix`                        | Termix versions you work with, like `>=26.10.0`. Older Termix builds don't list a release they can't run.           |
| `engine.api`                           | Plugin API range, like `^1.2`. A major bump of the API is breaking.                                                 |
| `capabilities`                         | What your code may do. See the reference at the end.                                                                |
| `dependencies`, `optionalDependencies` | Other plugins, `{ "snippets": "^1.0.0" }`. You must keep working without optional ones.                             |
| `provides`, `requires`                 | Services you offer and use.                                                                                         |
| `env`                                  | Every environment variable your backend reads. `validate` warns about unlisted `process.env.X`. Prefer settings.    |
| `desktop`                              | `mirror` (default), `local` or `server`: how a linked desktop app treats the plugin.                                |
| `nativeDependencies`                   | npm packages with `.node` bindings. Avoid them: community plugins can't count on them.                              |

`contributes` holds `tabs`, `panels`, `dashboardCards`, `actions`, `actionSlots`, `permissions`,
`settings`, `protocols`, `auth`, `syncEntities`, `keybindingActions`, `http`, `guest`, `guestViews`,
`uiPresets`, `uses`, `layouts`, `themes` and `mobile`. Frontend `register*` calls need their ids declared here first.

### Mobile app

`contributes.mobile` says how the plugin shows in the Termix mobile app. Leave it out and the app treats the
plugin as having nothing to show (official plugins are mapped by the app itself).

```json
"mobile": { "mode": "webview", "views": ["hello"], "sizes": ["phone", "tablet"] }
```

| Field     | Notes                                                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`    | `webview` (the app shows your UI from the server), `native` (the app has its own screens) or `none`.                                              |
| `entry`   | `webview` only. A bundle made for the app, like `dist/mobile.js`, next to `frontend.js`. Unset: your normal frontend runs in a phone sized frame. |
| `sizes`   | `webview` only. `phone`, `tablet` or both (the default).                                                                                          |
| `views`   | `webview` only. Ids from your `tabs`, `panels` or `dashboardCards` the app offers. Default: every tab.                                            |
| `feature` | `native` only. The app feature that stands in for the plugin. Default: the plugin id.                                                             |
| `note`    | A locale key or plain text the app shows next to the plugin.                                                                                      |

`build` makes `entry` from `src/mobile/index.tsx`, and it shares `frontend.css`.

How a `webview` plugin runs in the app:

- Only your plugin loads, with the same app object, SDK hooks and `/ui` kit as the web app. Each view opens
  on its own screen: a tab with `host-context-menu` in `openFrom` opens from a host, the rest from the app's
  plugin list.
- Every request and socket goes through the app, which adds the login, proxy headers and client
  certificate. The app only lets through your own `/plugin-api`, `/plugin-ws` and `/plugin-assets`, your
  settings and a short list of core reads (hosts, folders, permissions, current user, version, health,
  activity). Other core routes answer 403, so call your own backend instead.
- Images load straight from the server, without proxy headers or a client certificate.
- Nothing in `localStorage` survives closing the view. Keep preferences in settings.
- Other plugins' views, extensions and components are not there, and neither is the shell (`useShell()`
  is null). `/ui` names newer than the app's copy of the SDK make the view say it needs a newer app.
- The app checks your `engine.api` against the plugin API of its own copy of the SDK. When the app's API
  is too old for the range, it asks the user to update the app instead of opening the view. When the range
  is for an older API major, it asks to update the plugin. Ask only for the API you use.
- Turning a plugin off on the server hides it in the app the next time the app checks: when it comes back
  to the front, when the list is pulled down, or when any request answers 503 with your `pluginId`.

Termix 26.10.5 and older refuse any manifest with `mobile`, so a plugin that declares it needs
`"engine": { "termix": ">=26.10.6", "api": "^1.13" }`.

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

Keep `deactivate()` quick. When the server shuts down, core gives each plugin 2 seconds to stop and then moves on, and programs started with `ctx.process.run` are ended either way.

Bundled as ESM for Node 22+ into `dist/backend.js`. Backend imports of your own files use `.js`.

### The plugin process (API 2)

Your backend runs in its own Node process, never inside the Termix server. It can read only its own
folder and the runtime, writes nothing, and opens no sockets, child processes, workers or native addons
unless a capability grants it. Everything else goes through `ctx`: each call is a message to core, which
checks your capabilities and the acting user, then answers. Secrets, the database connection, SSH
connections and credentials stay in core. In Docker each plugin also runs as its own Linux user.

| Capability        | What your process may then do                                              |
| ----------------- | -------------------------------------------------------------------------- |
| none              | Read your plugin folder, call `ctx`                                        |
| `files:own`       | Write your own data folder (`ctx.files.dataDir()`) with `node:fs`          |
| `network:sockets` | Open listeners and connections (`node:net`, `http`, `tls`, `dgram`, `dns`) |
| `process:spawn`   | Start child processes. Prefer `ctx.process`, which core runs and audits    |
| `device:serial`   | Load native addons (serialport)                                            |

Workers, WASI, `node:sqlite`, the inspector and `process.binding` are never available. Core restarts a
process that crashes, stops answering, goes past its memory limit (256 MiB unless `sandbox.memoryMb`) or
uses more than 80% of a CPU core for a minute. Too many crashes and the plugin is marked failed.
The desktop app runs each plugin in its own process with an empty environment and the same checked `ctx`, but Electron doesn't apply Node's permission flags there, so files, child processes, workers and the memory limit aren't fenced on the desktop.

A plugin that registers nothing core calls on its own starts on its first request or socket and stops
after 10 idle minutes. Anything in the `sandbox` block below, a `provides` entry, a provider hook, a
layout or theme, or `network:sockets` keeps it running.

```json
"sandbox": {
  "schedules": [{ "id": "poll", "every": 60000 }],
  "events": ["host.deleted"],
  "registry": ["my-plugin.variables"],
  "memoryMb": 256,
  "alwaysOn": false
}
```

- `ctx.schedule.every(ms, fn, { id: "poll" })`: the id must be listed in `sandbox.schedules`.
- `ctx.events.on(topic, fn)`: the topic must be listed in `sandbox.events`.
- `ctx.registry.provide(key, value)`: the key must be listed in `sandbox.registry`.
- Only plain data, functions, Buffers, Dates, Maps, Sets and Errors cross between your process and core.
  A class instance (your own or a library's) does not.
- Reads that used to be synchronous return Promises: `services.get`, `services.providers`,
  `registry.consume`, `registry.revoke`, `secrets.withdraw`, `hosts.sessionActive`, `ssh.poolKey`,
  `ssh.classifyKeyboardInteractive`, `ssh.requiresSecret`, `ssh.supportsBackground`,
  `auth.listSecondFactors`, `desktop.available`, `desktop.local.available`. Every method on a service or
  registry value from another plugin returns a Promise too.
- `db.transaction()` is not available. Use `ctx.db.batch([q1, q2])` for writes that must land together.
- Routes need string paths. Core strips `Cookie`, `Authorization`, `X-Api-Key` and
  `Proxy-Authorization` before a request reaches you.
- Your process gets no environment of core's. Variables you list in the manifest's `env` are passed
  through, except core's own secrets and anything that changes how Node starts.
  `VERSION` (the Termix version) and `TERMIX_DEPLOYMENT` (`desktop`, `docker` or `server`) are always set.
- SSH auth providers work: `prepare` gets a copy of the config without secrets and may set only
  `username`, `password`, `privateKey`, `passphrase`, `tryKeyboard`, `readyTimeout`, `timeout`,
  `keepaliveInterval` and `keepaliveCountMax` (a `retry` patch and `connectOptions` too). `env.client` is a stand-in;
  `applyCertificateAuth` knows it and Termix applies the certificate. `onAuthFailed` and
  `connectOptions` answer with a Promise. `startInteraction` gets a socket with only `send` and
  `on("close")`. `onBanner` and `onKeyboardInteractive` get the host without secrets and answer with a
  Promise; one that takes over 5 seconds counts as no answer.
- Login methods work. `start`, `callback` and `verify` get a plain copy of the request (`body`, `query`,
  `headers` without core's cookies, `ip`; `ctx.http.baseUrl(request)` works on it) and `request.res`
  with only `cookie` and `clearCookie`, for cookies named `tmxp_<your id with _>_...`. A thrown
  `LoginMethodError` keeps its `status`, `code` and `returnTo`. `ctx.auth.completeRedirectLogin(id, req,
res)` works from inside one of your own requests: Termix finishes the login on the live response.
- Keyboard-interactive handlers work. `detect` and `autoAnswerPasswords` get the host without secrets and
  answer with a Promise, with the same 5 second limit. Anything that reads `ctx.ssh.classifyKeyboardInteractive`
  or a prepared `onBanner` must await it.
- `ctx.process.run` works as before; core runs the program and `exited` resolves when it ends.
- Looking up a host name with `node:dns` needs `network:sockets`. With `network:probe`, call
  `ctx.network.lookup(name, { family: 4 })` instead: Termix looks it up and answers the first address or null.
- Cookies: requests reach you with only cookies named `tmxp_<your id with _>_...`, and a
  `Set-Cookie` you send is kept only for those names and without a `Domain`. Core's own login
  cookies never reach your process.
- `files:own` lets your process read and write its data folder.
- Not available in a plugin process yet: `ssh.prepare`, `ssh.openTransport`, `ssh.jumpChain`,
  `hosts.locks.provide`, `hosts.status.provide`, `sync.provide` and `desktop.local`. Plugins that need
  them stay on API 1 for now.

### Moving from API 1

1. Raise `engine.api` to `^2.0.0`, `engine.termix` to the first core that runs plugin processes, and the
   SDK in `package.json` to `^2.0.0`.
2. List your schedules (with an `id` on each `every`), event topics and registry keys in `sandbox`.
3. Await the reads listed above, and every call on another plugin's service or registry value.
4. Replace `db.transaction()` with `ctx.db.batch()`.
5. Move direct `node:fs`, `net`, `http`, `child_process` use to `ctx`, or declare the capability that
   allows it. `termix-plugin validate` warns about each import that would be refused.
6. Run your tests with `createMockCtx({ sandbox: true })`, which applies the same rules, and check the
   frontend with `checkFrameApp` (see Frames).
7. Drop capabilities you no longer use, bump the version and add a CHANGELOG entry.

An API 1 plugin keeps working only when it is official and an admin turns on "Run without isolation" for
it. Community API 1 plugins don't run.

### What ctx has

| Member                 | Capability                       | What it does                                                    |
| ---------------------- | -------------------------------- | --------------------------------------------------------------- |
| `pluginId`, `manifest` | none                             | Your id and manifest                                            |
| `log`                  | none                             | Log lines tagged with your plugin                               |
| `db`                   | `db:own`                         | Your own tables                                                 |
| `kv`                   | `kv:own`                         | Small key value state                                           |
| `files.dataDir()`      | `files:own`                      | A folder of your own                                            |
| `settings`             | none                             | Your settings                                                   |
| `secrets`              | `secrets:own`                    | Encrypted values per user, `seal`/`unseal` for your own tables  |
| `http`, `ws`           | `network:serve`                  | Routes and sockets                                              |
| `rbac`                 | none                             | Check the actor's permissions                                   |
| `hosts`                | `hosts:read`, `hosts:write`      | List, read, create, update and share hosts as the actor         |
| `ssh`                  | `ssh:connect`, `credentials:use` | Connect to hosts through Termix's SSH pipeline                  |
| `credentials`          | varies                           | The actor's saved keys, and protocol logins                     |
| `services`             | per service                      | Call other plugins and offer your own                           |
| `events`               | `events:core` for core topics    | Emit and listen for events                                      |
| `notify`               | `notify:send`                    | Send alerts to the Alerts inbox                                 |
| `fetch`                | `network:outbound`               | Outbound HTTP with SSRF protection                              |
| `process`              | `process:spawn`                  | Run programs on the server                                      |
| `schedule`             | none                             | Timers that stop on disable and never overlap                   |
| `audit.record`         | none                             | Write your own audit line                                       |
| `sync`                 | none                             | Sync your tables to a linked desktop                            |
| `auth`                 | `auth:provide`                   | Login methods, second factors, SSH auth types                   |
| `auth.issueUserToken`  | `users:impersonate`              | A short-lived session for calling Termix's API as a user        |
| `auth.policy`          | `auth:policy`                    | Login rules: idle timeout, session length, second factors       |
| `sync.provide`         | `sync:provide`                   | Answers all /sync requests: server sync, linked desktops        |
| `ssh.transports`       | `ssh:transport`                  | Carries a host's SSH connection over your own stream            |
| `hosts.folders`        | `hosts:write`                    | Create a folder row with a color and icon, remove it when empty |
| `users.getLocale`      | `users:read`                     | A user's UI language                                            |
| `system`               | `system:tls`                     | The server's HTTPS certificate                                  |
| `plugins.list()`       | `plugins:read`                   | Which plugins are installed                                     |
| `asUser(userId, fn)`   | always audited                   | Run background work as a user                                   |
| `currentActor()`       | none                             | The user the current call runs for                              |
| `disposables.add(fn)`  | none                             | Extra cleanup on disable                                        |

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
  `conn.isDataUnlocked()` per message. Core closes a socket (code 1008) within a few seconds of the login
  that opened it ending: sign out, revoke, password change, expiry or idle timeout. A public socket that came
  with a login ends with it too. Keep your own detach and reattach logic for that close. Sockets follow the
  same session rules as HTTP, so a session that must set up a second factor only reaches second factor
  plugins.
- `ctx.rbac.require("manage")` on a single route, `await ctx.rbac.has("manage")` in code. A full id like
  `hosts.edit` checks a core permission.
- Host access: `ctx.hosts.checkAccess(hostId, "connect" | "view" | "edit" | "manage")`.
- Transports: with `ssh:transport`, `ctx.ssh.transports.provide({ claims(hostId, host), open(host) })`, where `host` has `id`, `ip`, `port` and on Termix 26.10.6+ also `userId`, `syncId`, `connectionOrigin` and `localOnly`
  returns a stream the SSH client uses instead of a direct, proxy or jump host connection. Core also serves
  `/plugin-ws/core/ssh-relay?hostId=` for callers with connect access, so one Termix can relay to another.
- Managed hosts: with `hosts:lock`, `ctx.hosts.locks.provide({ isLocked, note, allowManualCreate })` makes
  the hosts you manage read only for the UI, the API and other plugins (pins and order still work), and
  `allowManualCreate: () => false` blocks adding hosts by hand. Your own `ctx.hosts` writes still go
  through. `ctx.hosts.setShares(hostId, grants)` replaces a host's whole grant list, and
  `ctx.credentials.list()` finds the acting user's credentials by name.
- `ctx.credentials.setSshKeyCertificate(credentialId, certificate)` stores a CA-signed OpenSSH
  certificate (a `-cert.pub` line, or `null` to clear it) on one of the acting user's SSH key
  credentials. Core then offers key plus certificate on every connection through that credential, so a
  plugin that issues certificates can keep the credential current instead of asking the user to paste it.
- Second factor checks: `input.stepUpAt` is when the user last proved a second factor while signed in (Termix
  26.11.1+). Answer `request` with `requestKind: "verify"` and a tab of yours that calls `/ui` `listStepUpFactors`,
  `challengeStepUp` and `verifyStepUp`, drawing the factor with `useSecondFactors`.
- Connect policy: with `hosts:connect-policy`, `ctx.hosts.connectPolicy.provide({ check(input) })` is asked
  before every SSH config is built and every remote desktop login is handed out (`input` has `userId`,
  `hostId`, `protocol`, `purpose`, `profile`, `interactive`, `origin`). Return `{ decision: "allow" }`,
  `{ decision: "deny", reason }` or `{ decision: "request", reason, requestTab }`. The strictest answer of
  all providers wins and a provider that throws denies. SSH prepare then gives an error outcome with code
  `access-denied` or `access-required`, and `ctx.credentials.resolveHostProtocol` throws an error with that
  `code` and a `toJSON()` body for a 403. Keep `check` fast, it also runs for background polling.

Headers and cookies (Termix 26.11.2+): every answer from `/plugin-api/<id>/` and `/plugin-assets/<id>/` carries
`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` and a default
`Content-Security-Policy: object-src 'none'; base-uri 'none'; frame-ancestors 'self'`, so only Termix itself can
frame a plugin page. A route that serves its own HTML page sets its own `Content-Security-Policy`, which replaces
the default. Over HTTPS the session cookie is `__Host-jwt`; core
rewrites the request so plugins still read it as `req.cookies.jwt` and in the `Cookie` header as `jwt`.

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
sudo commands. `@termix-ssh/plugin-sdk/host-scripts` builds Docker, metrics, systemd and journal
commands and parses their output; send a script on stdin to the command `scriptShell()` returns. Hosts from
`ctx.hosts` never carry secrets. Pass the host or its id to `ctx.ssh`.

A connection with no terminal to prompt on refuses a host whose key was never trusted, unless the admin
turned on trust on first use. The error has code `HOST_KEY_UNVERIFIED` (or `HOST_KEY_CHANGED`) and tells the
user to open a terminal to the host once. Show that message as it is.

### The desktop app

Set `"runtime": "desktop"` in the manifest for a plugin that only makes sense on a desktop app. It never
loads on a server, ignores server sync and may declare `desktop:local`. Any plugin can declare
`desktop:local` and check `ctx.desktop.local.available()` at runtime.

`ctx.desktop.local` works on the desktop app's own backend only:

- `info()`: home folder, platform, user data folder, backend port and the linked server (url and token) or null
- `fs`: `list`, `mkdir`, `createFile`, `rename`, `ensureDir`, `exists`, `walk`, `trash`, `reveal`, `open`,
  `openRead` and `openDownload`. Downloads stay inside the folder the user picked, links in it are refused and
  an existing file is never replaced by accident
- `pty.spawn()`: a local shell, stopped when the plugin stops
- `pluginFetch(origin, subPath, init)`: calls this plugin's own routes on the desktop's backend ("local") or the linked server ("remote") as the acting user. Bodies can be streams, so a plugin can move big files without the renderer

On the desktop app `process.execPath` is the Electron app, which can't start as plain Node. Never spawn it
to run a script; run that code in a `worker_threads` Worker (with its own `env` and `argv`) instead.

Use `ctx.audit.subscribe`, `list` and `exportBatches` (`audit:read`) to read the audit trail. Subscribers
are called after a line is stored and never delay the action that wrote it.

Every stored line carries `hash` and `prevHash`: each hash covers the line before, so a changed or removed line
breaks the chain. `ctx.audit.chain.status()` gives core's last hourly check, `verify()` runs one now and
`checkHead({ id, hash })` compares a head someone saved earlier (Termix 26.11.2+, API 2.2). Core alerts admins
itself when the chain breaks, so a plugin only shows it.

### Events, timers, alerts, services

```ts
ctx.events.on("host.deleted", ({ hostId }) => cleanUp(hostId)); // core topics need events:core
ctx.events.emit("plugin.hello.greeted", { name }); // your own: plugin.<id>.<name>
ctx.schedule.every(60_000, () => refresh(), { id: "refresh", jitterMs: 5_000 });
```

- Alerts go through `ctx.notify.send` (`notify:send`). Never build your own notification system.
- Offer a service: declare it in `provides` with a version and a permission, then
  `ctx.services.provide("hello.greetings", impl)`. The name starts with your id. Methods read the caller
  from `ctx.currentActor()`.
- Use a service: declare it in `requires`, then `await ctx.services.get<T>("snippets.access")`. Every
  method on it returns a Promise. Calls fail while no provider runs, so always handle that.

### Operations

Declare what your plugin can do in `contributes.operations`, and it shows up in Automations, Fleets, the
assistant, the CLI, the phone app and the command palette with no other wiring. It also gets per host results,
dry runs, run history, approvals and drift checks.

```json
"capabilities": ["operations:provide"],
"engine": { "termix": ">=26.11.1-0", "api": "^1.13" },
"contributes": {
  "operations": {
    "actions": [{
      "id": "demo.restart",
      "titleKey": "ops.restart.title",
      "scope": "host",
      "inputs": [{ "key": "name", "type": "string", "labelKey": "ops.restart.name", "required": true }],
      "risk": "change",
      "permission": "use",
      "hostAccess": "edit",
      "dryRun": "describe"
    }]
  }
}
```

```ts
ctx.operations.register("demo.restart", {
  describe: (input) => `Would restart ${input.name}`,
  run: async (input, { hostId, signal, log }) => {
    return { summary: `Restarted ${input.name}`, changed: true };
  },
});
```

- Actions: `scope` is `host`, `resource` or `server`. `risk` is `read`, `change` or `destructive`. Host actions declare
  `hostAccess`. Use `edit` for changes unless people with `connect` already do this today. A destructive action
  must use `edit` or `manage` and needs a confirm.
- Inputs use the settings field types, plus `required`, `pattern`, `optionsFrom` (a read action fills the choices)
  and type `resource`. Keys you did not declare are refused before your handler runs. `secret` values reach the handler
  but are never stored or shown. Mark private outputs `sensitive`.
- `dryRun`: `native` calls `run` with `dryRun: true` and nothing may change. `describe` calls `describe` instead.
- `check` names a read action that proves the result, used for drift. `undo` names the reverse action, and `run` returns
  `undoInput`. `idempotent` lets a rollout retry it. `exclusive` allows one at a time per host. `when` limits it to
  hosts by setting or OS.
- `surfaces`: the assistant and MCP are off until you set them true. Only do that for actions safe for a model to
  ask for. The rest are on unless you set them false.
- Resources describe a kind of thing, such as a container: a read action on one host returns `{ rows }` as `data`, and
  core draws the All hosts table and host page section. Attach actions with `scope: "resource"`.
- Signals are status tiles: a read action returns `{ value, status, label }` as `data`, with status `ok`, `warn`, `fail` or
  `unknown`. `fix` names the action offered when it is not ok. Keep these reads cheap, they run for every host.
- Events: declare them, then call `ctx.operations.emit(id, payload, { hostId })`.
- Handlers must watch `signal` and stop when it fires. Throw on failure; a failed run never counts against your
  plugin's error budget. Throw an error with `code = "NEEDS_INTERACTION"` when a host needs a person to sign in first.
- Handlers have no request and no session. Take what you need from the input and `hostId`.
- Keep your REST routes. Inside one, call `ctx.operations.run(id, { hostId, input })` so a button press goes through
  the same checks and lands in the same history.
- To run another plugin's action, add `operations:invoke`, list it in `operations.invokes` and call
  `ctx.operations.invoke(id, { hostId, input, via: "automation" })`. It acts as the current user and rules still apply.
- `risk` is your plugin's claim. Plugins run in-process, so this is not a sandbox. Actions from plugins not signed as
  official count as `change` when rules decide what needs a person, and stay off the assistant and MCP until an admin
  allows them.
- Set `engine.termix` to at least `>=26.11.1-0`. Keep `engine.api` as it was unless you import something new from
  `/ui`, or the phone app will ask people to update to see your plugin.

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

Other storage: `ctx.kv` for a few values (`get` answers `null` for a key never set), `ctx.settings` for settings, `ctx.secrets` for secrets,
`ctx.files.dataDir()` for files. To sync a table to a linked desktop, use `ctx.sync.registerEntity` and
`contributes.syncEntities`. The entity name is part of the protocol and never changes.

A registered table syncs the rows each user owns, both ways. A table with a unique key besides `id` (one row per
host) should set `matchOn: ["hostId"]` (Termix 26.11.1+): when both sides made that row, the inbound one takes over
the local row instead of failing on the key. For data you keep for the whole server (a shared
library, rows other users share), register a read only entity with `table: null`, `readOnly: true` and `load`,
`write` and `erase` (Termix 26.10.6+). `load(userId)` returns the rows that user should get, each with a
`syncId`. The desktop keeps them with `write` and drops them with `erase`, and never pushes them back:

```ts
ctx.sync.registerEntity({
  type: "sharedIcons",
  table: null,
  readOnly: true,
  order: 70,
  load: (userId) => iconsVisibleTo(userId),
  write: (userId, row) => storeCopy(userId, row),
  erase: (userId, syncId) => dropCopy(userId, syncId),
});
```

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
| `registerCompanion`, `toggleCompanion`                                             | A panel beside any host tab, bound to its host and handle         |
| `registerCompanionLayout`                                                          | Per host on/off, side, order and hidden panels for a tab type     |
| `registerDashboardCard`                                                            | A dashboard card (`contributes.dashboardCards`)                   |
| `registerHostAction`                                                               | A host button, palette entry or default connect                   |
| `registerHostEditorSection`                                                        | Your own host editor section (host settings get one for free)     |
| `registerHostProtocol`                                                             | A connection protocol next to SSH                                 |
| `registerHostBadge`, `registerHostContextMenuItem`                                 | Badges and menu items on host rows                                |
| `registerHostStatusIndicator`                                                      | The status dot or stripe on a host row (a layout draws it)        |
| `registerHostEditorToolbarItem`                                                    | A control in the host editor toolbar (a layout draws it)          |
| `registerPaletteEntry`, `registerPaletteGroup`                                     | Command palette entries                                           |
| `registerKeybindingAction`, `registerKeybindingDefault`                            | Bindable actions                                                  |
| `registerSettingsComponent`                                                        | A component for a `custom` settings field                         |
| `registerAction`, `invokeAction`                                                   | Actions across plugins                                            |
| `registerSlotContribution`, `declareActionSlot`                                    | Fill or own a UI slot                                             |
| `registerComponent`, `registerExtension`                                           | Offer a component by id, add to an extension point                |
| `registerOnboardingStep`                                                           | A first run setup step (`section`, `position`, `replaces`)        |
| `registerLoginMethod`, `registerSecondFactorUI`, `registerSshAuthEditor`           | Sign in UI                                                        |
| `registerLayout`                                                                   | A whole-app layout (`contributes.layouts`, API 1.4)               |
| `api`                                                                              | Axios client for your `/plugin-api/<id>/` routes, auth included   |
| `fetch(path)`, `wsUrl(path)`                                                       | Raw fetch for streams, socket URL and auth                        |
| `docs`, `tabs`, `confirm`, `listHosts`, `getHost`, `t`, `hasPermission`, `desktop` | Helpers                                                           |
| `onSettingsChanged`, `onDispose`                                                   | Hooks                                                             |

Badges, status indicators and toolbar items take `{ id, when(host), component, order? }`; lower `order`
comes first. An onboarding step sits in a section (`start`, `setup`, `explore`, `security`) or at an exact
`position` from 1 to 99. `replaces: ["preset"]` lists older step keys the step took over, so people who saw
those are not shown it again.

Branding: a plugin that owns the app name, tagline and logo provides
`ctx.registry.provide("<id>.brandingProvider", async () => ({ appName, tagline, logo }))` in its backend.
Core reads it for `GET /users/branding` (the login page, the browser tab and the sync server name) and falls
back to "Termix" with no logo when no plugin provides one. `logo` is a PNG data URL or null.

Hooks from `@termix-ssh/plugin-sdk/frontend`: `useTranslation`, `usePermission`, `useSettings`, `useHost`,
`useHosts`, `usePluginApi`, `useCurrentUser`, `useTheme`, `useToast`, `useDocsUrl`, `useTabs`,
`useSlotContributions`, `useSshAuthTypes`, `useExtensions`, `useShell`.

Shared from Termix and never bundled: `react`, `react-dom`, `i18next`, `react-i18next`, `sonner` and the
SDK's `frontend` and `ui`. Anything else, like `lucide-react`, is bundled. A host your code gets only carries
your own host settings, under `host.pluginSettings[<id>]`.

### Frames (API 2)

A plugin API 2 frontend never runs in the app's page. Termix 26.11.2 and newer load it into sandboxed
frames (`sandbox="allow-scripts"`, an opaque origin, no cookies), served from your own
`/plugin-assets/<id>/_frame/`. Your code stays the same: `activate(app)`, the hooks and the UI kit work as
before, with the same look and theme.

- One hidden background frame runs `activate` and keeps what has no view of its own: actions, palette
  groups and entries, keybinding runs, rail badges, host dots, companion defaults and `shell.overlay`
  components. Every view (tab, panel, card, companion, widget, settings component, host editor section,
  slot component) is its own frame, which runs `activate` too. `app.frame.role` is `"background"` or
  `"view"`; skip polling and timers in views.
- Module state is per frame. Code that opens a dialog from anywhere (a palette run, a keybinding) belongs
  in the background frame, next to its `shell.overlay` component.
- What you register reaches the shell as data. Icons must come from `lucide-react` (the shell draws them
  by name). Functions become calls into your frame, so a sync callback the shell reads while drawing
  (`when`, `label`, `items`, `validate`, `visible`) answers its safe default first, then your real
  answer once the frame replied. Keep them cheap and pure.
- A companion's `getHandle()` returns a handle whose methods return promises. `sendInput` and `paste`
  need `terminal.sendToActive` or `terminal.sendToSession` in your manifest `uses`.
- `app.api`, `app.fetch` and `app.wsUrl` reach only your own routes, with a short token the shell renews.
  The SDK hooks and the UI kit read core through the shell, which allows a fixed list: the user, their
  permissions, hosts (with only your settings), credentials without secrets, your own settings, operations
  and activity. Saved passwords are not available to a frame.
- `invokeAction` runs your own actions and the ids in your manifest `uses`. Opening links, downloads,
  the clipboard, toasts and confirms go through the shell. `localStorage` works and is kept per plugin.
- Not available in a frame: host badges with a `component` (use `useDot`), host status indicators, host
  editor toolbar items, `useShell`, and other plugins' components from `usePluginComponent`,
  `useExtensions` or `useSlotContributions`. Layouts, themes, login screens and native desktop views are
  the shell itself: only an official plugin with `ui:layout`, `ui:theme`, `auth:provide` or
  `desktop:window` runs in the page.
- A popover or dropdown can't leave its frame. Keep menus in tabs and panels, not in small slots.

Check that your activate works in a frame with `checkFrameApp` from `@termix-ssh/plugin-sdk/testing`:

```ts
import { checkFrameApp } from "@termix-ssh/plugin-sdk/testing";
import manifest from "../../manifest.json";
import * as plugin from "../../src/frontend";

it("runs in a frame", async () => {
  const { problems } = await checkFrameApp(plugin, { manifest });
  expect(problems).toEqual([]);
});
```

It returns a `FrameCheckResult` with each registration as the shell would get it and the `problems`
found. `app.frame` is a `FrameInfo`.

Slots you can fill include `terminal.toolbar`, `terminal.toolbarStatus`, `terminal.sidePanel`,
`terminal.overlay`, `dashboard.counters`, `dashboard.hostMetrics`, `admin.userTabs`, `hosts.importMenu`,
`hosts.panel`, `credentials.badges`, `shell.overlay`, `shell.rightEdge` and `tab.menu`. See
https://docs.termix.site/develop/more-extension-points.

## Layouts and themes

A plugin can replace the whole app layout or add themes (API 1.4). Users pick both in Settings, Appearance;
admins set the default for everyone.

A layout is declared in `contributes.layouts` (`id`, `label`, optional `description` and `defaultTheme`) and
needs the `ui:layout` capability, which admins see as high risk because a layout draws every screen. Register
it in `activate`:

```tsx
import { useShell, type TermixApp } from "@termix-ssh/plugin-sdk/frontend";
import {
  ShellConfirmCapture,
  SurfaceScope,
  TabStage,
} from "@termix-ssh/plugin-sdk/ui";

function MyLayout() {
  const shell = useShell();
  if (!shell) return null;
  return (
    <div className="flex h-dvh w-screen flex-col bg-background">
      <header>
        {/* tabs from shell.tabs.topLevel, shell.palette.open() and so on */}
      </header>
      <SurfaceScope kind="tab">
        <ShellConfirmCapture />
        <TabStage />
      </SurfaceScope>
    </div>
  );
}

export function activate(app: TermixApp) {
  app.registerLayout({
    id: "my-layout",
    label: "layout.name",
    component: MyLayout,
  });
}
```

- `useShell()` is the live shell with nothing drawn: tabs, splits, hosts, the left and right docks, the
  command palette, the registries as hooks and the user. Core keeps all the state, so switching layouts keeps
  every session.
- `TabStage` is where tabs show. Place it anywhere; tabs are never remounted when it moves, so a terminal
  keeps its connection. Wrap it in `SurfaceScope kind="tab"` with a `ShellConfirmCapture` inside, so
  close questions and inline views show over the tab area. Overlays and onboarding stay in core.
- The layout draws the command palette. Core keeps whether it is open (`palette.isOpen`, Ctrl+K calls
  `palette.open()`) and what is in it (`usePaletteEntries`, `usePaletteGroups`, rail items, hosts).
- The shell always keeps a home tab with the id and type `dashboard`. `useShell()` leaves it out until some
  plugin registers a `dashboard` tab type, so a layout without a home screen has no empty tab to draw.
- Settings, Manage and the host editor belong to Classic Layout. A layout without them should still render
  `LookSettings` somewhere so people can switch back. `tabs.openSingleton("plugins")` opens core's own
  Plugins tab in any layout. Switching layouts closes the tabs the old layout's plugin declared.
- `mobileComponent` is used on phones and narrow windows. The desktop app always gets `component`.
- Only the chosen layout's plugin is loaded. If it fails to load or crashes twice, Termix shows a repair
  screen where people can switch, reset, update, turn it off or (for a bundled plugin) restore the copy that
  shipped. `?safe-layout=1` opens it any time.
- Termix has no layout of its own. The default is the bundled Classic Layout plugin
  (https://github.com/Termix-SSH/Plugin-Classic-Layout), which is also a full example. It owns the rail,
  sidebar, tab bar, docks, Dashboard, Manage, Settings and command palette, registers the `dashboard`,
  `host-manager` and `settings` tab types, and offers the host list and dashboard as the components
  `classic-layout.hostTree` and `classic-layout.dashboard` for other plugins to place with `PluginComponent`.
  It reads the shell with `useShellController()` from `@termix-ssh/plugin-sdk/ui`, which exposes more than
  `useShell()` and may change with Termix. A third party layout should start from `useShell()`.

A theme is CSS only. Declare it in `contributes.themes` (`id`, `label`, `mode` light or dark, `css` path,
optional `swatch` colors for the picker) with the `ui:theme` capability. The id becomes a class on `<html>`,
so the file may only hold rules whose selectors start with `.<id>`, `:root.<id>` or `html.<id>`, optionally
inside `@media` or `@supports`. `@import`, `url()` to another host and other at-rules are refused by
`termix-plugin validate` and by the server. Set the same tokens core's themes set (`--background`,
`--foreground`, `--card`, `--border`, `--muted` and the rest).

A plugin that only holds themes needs no code. Leave out `src/`: `termix-plugin build` writes an empty backend and
`validate` does not ask for a frontend. Keep the CSS in `themes/` and a test that checks it with
`validateThemeCss()`. Notes:

- A theme with the id of a built-in (`light` or `dark`) replaces core's basic copy while the plugin runs.
- The first theme a bundled default-look plugin lists is the default for new installs.
- Themes show in the picker in the order core lists its own, then the plugin's order.
- A theme someone saved that no longer exists shows as System. It comes back when the plugin does.
- Accent color, UI font, font size and density are not part of a theme. Core applies them on top.
- Bundled Classic Themes (https://github.com/Termix-SSH/Plugin-Classic-Themes) is a full example.

## Looking native

Build UI from `@termix-ssh/plugin-sdk/ui` so it matches Termix and follows the theme. The full list of
exports with props is `ui.api.txt` in the Termix repo
(https://github.com/Termix-SSH/Termix/blob/main/packages/plugin-sdk/ui.api.txt).

- Web pages that break in an iframe: `NativeView` (props `url`, `ignoreCert`, `hidden`, `fallback`) shows the
  page in a native view in the desktop app. It fills its element, hides while a dialog or menu is open and renders
  `fallback` in a browser.
- Square: panels, cards and containers have no rounded corners. Small controls may stay rounded.
- Flat: borders, not shadows. Use theme tokens like `border-border`, `bg-background`,
  `text-muted-foreground`, `text-destructive`. One accent, `text-accent-brand`. Don't add colors.
- Small type: most text 11 to 13px.
- No new modal dialogs. Ask with `useConfirm()`, open views in place with `InlineView`, and use
  `PanePrompt` for small prompts.
- Every tab or panel sits in `PanelShell` (inside `PanelFrame` when it is a tab). Lists use `PanelList` and
  `ListRow`, add with `AddButton`, forms end with `FormFooter`, empty lists show `EmptyState`, loading shows
  `LoadingState`, and "not installed" or "no access" shows `NoticePanel`.
- The tile look: page content sits edge to edge on the page background, with one line between sections and
  no gaps, padding or card fill around them. The body of a `PanelShell` has no padding. Stack sections with
  `TileStack` (or `TileColumn` when cards sit deeper), put numbers and small cards in a `TileWall` of
  `StatTile` or `MetricCard`, and use `TileFrame` for a titled section. Cards drop their own box inside
  these. Forms keep `PANEL.body` padding inside their section. An `InlineView` form made of `SectionCard`s
  takes `stacked`.
- Page views go in `PanelShell`'s `tabs` band as a `TabStrip`. `Segmented` is for filters and view modes and
  keeps its natural width, never stretched across the pane. A page with many sections uses `SideNav` on the
  left. Put the refresh button in the header with `RefreshButton`, and the docs link with the `docs` prop.
- Toolbars: search, filters and buttons go in `PanelShell`'s `toolbar` slot, or in a `ToolbarBand` for a second
  row. Both make every control in the row 32px, so a `size="sm"` button lines up with a search box. Use
  `ToolbarSelect` for a small select there, never a native `<select>`. Don't build your own row with its own
  padding.
- Padding: loose content in a page body (a hint, a single field) takes `PANEL.body`. A `SectionCard` body uses
  `PANEL.section` for its fields.
- Headers have no background. Label a group with `GroupHeading`, never a row with `bg-muted`.
- Sub views: a detail or edit view opens as an `InlineView`, which has the one back button. Anywhere else use
  `BackButton` in `PanelShell`'s `leading` slot. Never make a smaller back button.
- Save and Add always sit pinned at the bottom: pass `FormFooter` to `InlineView` or `PanelShell` as `footer`.
  Inside a tab body, wrap the form in `<PanelShell chrome={false} footer={...}>`.
- Loading: `LoadingState` for anything still loading (`compact` in cards and rows). A spinner on its own is
  only for a button or an activity like "working".
- Config and log editors fill the rest of the view: `TextAreaField fill`, or `min-h-0 flex-1` on a log, never a
  fixed number of rows or a `max-h-[60vh]`.
- Host row dots: report a problem with `registerHostBadge({ useDot })` instead of drawing a dot. The layout
  merges every plugin's dots into one.
- `termix-plugin validate` lists drift from these rules under `ui`. They are warnings, so fix what applies.
- States and data: `StatusBadge` and `StatusDot` (pass a state like "running" and the color follows),
  `InfoGrid` for label and value pairs, `DataTable` for a plain table, `Pager` and `usePaged` under long lists.
- Tile pages use `TileGrid` with `TileFrame` around each tile and `TilePicker` beside it while editing. Slots are
  `{ id, x, y, w, h }` on 12 columns (`h` null for the natural height); save them where your plugin keeps
  preferences and run saved ones through `sanitizeTiles`. Add with `appendTile`. While editing, show
  `TileEditBar` over the grid. Needs Termix 26.11.1.
- A dashboard card with `entries` can be placed many times: each entry has a title, a group and a `config` the
  card gets back as `config` (save changes with `setConfig`, keep it small). Operations Center uses this for
  status and action tiles.
- Card grids use `DataView` with `ViewToggle` (the cards share lines like a `TileWall`). Pass `columns` and `onColumns` to `ViewToggle` and the same
  value as `size` to `DataView`, so users can pick Auto (as many as fit) or a fixed number of cards per
  row. `usePluginPanelView` keeps the choice as `columns`. Older Termix versions ignore both props.
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
  `group`, `permission`, `hidden`, `component`. `permission` is checked on every write: the editor, host imports,
  bulk edits, host defaults and sync.
- `contributes.settings.host.enablePermission` limits who may flip the host switch, the same way (API 1.17,
  core 26.11.1+). Without it anyone with host edit can.
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

To tie an external identity to an account that already exists, `ctx.auth.identities` has `list(userId)`,
`link(userId, { provider, subject, email })` and `unlink(userId, provider)` (Termix 26.11.1+). `link` refuses an
identity another account holds and `unlink` refuses to take away a user's last way to sign in. Both are audited.

Login rules need `auth:policy`. `ctx.auth.policy.provide({ evaluate, allowRememberDevice })` is asked at
every login with the user, the method, the device and every second factor (`ctx.auth.listSecondFactors()`
lists them too). `evaluate` returns `allowRememberDevice`, `maxSessionSeconds`, `idleTimeoutSeconds` and
`secondFactor` (`"always"` or `"new-device"`). The strictest answer from all plugins wins, and a throw
refuses the login. A user who must have a second factor but has none gets a session that can only set one
up, and `/users/me` reports `restriction: "second-factor-setup"`.

Every login also fires `internal.event` with `event: "user_login"` and `details` holding `username`,
`ipAddress`, `userAgent`, `methodId`, `deviceType` and `deviceInfo`, for things like new device notices.

Some admin changes can wait (Termix 26.11.2+). With the admin wait on and two or more admins, making an admin,
turning off password login, turning a sign in plugin off, or turning on or granting a plugin with dangerous
access answers HTTP 202 with `{ held: true, holdId, runsAt }` instead of applying. Check answers with
`isAdminHoldTicket` from `/ui` and say when it applies. `/ui` has `getAdminHoldSettings`,
`setAdminHoldMinutes`, `getAdminHolds` and `cancelAdminHold` for a page that manages it.

Sync is answered by one plugin. `sync:provide` is high risk: `ctx.sync.provide({ handle })` takes over every
request under `/sync` (an Express style handler, 404 when nothing provides it), and `ctx.sync.host` hands
over the neutral parts core keeps: the replica store (`replica`), the change feed and push applier
(`feed`), the linked server list (`links`, one per local user), desktop accounts (`accounts`), sessions
(`sessions`), host lookups, plugin mirroring and the proxy settings the desktop app needs. A test passes its
own `syncHost` to `createMockCtx`. An API key can ask `POST /users/ws-ticket/api-key` for a one minute
ticket that opens plugin sockets as its user, which is how one server opens sessions through another.

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
  sandbox: true, // the rules of a plugin process: plain data, declared schedules and events
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

## Security regression tests

A fix for a security advisory comes with a test named after the advisory, like
`tests/backend/GHSA-xxxx-xxxx-xxxx.test.ts`, that fails without the fix. Official releases run every such file
before signing and refuse to publish when one fails, is missing from the run, or skips, focuses or marks a test
(`.skip`, `.only`, `.todo`, `.skipIf`, `.runIf`, `.fails`). The same release gate runs osv-scanner, zizmor, the
authorization table below and a check for new high or critical CodeQL alerts.

## Authorization table

`authz.json` at the repo root says who may call each route and socket. The shared plugin CI boots the newest
core with your plugin, makes a set of callers and calls every entry as each of them:

- no login, an expired login, a signed out login, a login still waiting for its second factor, a login that
  must set up a second factor first, and a share link guest
- a user with no permissions, another user, one user per host share level (connect, view, edit, manage),
  the owner, an admin, and API keys scoped to operations

A route your plugin serves with no entry fails the run, and so does an entry for a route that is gone. Write
what the route should allow, not what it happens to do. Each entry is short and the rest is worked out:

```json
{
  "seed": [
    {
      "as": "owner",
      "method": "POST",
      "path": "/plugin-api/hello/notes",
      "body": { "title": "authz-own-note" },
      "capture": { "hello.note": "note.id" }
    }
  ],
  "routes": {
    "GET /plugin-api/hello/notes": {
      "access": "user",
      "permission": "hello.use",
      "filtered": true
    },
    "GET /plugin-api/hello/notes/:id": {
      "access": "user",
      "permission": "hello.use",
      "resource": { "kind": "own", "fixture": "hello.note" },
      "params": { "id": "hello.note" }
    },
    "POST /plugin-api/hello/hosts/:hostId/run": {
      "access": "user",
      "permission": "hello.use",
      "resource": { "kind": "host", "min": "edit" },
      "body": { "command": "uptime" },
      "destructive": true
    },
    "WS /plugin-ws/hello/live": {
      "access": "user",
      "resource": { "kind": "host", "min": "connect" },
      "send": [{ "type": "connect", "data": { "hostId": "{{host}}" } }],
      "refuseReply": "Host not found"
    }
  }
}
```

- `access`: `public`, `user` or `admin`. Any non public entry must refuse every bad login.
- `permission`: what the route requires. One the plain user role lacks means only admins get in.
- `resource`: whose thing the route touches. `host` and `folder` follow share levels (`min`), `credential` is
  `use` or `manage`, anything else is the owner's alone. Another user must get 401, 403 or 404.
- `seed` makes the owner's rows first; `capture` names them for `params` and `{{name}}` in bodies. Give the
  owner's rows names starting with `authz-own-`: a `filtered` list may answer other users with 200, but never
  with anything holding that marker.
- A refused caller that gets 400 fails: the body never reached the check, so give the entry a `body`.
- `destructive` writes are never called as an allowed caller. Writes are only checked for refusals unless
  `callAllowed` is set.
- `allowed: "any"` skips the allowed side when there is no test data (needs a real device, desktop only);
  say why in `note`. Refusals are still checked.

Every field is in `scripts/authz/authz.schema.json` in the core repo. Run it locally from a core checkout next
to your plugin, after `npm run build:backend:core` there and `npm run build` here:

```bash
node ../Termix/scripts/authz/run.mjs --no-core --plugin . --local-plugin . --local-plugins ../Plugins
```

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

| Choice  | What it does                                                                      |
| ------- | --------------------------------------------------------------------------------- |
| stable  | Tests, builds and publishes `X.Y.Z`, merges the branch into `main` and deletes it |
| beta    | Publishes `X.Y.Z-beta.N`, N counts up on its own                                  |
| dry-run | Builds and packs, publishes nothing                                               |

Releases are immutable. The workflow makes a draft, uploads the `.tmxplug`, then publishes, and after that
the tag and files can't change. A version that already has a release is refused, so a fix is a new version.
Turn on immutable releases in the plugin repo settings.

No secrets are needed. The workflow records GitHub build provenance for the `.tmxplug`, and the run summary
shows the `sha256` for a registry submission. If a dev branch changes `.github/workflows`, add a
`TERMIX_PAT` secret (a token with `repo` and `workflow` scopes). To also sign with your own key, set
`TERMIX_PLUGIN_SIGNING_KEY`. Keep `.github/workflows/release.yml` as the template has it: the community
registry checks provenance from it.

CI also lints your workflows with zizmor and fails on high severity findings, like an action not pinned to a
full commit SHA or an `${{ }}` value inside a `run:` line (pass it through `env:` instead). Termix-SSH
workflows may stay on `@main`. Add `.github/zizmor.yml` to change the rules.

Before it installs anything, CI checks `package-lock.json`: every package must come from registry.npmjs.org over
https with a sha512 integrity hash, and osv-scanner fails the run on a known vulnerability that already has a fixed
version. Update the lockfile, or add an `overrides` entry in `package.json` when a dependency pins the old version.
A vulnerability with no fix yet is only a warning. If one does not affect your plugin, ignore it in
`osv-scanner.toml` next to the lockfile with a `reason` and an `ignoreUntil` date. CI and the release then run
`npm ci --ignore-scripts`, so package install scripts don't run. Your own `postinstall` still runs. Only `better-sqlite3`, `node-pty` and
`@serialport/bindings-cpp` get their install step back through `npm rebuild`. The template's
`.github/dependabot.yml` keeps npm packages and actions current: it waits 3 days after a release, groups minor and
patch updates into one weekly PR, and gives each major its own PR. Security updates come right away.

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

Every version needs its own PR that adds it to the top of `versions`. Releases are immutable, so a fix
is always a new version. Admins see the plugin once they turn on the community
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

| Import                                                               | What it is                                                                                     |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `@termix-ssh/plugin-sdk/backend`                                     | `PluginContext` and the backend types                                                          |
| `@termix-ssh/plugin-sdk/frontend`                                    | `TermixApp`, `TabProps` and the hooks                                                          |
| `@termix-ssh/plugin-sdk/ui`                                          | The UI kit, served by Termix at runtime                                                        |
| `@termix-ssh/plugin-sdk/db`                                          | `defineTable` and column builders                                                              |
| `@termix-ssh/plugin-sdk/manifest`                                    | `PluginManifest` type and manifest checks                                                      |
| `@termix-ssh/plugin-sdk/capabilities`                                | The capability catalog                                                                         |
| `@termix-ssh/plugin-sdk/operations`                                  | Types, input checks and JSON Schema for declared actions                                       |
| `@termix-ssh/plugin-sdk/settings`                                    | Settings field validation                                                                      |
| `@termix-ssh/plugin-sdk/testing`                                     | `createMockCtx`, `createTestDb`, `renderWithApp`, `createFakeContext`                          |
| `@termix-ssh/plugin-sdk/vitest-preset`                               | `pluginVitestConfig`                                                                           |
| `@termix-ssh/plugin-sdk/host-commands`                               | OS detection, package manager and sudo helpers over ssh2                                       |
| `@termix-ssh/plugin-sdk/host-scripts`                                | Docker, metrics, systemd and journal command builders and parsers, scripts sent to `bash -s`   |
| `@termix-ssh/plugin-sdk/ssh-certs`                                   | `applyCertificateAuth()` for certificate based SSH auth                                        |
| `@termix-ssh/plugin-sdk/ssh-keys`                                    | `generateSshKeyPair()`, `detectSshKeyType()`, `publicKeyFromPrivate()`, `validateSshKeyPair()` |
| `@termix-ssh/plugin-sdk/net-guard`                                   | `resolveTarget()`, `pinnedLookup()`, `isPrivateAddress()` for sockets you open yourself        |
| `@termix-ssh/plugin-sdk/desktop`                                     | The desktop app bridge, typed. Check it exists before use                                      |
| `@termix-ssh/plugin-sdk/openapi`                                     | `buildOpenApi()`                                                                               |
| `@termix-ssh/plugin-sdk/changelog`                                   | Changelog parsing and checks                                                                   |
| `@termix-ssh/plugin-sdk/docs`                                        | Docs link and env var helpers                                                                  |
| `@termix-ssh/plugin-sdk/ddl`, `@termix-ssh/plugin-sdk/table-builder` | Table to SQL and Drizzle mapping. You rarely need these                                        |

## Capabilities

| Capability               | Risk     | What it allows                                                |
| ------------------------ | -------- | ------------------------------------------------------------- |
| `credentials:read`       | critical | Read stored secrets for hosts the user can reach              |
| `system:tls`             | critical | Replace the HTTPS certificate, answer CA domain checks        |
| `ssh:connect`            | high     | Run any command on hosts, with the user's access              |
| `process:spawn`          | high     | Run programs on the Termix server                             |
| `users:write`            | high     | Add users and change their roles                              |
| `users:impersonate`      | high     | Act as another user, or get a session for them, audited       |
| `db:core-refs`           | high     | Query core users, roles and hosts tables (read only)          |
| `auth:provide`           | high     | Add login methods, second factors, SSH auth types             |
| `auth:policy`            | high     | Set login rules: idle timeout, session length, 2FA            |
| `sync:provide`           | high     | Run sync: answer every /sync request                          |
| `device:serial`          | high     | Open serial and USB ports on the server                       |
| `network:sockets`        | high     | Open its own listeners and connections, outside Termix checks |
| `desktop:local`          | high     | Use the user's own computer, desktop app only                 |
| `hosts:export`           | high     | Export hosts with their saved logins                          |
| `notify:hub`             | high     | Receive every alert (the alerts hub only)                     |
| `operations:invoke`      | high     | Run other plugins' declared actions, listed in `invokes`      |
| `operations:approve`     | high     | Decide which actions need a person                            |
| `ui:layout`              | high     | Replace the whole app layout                                  |
| `hosts:write`            | medium   | Add and edit hosts                                            |
| `hosts:status-provide`   | medium   | Be the source of host status dots                             |
| `hosts:activity-provide` | medium   | Be the source of the recent activity list                     |
| `ssh:transport`          | high     | Carry SSH connections for hosts it claims over its own stream |
| `hosts:lock`             | medium   | Make hosts it manages read only for everyone else             |
| `hosts:connect-policy`   | high     | Allow, deny or ask for approval before sessions open          |
| `network:probe`          | medium   | Check that a host answers on a TCP port, look up a host name  |
| `credentials:use`        | medium   | Connect with saved credentials without seeing them            |
| `credentials:write`      | medium   | Save new credentials                                          |
| `network:outbound`       | medium   | Outbound HTTP through `ctx.fetch`                             |
| `network:serve`          | medium   | HTTP routes and sockets                                       |
| `network:broadcast`      | medium   | Local network broadcasts, like Wake-on-LAN                    |
| `users:read`             | medium   | Usernames, roles and UI language                              |
| `events:core`            | medium   | Listen to core events                                         |
| `notify:send`            | medium   | Send alerts                                                   |
| `operations:provide`     | medium   | Offer declared actions and events                             |
| `audit:read`             | medium   | Read the audit log                                            |
| `desktop:window`         | medium   | Open windows in the desktop app                               |
| `hosts:read`             | low      | Read hosts the user can see                                   |
| `db:own`                 | low      | Your own tables                                               |
| `kv:own`                 | low      | Small key value state                                         |
| `files:own`              | low      | Your own folder on disk                                       |
| `secrets:own`            | low      | Your own encrypted secrets                                    |
| `settings:read-core`     | low      | Read Termix server settings                                   |
| `plugins:read`           | low      | See installed plugins                                         |
| `ui:surface`             | low      | Add tabs, panels and settings                                 |
| `ui:theme`               | low      | Add color themes, CSS only                                    |

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
