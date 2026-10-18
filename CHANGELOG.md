# Changelog

## 26.10.2

### Added

- Hide sidebar after opening, in Customize Sidebar, closes the host list once you open a host
- Sort the dashboard's Host Status card by name, IP address or status
- Windows on ARM builds of the desktop app (installer, MSI and portable)
- Plugins get an event when a host is added
- Plugins can start a short-lived session as a user and read the user's language, for tasks that run without a browser
- Plugins can pin a panel to the right edge of the window that pushes the page over

### Changed

- The Docker Compose files no longer start a guacd container. npm run dev -- --guacd also points remote desktop at the guacd it starts
- The side menu now opens over the page when it expands on hover, so open sessions like remote desktop are not resized each time. Turn on Push content when it expands in Settings to get the old behavior back
- On macOS, moving between split panes is now Cmd+Option+Arrow, so Option+Arrow can move the cursor by word in a terminal

### Fixed

- Picking a section lower down in the host editor, like Warpgate, stuttered on the way and sometimes stopped before it got there
- Sorting hosts by IP address put 10.0.0.210 before 10.0.0.3
- The local terminal failed to start in the universal macOS build
- Hosts shared with you never showed up on a linked desktop
- A linked desktop could never turn on an unsigned plugin the server had enabled
- Creating, cloning or deleting hosts failed with "no such table: main.p_vault_profiles" after the Vault plugin was removed
- Opening a user in Settings, Users blocked the other admin sections until you went back to the user list
- A linked desktop could keep showing the same sync conflicts, or delete a local host, when the server could not send its copy
- Usernames are now unique
- Importing user data keeps foreign keys on
- Trusted proxy login checks the address nginx saw, not nginx itself
- The desktop login frame only trusts the server's own origin
- External login URLs and callback ports are checked on the desktop app
- A changed jump host key is no longer accepted without asking
- Synced plugins signed only by a key the server sent are no longer turned on by themselves
- Two connects to the same host at once could overwrite each other's connection
- Indonesian uses the same technical terms everywhere
- When the server was down or still starting, the login page said it could not connect to the database and stopped trying. It now says the server is not responding and continues on its own once the server is back
- nginx answered 404 instead of 502 while the backend was down
- A client tunnel that could not start always said "Endpoint SSH connection closed" on the desktop app instead of the real reason, like the target refusing the connection
- The Docker server crashed and restarted every few hours in ssh2's native crypto on Node 24
- Plugin names and descriptions showed in English in the plugin manager, setup picker and host editor no matter the UI language
- Creating a host through the API without an auth type failed with a server error. It now picks the type from the credential, key or password, or says auth type is required
- The desktop app would not start its local server when another program used port 30001. It now picks a free port on its own
- A linked desktop could never finish syncing with a server on Postgres
- Routine plugin activity filled the audit log and pushed out real security entries
- Opening a full-screen view link while signed out showed a spinner forever. It now shows the login and opens the link after
- A linked desktop behind a proxy that needs extra headers, or with an allowed self-signed certificate, could not open remote terminals or tunnels

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
