# Changelog

## 1.0.5

### Fixed

- `execCommand` timeout errors no longer include the command, which could hold a sudo password
- `termix-plugin validate` fails when a plugin ships migrations for some database engines but not all three
- `termix-plugin migrations` loads the table definitions from a path with a `#` or other URL characters in it
- Text, json and encrypted columns are `longtext` on MySQL in new migrations, so they are no longer capped at 64KB. Existing migrations keep `text`
- `i18next`, `react-dom`, `react-i18next` and `sonner` are optional peer dependencies, so npm stops installing them into backend-only plugins

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
