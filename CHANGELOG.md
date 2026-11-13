# Changelog

## 26.11.2

### Added

- Desktop app: closing the window can quit Termix instead of keeping it in the tray
- Desktop app: the first time closing the window keeps Termix in the tray, a notice says it is still running and how to quit
- Admin setting to trust a host's first key without a prompt when nobody can confirm it. Each such key is audited
- Every desktop file, tarball and Flatpak bundle on a release carries signed build provenance, and each release has a signed `SHA256SUMS` file. Check them with the new Verify your download page in the docs
- Docker images are signed with cosign and carry build provenance and an SBOM attestation
- A CycloneDX SBOM of the server's dependencies ships with each build: `/app/sbom.cdx.json` in the Docker image and `termix_sbom.cdx.json` on the release
- The server sends the same security headers with or without the bundled nginx: a strict Content-Security-Policy, Referrer-Policy, Permissions-Policy, Cross-Origin-Opener-Policy and HSTS over HTTPS
- Desktop app: the app page carries a Content-Security-Policy
- Limits on how often logins, second factor checks, password resets, sign ups, API key creation, exports and imports can be tried, per address and per account. Too many bad API keys from one address are refused for a while
- Rotate the encryption key from the API (`POST /encryption/rotate-key`) or with `ENCRYPTION_KEY_PREVIOUS`, and the database key with `DATABASE_KEY_PREVIOUS`. Everything moves to the new key at start
- The example Docker compose drops every capability it doesn't need, sets no-new-privileges and shows a read-only, non-root setup. The image runs on a read-only root filesystem

### Changed

- GitHub releases stay drafts until every download is uploaded, and a published release never changes its files
- Over HTTPS the login cookies use the `__Host-` prefix, so another site on a sibling domain can't set or replace them
- The Docker health check uses Node instead of wget, which is no longer in the image. ping needs no extra capability
- Server logs mask API keys, tokens, passwords and private keys, also inside error messages
- Desktop app: the app page is served from its own `app://termix` address instead of from files on disk. Saved view settings move over on the first start. A server older than 26.11.2 that sets `CORS_ALLOWED_ORIGINS` needs `app://termix` added
- Desktop app: updates install on Windows, macOS, AppImage and deb only after the release's signed `SHA256SUMS` checks out. Releases without it are offered as a download link
- Desktop app: the local server runs as an Electron utility process, and the app binary can no longer be started as a plain Node or with Node debug flags

### Fixed

- API key requests are much faster: the slow key check no longer runs on every request
- Desktop app: quitting waits for the local server to stop, so it no longer keeps its ports after the app closes
- Desktop app: the local server and everything it started stop when the app closes or crashes
- A plugin that hangs while stopping no longer keeps the server from shutting down
- Stopping the server with Ctrl+C or docker stop waits for plugins to stop before it closes the database
- Desktop app: the page can only change the desktop settings meant for it
- Database exports always write inside their own temp folder, whatever the username
- New usernames can't contain slashes or control characters
- Proxy tests connect to the exact address they checked
- A host whose key was never checked is no longer trusted when a plugin, schedule or the API connects with nobody to ask. Open a terminal to the host once, or turn on the new admin setting
- A jump host's first key is asked about like any other host's
- A credential shared for use only stays hidden. Quick Connect, copying a host's password, host export and desktop sync no longer hand out its secret
- Hosts shared at connect or view level reach linked desktops without their login and connect through the server there
- Quick Connect can log in with a saved credential, the server reads it when connecting
- Copying a host's password or key and reading host status need the View hosts permission, like every other host read
- Signing out, revoking a session, changing a password, an expired session or an idle timeout now also closes that login's open terminals and other live connections within seconds
- API key connections end when the key is deleted or expires
- Live connections follow the same sign in rules as the rest of Termix, including the second factor setup step
- Desktop app: the local server answers only requests sent to its loopback address, and only the app itself can sign in to it
- Desktop app: only the app page in the main window can call the desktop app, and every call's input is checked
- Desktop app: pages opened from an embedded web view keep the same limits as the view
- Desktop app: settings from the local server for the linked server are checked before use
- A database save that fails is now reported to the action that asked for it, and a failed save never leaves a cut database file
- Updated dependencies with known security fixes, including undici, multer and Electron
- Desktop app: a server's login page only hands its session to the desktop app itself, never to another page shown inside it
- Restoring a database backup only reads and writes files inside the data folder
- Encrypted values with a cut short check tag are refused
- The Docker image bundles opkssh 0.19.2 and no longer ships npm, which the server never uses
- A failed sign in gives the same answer and takes the same time whether or not the username exists
- A password reset request gives the same answer whether or not the username exists
- The code step of a sign in with a second factor can only be finished once
- Pages on other subdomains or ports of the same host can no longer act as the signed in user or read their data. Add origins that need this to CORS_ALLOWED_ORIGINS
- Plugins that run commands with sudo send the sudo password on stdin, so it never shows up in the host's process list
- A login that still has to set up a second factor can only open the setup screen, not manage plugins
- Rotating the JWT secret from the API now really replaces it and signs everyone out
- Error answers from the server no longer include internal error text
- Bad JSON and too large uploads get a 400 or 413 answer instead of a server error
- SSH key uploads on a host are limited to 1 MB
- Download names with unusual characters in a user export are kept safe

