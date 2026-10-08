# Changelog

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
