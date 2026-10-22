# Changelog

## 1.0.20

Plugin API 1.12.0.

### Added

- `columns` and `onColumns` on `ViewToggle` show a cards per row picker: Auto fits as many as the pane has room for, or pick 1 to 6
- `size` and `minCardWidth` on `DataView`, so a card grid follows that pick, and the `GridSize` type
- `usePluginPanelView` also keeps `columns`, the cards per row pick, with `setColumns`

## 1.0.19

Plugin API 1.11.0.

### Added

- `app.registerCompanionLayout` and `useCompanions`, so a plugin can let each host turn the panel bar on or off, move it and choose which panels show and in what order

## 1.0.18

Plugin API 1.10.0.

### Added

- `clientCert` on the sync link, link patch and remote target, and the `client_cert` remote error kind, so a sync plugin can link to a server that needs mutual TLS

## 1.0.17

Plugin API 1.9.0.

### Added

- `app.registerCompanion` and `app.toggleCompanion`, so a plugin can add a panel beside any host tab. The user opens, resizes and moves it, and the tab keeps running
- `NativeView` in `@termix-ssh/plugin-sdk/ui`, which shows a web page in a native view in the desktop app, for sites that do not work in an iframe

## 1.0.16

Plugin API 1.8.0.

### Added

- `ctx.sync.provide` and the `sync:provide` capability, so a plugin can answer every /sync request
- `ctx.ssh.transports.provide` and the `ssh:transport` capability, so a plugin can carry SSH connections over its own stream
- `ctx.hosts.folders.ensure` and `removeEmpty`

### Removed

- The sync screens and calls in `@termix-ssh/plugin-sdk/ui`: `LinkServerDialog`, `ProxySettingsFields`, `useSyncStatus`, `refreshSyncStatus`, `setSyncStatus`, `getSyncConflicts`, `getSyncErrors`, `retrySyncErrors`, `settleSyncConflict`, `syncNow`, `unlinkServer`, `updateSyncSettings` and their types. They moved into the sync plugin

## 1.0.15

Plugin API 1.7.0.

### Added

- `ctx.auth.policy.provide` and the `auth:policy` capability, so a plugin can set an idle timeout, cap session length, turn off remember me and require a second factor
- `ctx.auth.listSecondFactors` lists the second factors from every running plugin
- `AuthEnrollmentSections` takes `factorsOnly`
- `getHttpsSettings` and `updateHttpsSettings` in `@termix-ssh/plugin-sdk/ui`

### Fixed

- Plugin frontend tests against a locally linked SDK failed with a second copy of React

## 1.0.14

Plugin API 1.6.0.

### Added

- `ctx.hosts.locks.provide` and the `hosts:lock` capability, so a plugin can manage hosts that stay read only for everyone else and block adding hosts by hand
- `ctx.hosts.setShares` to replace every grant on a host in one call
- `ctx.credentials.list` returns the acting user's credentials by name, without secrets
- `ctx.hosts.create` and `update` take `password`, `key`, `keyPassword`, `keyType`, `sudoPassword`, `protocolAuth` and `pluginEnable`

## 1.0.13

Plugin API 1.5.0.

### Added

- `runtime: "desktop"` in the manifest for a plugin that only loads on the desktop app
- `desktop:local` and `ctx.desktop.local`: file system, local shell and machine info on the desktop app's own backend
- `ctx.audit.subscribe`, `ctx.audit.list` and `ctx.audit.exportBatches` under `audit:read`
- `ctx.hosts.importMany`, `importSshConfig`, `exportMany` and `registerImportNormalizer`, with the `hosts:export` capability
- `ctx.credentials.publicKey` and `resolveKeyRefs`, `ctx.ssh.exec`, and `@termix-ssh/plugin-sdk/ssh-keys`
- `ctx.hosts.status.provide` and `ctx.hosts.activity.provide` so a plugin can own host status and recent activity, with `ctx.network.tcpProbe`, `ctx.ssh.probe`, `ctx.hosts.probeTargets` and `ctx.hosts.sessionActive`
- `registerHostStatusIndicator` and `registerHostEditorToolbarItem`, and `order` for host badges
- Onboarding steps can sit in a `start` section, take a `position` and `replaces` a core step
- A plugin can provide the app name, tagline and logo through the `<id>.brandingProvider` registry key

## 1.0.12

Plugin API 1.4.0.

### Added

- `contributes.layouts` and `app.registerLayout()` for a whole-app layout, with the `ui:layout` capability. Needs `engine.api` 1.4
- `contributes.themes` for CSS-only themes, with the `ui:theme` capability. `termix-plugin validate` checks theme CSS and `pack` ships it
- `useShell()` gives a layout the live shell: tabs, splits, hosts, docks, the command palette and the registries. The shell's home tab is left out until some plugin registers a `dashboard` tab type
- `TabStage` and `ShellConfirmCapture` in `@termix-ssh/plugin-sdk/ui`, for a layout to place tabs
- `validateThemeCss()` in `@termix-ssh/plugin-sdk/manifest`
- `@termix-ssh/plugin-sdk/ui` also exports what a whole layout is built from: the API client, shared types, hooks, `useShellController()` and `APP_VERSION`. These reach into core, so they can change with a core release
- `@termix-ssh/plugin-sdk/testing-host` exports the registries and permission seam a layout's own tests fill directly
- A plugin that only holds themes needs no source: `termix-plugin build` writes an empty backend and `validate` does not ask for a frontend
- `termix-plugin validate` flags `ui:layout` or `ui:theme` with nothing contributed, and a layout plugin with no frontend

### Fixed

- The manifest JSON schema lists the `notify:hub` and `plugins:read` capabilities
- Plugin tests and type checks work with the SDK linked from a local Termix checkout