## 26.11.1

### Added

- Plugins in the desktop app can drag files out to Explorer or Finder
- Termix actions: plugins can declare what they do once, and it works from the API with permission checks, dry runs, run history and approvals
- API keys can be limited to reading or running actions, when an admin makes them
- A click on a host can open its host page, when a plugin offers one
- Plugins can build pages of tiles you drag and resize, and add many copies of one dashboard card, each with its own settings
- A plugin a newer release ships is downloaded on its own when your image does not have it, and tried again on the next start when offline
- Plugins can decide who may connect to a host, so a host can need approved access before an SSH or remote desktop session opens
- When more than one plugin flags a host, its row shows one status dot with every reason in its tooltip
- Plugins that issue SSH certificates can save them on the SSH key login they were issued for
- Cmd+B shows or hides the sidebar, and can be changed in keybindings
- The macOS menu bar icon can be monochrome (the default), in color or hidden, from the Termix menu
- Browser back and forward, and the mouse back and forward buttons, move between the tabs you used instead of leaving Termix
- Closing a tab goes back to the tab you used before it
- Admin setting to stop anyone saving passwords and keys on hosts and credentials. Termix asks for them when connecting (#1753)
- A signed in user can prove a second factor again, for plugins that ask before something sensitive
- Desktop app: a credential can be kept on this device only, and used as a personal login for a shared host or folder. It is never sent to the server (#1749)

### Changed

- Inputs, selects, tab groups and menus share one fill and one border color
- Plugin cards and pages use the dashboard look everywhere, with shared lines between sections instead of separate boxes with gaps
- The Plugins tab and plugin pages use the same look
- List rows in plugins follow the host list status colors: accent for good, dark for offline or bad
- Line charts that cover a few minutes show seconds in their times
- Plugins a new release adds to the image start on only when they are recommended. The rest are installed and left off for an admin to turn on
- Session tokens are stored as hashes, so a database copy holds no working logins (#1753)

- Host status, import and export, and credential tools now start on for new installs
- Sync now starts on in a new desktop app, so it can link to a server
- The first run plugin picker leaves plugins you did not choose off instead of removing them
- The Linux Flatpak now installs from flatpak.termix.site on x86_64 and arm64, and `flatpak update` keeps it current
- Dropdowns and text areas are the same size as the text fields next to them
- A page's own tabs sit above its search bar
- A plugin view that is still starting shows the same loading spinner as the rest of Termix

### Fixed

- Exporting hosts keeps each host status check setting and interval (#1787)
- A linked desktop app now updates a plugin that came with the app when the server has a newer copy (#1785)
- The first run plugin picker no longer sets the default layout and themes to Remove. They always stay on
- Alerts with no icon no longer squeeze their text to one word per line
- Password fields with the show button are the same height as the other fields next to them
- Button groups next to tabs no longer touch the lines of the tab row
- The Secure your account setup step no longer shows up empty when no passkey or authenticator plugin is on
- An installed plugin update older than the copy in a newer image is removed at startup instead of logging an error every boot
- Canceling a download to the desktop app right as it starts no longer leaves a partial file behind
- Changing two interface settings at once, like resetting the dashboard, now saves both instead of only the last one
- Release notes on a plugin's page are no longer cut off on the left
- The Community badge in Browse is no longer missing its top border
- Official plugin pages no longer show a stray divider before the author
- The version picker on a plugin's page is no longer empty for a plugin installed from a local build
- The plugin video no longer has a second border around it
- The hint at the bottom of Browse and the stored data footer on plugin pages have the same padding as the rest of the page
- Sign in methods on the Security page have a line between them
- Chart axis labels with long units, like KiB/s, are no longer cut off
- Filters, view toggles and small buttons in a toolbar are the same height as the search box next to them
- Save and Cancel at the bottom of a form are the same height as other buttons
- State badges in tables no longer stretch across the whole column
- Text boxes, dropdowns, checkboxes and button groups share one border color
- Small icons in buttons sit centered instead of half a pixel off
- Installing Termix as an app works behind a proxy that needs a login cookie
- The hosts Import / Export button and menu entry show their name again instead of a text key
- SSH logins to servers that only offer group exchange no longer stall for up to a minute while checking a large key exchange group
- Plugin views can open the host editor again, so the terminal's Edit host button works after a failed connection
- The Linux arm64 and armv7l desktop builds start again instead of failing to load the image library
- The terminal offers to fill a saved sudo or SSH password at a password prompt again
- Closing the desktop app on GNOME, like Fedora Workstation, quits it instead of minimizing, since GNOME has no tray to bring it back from
- A deleted or changed host no longer stays in the host list when a list refresh was already running (#1782)
- Plugin connections to a shared host are no longer reused between people, so each person connects with their own login
- A session that still has to set up a second factor can no longer open terminals or other live connections
- A login still waiting on its second factor can no longer be used for desktop sync
- Someone with time limited manage access can no longer share a host or credential so it outlasts their own access
- Changing your password signs out your other sessions before it answers
- A host setting that needs a permission can no longer be changed through host import, bulk edits, host defaults or desktop sync without it
- Requests sent with no body get a clear error instead of a server error
- On PostgreSQL and MySQL, a link with an invalid id finds nothing instead of failing with a server error
- On MySQL, a plugin update that stopped halfway through its database changes finishes on the next start
- Plugin host settings no longer show the previous host's values for a moment after you switch hosts
- Switching layouts closes the old layout's tabs again when you sign in
- A plugin panel beside a tab that fails no longer blanks every open tab
- Scrolling with the pointer over a row of tabs scrolls the page again
- A host list refresh that finishes late no longer puts an older list back on screen
- Switches in settings and the host editor are named for screen readers
- The show password button and the sign in fields are translated

## 26.11.0

### Fixed

- Saving the database no longer holds up the whole server while it encrypts and writes. A big database is also saved less often by background writes, which fixes slow requests and dropped connections
- The macOS menu bar icon shows the logo instead of an empty shape on multi-architecture builds
- Disabled plugins no longer show update or review buttons, and no longer count as pending updates
- One slow request, like a plugin waiting on an SSH host, no longer shows Server connection lost. The app now checks the server first
- Canceled requests no longer show Server connection lost
- The macOS Window menu has an item to reopen the main window after it is closed
- Hosts with both an SSH key and a password can log in to servers set to AuthenticationMethods publickey,password

## 26.10.6

### Added

- The mobile app can sign in through your browser with any login method, including passkeys and security keys
- Plugins can say how they show in the mobile app
- The plugin list tells the mobile app which plugin API each plugin needs, so the app can say when it or a plugin needs an update
- Hosts can have a color and an icon, which sync to the desktop and mobile apps
- A sidebar setting to turn off alternating row colors
- TERMIX_NGINX_TEMPLATE, TERMIX_NGINX_CONF, TERMIX_NGINX_PID and TERMIX_APP_DIR let an install outside Docker, like the Proxmox LXC script, switch nginx to HTTPS when a certificate is added
- Removing a user or role from a shared folder can also remove their access from every host in the folder and its subfolders
- A personal login set once on a folder is used for every host shared with you in it and its subfolders, unless a host has its own

### Changed

- body-parser is updated to 2.4.0 for a security fix

### Fixed

- The log line for a rejected proxy login now shows the source address, so you can add it to TRUSTED_PROXY_AUTH_TRUSTED_PROXIES
- Deleting your own account now removes all of its data, like an admin delete does, instead of leaving some behind
- An SSH key with a passphrase is unlocked once and kept unlocked in memory for a short time, so connecting to many hosts with it no longer freezes the server for minutes
- A change pushed from one linked desktop or phone now reaches your other linked devices right away, instead of on their next check a few minutes later
- The macOS menu bar icon shows the Termix logo instead of an empty square
- Cmd+1 (Alt+1 on Windows and Linux) and the other number shortcuts pick the open tabs as numbered in the tab bar, not the home tab
- A plugin the app no longer ships and could not download (for example on a locked down network) shows as failed with the reason on the Plugins tab, instead of as installed
- The desktop app no longer shows This layout could not be shown when the layout is asked for before its plugin has finished starting; it tries again
- On the desktop, a plugin installed from the registry that uses core's packages through require (like ACME SSL and axios) starts instead of failing with Cannot find module
- Adding a certificate on an install where Termix cannot manage nginx says what to set instead of only asking for a restart
- A login someone shared with you works on a host shared with you, for personal SSH authentication and when the owner shares SSH authentication
- Lists in plugins (like the AI Assets table) use their full width on narrow screens, keep cells under the right header and no longer overlap rows
- Installing an official plugin from a file works offline: pick the .tmxplug and its .sig from the release together and it installs as official, so plugins like Fleets no longer stop with migration refused. It can also fill in a plugin that was on but could not be downloaded

## 26.10.5

### Added

- Safe mode: start the server with TERMIX_SAFE_MODE=1 to run only layout and theme plugins, so a broken plugin can be turned off
- TERMIX_PLUGIN_REGISTRY_PRIVATE_HOSTS lets plugin registries live on a private address, like a registry in your LAN
- Plugin registry browsing and downloads use HTTP_PROXY and HTTPS_PROXY when they are set
- Docker image sizes: the default image now ships the most used plugins, the minimal tag ships only the look plugins and the full tag ships every official plugin
- Plugins an older image shipped and you had on are downloaded from the registry on the first start of a smaller image, so nothing goes missing

### Changed

- Card grids in the Plugins tab and in plugins can show Auto (as many as fit) or a set number of cards per row

### Fixed

- The macOS app asks for Local Network access, so it can reach servers on your LAN
- The desktop app can change the connection origin of a host shared with you, instead of failing to save

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
