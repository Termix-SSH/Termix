# Changelog

## 26.10.4

### Fixed

- Pin classic layout plugin (fixes proxmox install)

## 26.10.3

### Added

- Choose the layout of the whole app in Settings, Appearance. Admins can also set the default layout and theme for everyone
- Plugins can add layouts and themes
- A repair screen shows when the chosen layout cannot load, with ways to update, switch, reset or turn it off. Open it any time with ?safe-layout=1, or for everyone with TERMIX_SAFE_LAYOUT=1
- Hovering a theme in Settings previews it
- Restore the bundled copy of a plugin from the repair screen, which also pins the shipped version
- Switching layouts closes the tabs only the old layout could show, like its Settings tab
- A chosen layout whose plugin was uninstalled falls back to the default instead of the repair screen
- Filter plugins by type, like layouts, themes or tabs, from a filter list beside the results
- Browse shows plugins a page at a time
- Plugins that need a newer Termix are hidden in Browse, with a toggle to show them
- Hosts can be managed from a config file through a plugin. Managed hosts are read only for everyone, but pins and order still work
- A plugin can block adding hosts by hand, so every host comes from one place
- Plugins can set login rules: sign out after a time without activity, limit how long a session lasts, turn off remember me and require a second factor
- A user who must have a second factor but has none can sign in only to set one up
- Admins can redirect HTTP to HTTPS and send HSTS while HTTPS is on. Off by default so reverse proxies keep working
- A plugin can answer all sync requests and use the replica store, change feed and linked server list, so sync no longer lives in the core app
- The desktop app can hold several accounts, each with its own copy of a server's data. The app signs in as the active one and its auto session follows a switch
- The linked server list holds one link per account, with room for more connection options per server
- A plugin can carry SSH connections over its own stream, and core relays a host's connection over a socket for another Termix
- Plugins can create a folder with a color and icon and remove it when it is empty
- Another Termix server can manage this one with an API key, which can now ask for a one minute ticket to open plugin sockets as its user
- FIDO2 security keys (ed25519-sk and ecdsa-sk) work through SSH Agent authentication when Termix runs in the desktop app. The key asks for a touch or PIN on your own machine
- Pasting a security key file now explains how to use it instead of failing to decode it
- Plugins can add a panel that sits beside a host tab, like a terminal. You can open, resize and move it
- The desktop app can link to a server that requires a client certificate (mutual TLS). It uses a PFX or P12 file for sync and the certificate in your system store for the app window
- Plugins can show a web page in a native view in the desktop app, for sites that do not load in an iframe
- The desktop app draws its own title bar in the colors of your theme instead of the native white one

### Changed

- Server and desktop sync moved out of the core app into a plugin, including the Sync screen, the link wizard and the first run step. Existing links and offline copies keep working
- The icon rail, sidebar, tab bar, dock, Dashboard, Manage, Settings and command palette now come from a bundled layout. It can be swapped for another layout but not removed, and a fix to it no longer needs a Termix release
- Your theme is saved to your account so your other devices use it too, unless you keep settings on this device only
- The themes besides light and dark now come from a bundled themes plugin. It can be swapped but not removed, and Termix keeps a basic light and dark theme of its own
- A theme that no longer exists shows as System instead of an unstyled page
- Installs and updates from a registry check the Termix version a plugin needs, not only its plugin API
- Host online and offline dots now come from the Host Status plugin. The check interval setting moved to its settings and keeps its value. Without the plugin hosts show no dot
- Audit log forwarding and the CSV and NDJSON export now come from the Audit Tools plugin. The collector URL and token move to its settings on upgrade. The audit log viewer, retention and the audit log itself stay in Termix
- Client tunnels on your own computer and opening a host in Windows Remote Desktop moved out of the desktop app into plugins, so fixes to them no longer need a new desktop build
- The local terminal, the local side of the file manager with its transfers, and opening a file in an external editor moved out of the desktop app into plugins, so fixes to them no longer need a new desktop build
- The recent activity list and the first run steps for the preset and for theme, accent, font and language now come from bundled plugins. Existing entries and choices are kept, and people who went through those steps are not asked again
- Branding (app name, tagline and logo) is now saved by the bundled layout plugin. An existing setup keeps its branding, and the sign in screen still reads it from Termix
- Without the plugin that stores recent activity, the list stays empty and nothing is recorded
- Importing hosts from a JSON or SSH config file and exporting hosts now come from the Import and Export plugin. Exports are now written to the audit log. Without the plugin there is no import or export
- Generating and checking SSH keys in the credential editor and deploying a key to a host now come from the Credential Tools plugin. Deploys are now written to the audit log. Without the plugin those buttons are hidden

### Fixed

- Linking the desktop app to a server no longer stalls on the server dashboard after sign in
- Exporting your data no longer fails when a plugin table has a text key, like saved passkeys
- The Windows on ARM desktop app starts again instead of failing with a local server error

### Removed

- The desktop app no longer has its own client tunnel and native Remote Desktop code

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