## 1.0.11

Plugin API 1.3.0.

### Added

- `ctx.auth.issueUserToken()` mints a short-lived session for a user, for calling Termix's own API as them from background work. Needs `users:impersonate` and `engine.api` 1.3
- `ctx.users.getLocale()` reads a user's UI language. Needs `users:read` and `engine.api` 1.3

## 1.0.10

### Changed

- `termix-plugin pack` includes the plugin's `LICENSE` and `NOTICE` files, so third-party notices ship with it

## 1.0.9

### Added

- Worker entries in `package.json` `termix.workers`, each bundled on its own into `dist/workers/<name>.js`
- A `.wasm`, `.ttf` or `.otf` import gives the file's bytes, in `termix-plugin build` and in plugin tests

### Fixed

- The plugin guide listed jszip, guacamole-lite and @anthropic-ai/sdk as shared packages, but they are bundled

## 1.0.8

### Added

- `publicRateLimit` on `ctx.http.router()`, for a plugin whose public routes serve a proxied page

## 1.0.7

### Fixed

- A migration file, or a part of one, holding only comments made core fail to start the plugin

## 1.0.6

### Added

- `PLUGIN-GUIDE.md`, a guide to building, testing and releasing a plugin, written so AI coding tools can read it too

## 1.0.5

### Fixed

- `execCommand` timeout errors no longer include the command, which could hold a sudo password
- `termix-plugin validate` fails when a plugin ships migrations for some database engines but not all three
- `termix-plugin migrations` loads the table definitions from a path with a `#` or other URL characters in it
- Text, json and encrypted columns are `longtext` on MySQL in new migrations, so they are no longer capped at 64KB. Existing migrations keep `text`
- `i18next`, `react-dom`, `react-i18next` and `sonner` are optional peer dependencies, so npm stops installing them into backend-only plugins
- `termix-plugin validate` accepts a beta version like `1.1.0-beta.1` when the changelog's newest release is `1.1.0` or older, so beta releases pass

## 1.0.4

### Fixed

- `termix-plugin build` puts a plugin's own Tailwind classes in core's utilities layer, so responsive, hover and group variants and `className` overrides on SDK components work. Plain classes core already ships stay below core's utilities as before, while variants core ships go with the plugin's own so `max-h-56 md:max-h-none` keeps its order. Rebuild a plugin to pick it up

## 1.0.3

Plugin API 1.2.0.

### Added

- `docs` manifest field: an https link to the plugin's docs. Termix shows it as a Documentation link on the plugin's page and in its settings
- `env` manifest field: the environment variables the plugin reads, listed in its docs and on its page
- `app.docs` and `useDocsUrl()` for links into the plugin's own docs, and `DocsLink` in `@termix-ssh/plugin-sdk/ui`
- `PanelShell` takes a `docs` link and shows it as a book icon in the header
- `@termix-ssh/plugin-sdk/openapi` with `buildOpenApi()`, and `termix-plugin openapi`, which writes `dist/openapi.json` from the `@openapi` blocks in `src/backend`. `build` runs it too
- `@termix-ssh/plugin-sdk/docs` with `pluginDocsUrl()`, `pluginDocsPage()` and `pluginEnvVars()`
- `termix-plugin validate` warns when `docs/index.md` is missing or the source reads an env var the manifest does not list

## 1.0.2

### Added

- `features` manifest field: up to 20 short lines about what the plugin does, shown on its page. `pluginFeatures()` reads them

### Changed

- `parseChangelog()` and `validateChangelog()` flag a `## Unreleased` section. Notes go under the version they ship in

### Removed

- `Changelog.unreleased`

## 1.0.1

### Added

- Plugin API 1.1
- `app.registerOnboardingStep()` adds a step to onboarding, with `OnboardingStepProps` and `OnboardingStepContribution`. Needs `engine.api` 1.1
- `video` manifest field: a YouTube link shown at the top of the plugin's page, read with `youtubeVideoId()`
- `@termix-ssh/plugin-sdk/changelog` parses and checks a plugin's `CHANGELOG.md`
- `termix-plugin changelog` prints one version's notes from `CHANGELOG.md`
- `termix-plugin dev` installs a plugin on a running server and reinstalls it on every change. Needs developer mode and an admin API key
- `renderOnboardingStep()` and `registered.onboardingSteps()` in `renderWithApp()`
- `AddButton`, `FormFooter`, `ListRow`, `ListRowAction`, `ListRowFolder`, `ListBadge` and `PanelList` in `@termix-ssh/plugin-sdk/ui`
- `PanelSearch` takes `disabled`, `title`, `onEnter` and `inputRef`, and `SurfaceScope` takes `onClose`

### Changed

- Release notes moved from `CHANGELOG.json` to `CHANGELOG.md`, which `pack` now ships. `validate` flags a leftover `CHANGELOG.json`
- `ConnectionScreen` dropped `errorMessage` and `retryLabel` and gained `onClose`. `ConnectionLogPanel` dropped `position`
- Plugin tests run in worker threads, since forked workers crash now and then on Windows
- The test setup stubs `ResizeObserver` for Radix controls under jsdom
- `onboarding` is a reserved plugin id

### Deprecated

- The `onboarding.*` action slots. Use `registerOnboardingStep()`

### Removed

- `schema/changelog.schema.json`

## 1.0.0

### Added

- Backend, frontend, database, manifest, capability and settings types for plugin API 1.0
- Testing helpers and a Vitest preset for plugin tests
- The `@termix-ssh/plugin-sdk/ui` component set
- The `termix-plugin` CLI to build, validate, test, pack, sign and write migrations
