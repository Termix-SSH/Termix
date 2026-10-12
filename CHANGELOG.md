# Changelog

## 26.10.1

### Added

- Slovak, Croatian, Slovenian, Lithuanian, Latvian, Estonian and Malay
- The desktop app can update itself. Pick Automatic, Ask first or Never in Settings, Updates. Store and package manager installs keep updating the way they do now
- Community plugins. Turn on the community registry in Plugins, Registries to browse and install plugins made by other people, each version reviewed before it is listed
- Custom plugin registries. Add your own registry by its index URL; its signing key is pinned when you add it

### Changed

- Every language is now fully translated, in Termix and in every plugin, and stays up to date with each release
- Languages with more than two plural forms, like Russian, Polish and Arabic, now use the right one
- The Plugins tab shows how many times each plugin was downloaded, in a Downloads column
- Plugins, Browse hides plugins you already have. Turn on Show installed to see them

### Fixed

- Regional browser languages like `es-MX`, `pt` or `zh-HK` showed English instead of the closest translation
- Counts like "1 keys" or "Moved 1 host(s)" now use the singular
- Plugin updates on the desktop app, synced or installed from the Plugins tab, failed to start with "Cannot find package"
- The desktop app showed plugins that only run on the server as not running and out of date
- Keep the terminal WebSocket open past nginx's 60s default
- Plugin download counts now show in the Plugins tab without waiting for the background check
- Clicking into a saved password, key passphrase or sudo password field and saving without typing erased it, which stopped sudo autofill
- The desktop app now says when its data is from 2.8 or older and needs 2.9 first, instead of only saying the local server could not start
- Client tunnels on the desktop app stopped with "Endpoint SSH connection closed" when a reverse proxy dropped their idle connection
- Typing right after opening a host from the sidebar went to the host search instead of the new session
- SSH config import failed on files that put a tab or `=` between a keyword and its value
- App icons and the favicon have rounded corners again

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
