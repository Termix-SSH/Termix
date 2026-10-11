# Changelog

## 26.10.1

### Added

- Slovak, Croatian, Slovenian, Lithuanian, Latvian, Estonian and Malay

### Changed

- Every language is now fully translated, in Termix and in every plugin, and stays up to date with each release
- Languages with more than two plural forms, like Russian, Polish and Arabic, now use the right one

### Fixed

- Regional browser languages like `es-MX`, `pt` or `zh-HK` showed English instead of the closest translation

## 26.10.0

### Added

- Plugins. Every feature beyond hosts, credentials and sharing is now its own plugin with its own repo, and you pick which ones you want
- A Plugins tab to install, update, pin, turn off and remove plugins from the official registry, with release notes and a beta channel per plugin
- Developer mode to install a plugin from a file, and a plugin SDK on npm to build your own
- The community plugin registry is open for submissions. Termix can install community plugins in a later update
- Redesigned UI with a Manage tab for hosts and credentials and a Settings tab with search
- New full screen onboarding where you choose which plugins to start with
- Beta channel for Termix itself in Settings > Updates
- Docs links on every settings page, in the Plugins tab, in plugin settings and in the command palette
- Plugins can link their own docs and list the environment variables they read, shown on their page in the Plugins tab
- Report a bug links that open a prefilled issue in the right repo
- `TRUSTED_PROXIES` to choose which proxies nginx takes client IPs from

### Changed

- Termix now uses calendar versions (year, month, patch), starting with 26.10.0
- Redesigned host defaults with admin, user and folder levels
- Simpler host status: online or offline, kept live without a refresh
- Bug reports and feature requests now go to each repo instead of the Support repo

### Fixed

- A lot of bugs across the app, the desktop app and every plugin
- Several security issues reported through GitHub advisories

### Removed

- Downgrading to 2.8 is no longer supported. A 2.8 install has to start 2.9 once before upgrading
- The donation reminder popup
