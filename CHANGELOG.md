# Changelog

## 26.11.3

### Added

- Diagnostics report: one file with errors, logs, plugin states and connection checks to attach to a bug report. Names and addresses are hidden by default and secrets are always removed. Open it from a plugin's page, Ctrl+Alt+Shift+D, the login page, a slow loading screen, or any Termix address with ?diagnostics added
- Admins can watch the server log live in the diagnostics page
- Admins can let community layouts and themes run outside the sandbox again, behind a warning, in Plugins, Registries
- Set SERVE_OPENAPI=true to serve this server's own API spec at /version/openapi.json: core and every plugin that is on, at the versions it runs, with the server's address filled in
- Access plugins can end the connections already open to a host when its access ends, and can keep status checks from contacting it
- Desktop app: termix:// links open the app. termix://host/<id> connects to a saved host after asking, and a shortcut with --host=<id> opens straight into it
- Quick Connect can use a saved credential, resolved on the server so its password never reaches the browser
- Confirm prompts can have a checkbox, like Delete permanently in the file manager
- Host row badges from plugins can show an icon and their own color
- Dashboard cards from plugins let the layout's card color show behind them
- Signing out can also sign you out of your single sign on provider, when its login method asks for it
- Desktop app: logins of web pages a plugin shows in the app are kept across reloads and reopened tabs until Termix quits or you sign out. Pages on this computer still start signed out
- Setup has a Pick a layout step that shows every installed layout with a screenshot and a link to its video. Admins can also install layouts from the registry or turn on ones that are off
- Layouts with a host tree can list what runs inside a host, like containers and guests, under it

### Fixed

- Signing out from the menu ends the session on the server too, not only in the browser
- Embedded web pages from plugins, like Homepage iFrame widgets, show again in Safari and Firefox when the page is on another host
- Desktop app: parts of plugins that only show in the desktop app, like a local terminal, show again
- Plugins that are blocked or stopped after an upgrade show their update again, and Update all no longer greys out when only those are left
- Update all opens a review for each plugin whose update asks for new permissions, instead of skipping it without a word
- When a login proxy in front of Termix blocks plugin files, Termix says so and links to the fix, instead of showing "Getting plugins ready" on every load
- A plugin that can't read its own files says which folder and how to fix it, instead of "did not start"
- A blocked plugin says "Can't start" with the reason, instead of always "Waiting on another plugin" even when it only needs an update
- The plugin loading screen no longer says it only shows the first time
- The loading screen stays up until plugins are ready, so buttons and rail items no longer pop in and host details no longer flash right after it
- Plugins can write to files they saved before 26.11.2 again, like Session Recording's recordings
- The first plugin installed from the store on a new install starts without a restart
- A terminal's tab shows its Share button and Share menu entry again, and Refresh connection, Reconnect all and focus in split screen work on it again
- Shared session links open again, for people with or without an account
- A plugin that stops right as Termix sends it a message can no longer crash the whole server
- Desktop app: plugin updates no longer fail with "inclusion promise could not be verified", thanks to dean for finding the cause
- Termix starts again when the data folder doesn't allow changing file owners, like some network shares, instead of restarting over and over. Plugins then run as Termix's own user
- When most plugins go quiet at once because Termix itself was busy, they are no longer all restarted together
- A plugin's scheduled job no longer fails with "The plugin process is not running" when it fires while the plugin is waking up
- Desktop app on Windows: the notice that Termix is still running in the tray now shows in the portable app too, and shows again next time if Windows hid it
- When plugins can't load in the browser, Termix says which ones and why, instead of their parts quietly disappearing
- A plugin part at the edge of the screen no longer takes the whole width, which hid the tabs and made every other plugin's parts disappear
- Signing in to the mobile app through the browser works with every login method again, not only a password and code. Newer apps get the session through a one-time code only the app can use
- Single sign on started from the login page the mobile app opened goes straight back to the app
- Uploading files to a plugin works again, like drag and drop or the upload button in the file manager
- Desktop app: the interface size and other settings no longer go back to old account values on launch when the app isn't linked to a server
- Desktop app: `NODE_EXTRA_CA_CERTS` works again, so servers with a certificate from a private CA can be linked. Plugins now trust those certificates too
- Exported hosts keep whether SSH is on, so importing them no longer turns SSH on or off by the connection type
- Desktop app: linking to an account that already has the same hosts, folders and credentials adopts them instead of making a second copy of each, thanks to ZacharyZcR
- A plugin that cancels work with its own error type still cancels it, thanks to ZacharyZcR
- Uploads in the file manager finish again instead of hanging, and uploads to other plugins no longer fail as they finish
- A plugin's host row button keeps working after the plugin sat idle for a moment, like after you close one of its tabs, instead of doing nothing until a reload
- Desktop app: a linked app with an old Sync plugin from before plugin API 2 updates it on its own, so it can sync again instead of saying sync is off on the server
- Quick Connect asks to trust a host's key only the first time, not on every connect, and warns if the key changes
- Desktop app on Windows and Linux: Ctrl+W reaches the terminal again, like for search in nano or deleting a word, and still closes other tabs

## 26.11.2

### Added

- What plugins add to the app is kept on the server too, so a new browser, device or cleared cache opens almost as fast as usual instead of starting every plugin first
- The first time plugins have to start one by one, one screen says so with how far along it is, instead of a page that keeps changing
- Plugin pages can let Termix scroll them, so parts from other plugins on the page move with it instead of trailing behind
- Plugin pages can tell when parts from other plugins on them have drawn, so they can show one loading screen instead of filling in piece by piece
- Secret references like `bw://web-1/username` also work in a host's or credential's username, and in the username of other protocol logins
- Desktop app: closing the window can quit Termix instead of keeping it in the tray
- Desktop app: the first time closing the window keeps Termix in the tray, a notice says it is still running and how to quit
- Admin setting to trust a host's first key without a prompt when nobody can confirm it. Each such key is audited
- Every desktop file, tarball and Flatpak bundle on a release carries signed build provenance, and each release has a signed `SHA256SUMS` file with build provenance in `SHA256SUMS.intoto.jsonl`. Check them with the new Verify your download page in the docs
- Docker images are signed with cosign and carry build provenance and an SBOM attestation
- Desktop app: Windows builds are code signed, thanks to Ember Swan
- A CycloneDX SBOM of the server's dependencies ships with each build: `/app/sbom.cdx.json` in the Docker image and `termix_sbom.cdx.json` on the release
- The server sends the same security headers with or without the bundled nginx: a strict Content-Security-Policy, Referrer-Policy, Permissions-Policy, Cross-Origin-Opener-Policy and HSTS over HTTPS
- Desktop app: the app page carries a Content-Security-Policy
- Limits on how often logins, second factor checks, password resets, sign ups, API key creation, exports and imports can be tried, per address and per account. Too many bad API keys from one address are refused for a while
- Rotate the encryption key from the API (`POST /encryption/rotate-key`) or with `ENCRYPTION_KEY_PREVIOUS`, and the database key with `DATABASE_KEY_PREVIOUS`. Everything moves to the new key at start
- The example Docker compose drops every capability it doesn't need, sets no-new-privileges and shows a read-only, non-root setup. The image runs on a read-only root filesystem
- Every plugin made for plugin API 2 runs in its own process. It can only read its own files, opens no network connections or programs unless it was granted that, and reaches Termix only through checked calls. Secrets, the database, SSH connections and saved logins stay in the server
- The desktop app fences each plugin the same way: it runs on its own copy of Node inside the system's sandbox (an AppContainer on Windows, a Seatbelt profile on macOS, Landlock and seccomp on Linux), so it can't read your files or the database, start programs or open connections it wasn't granted, and it is stopped when it goes over its memory limit.
- Desktop app: plugin frames keep the frame rules the server sends
- In the Docker image each plugin also runs as its own Linux user, so it can't read the database, keys or other plugins' data. With `NET_ADMIN`, plugins that may not open connections are also blocked by a firewall rule
- The screens of every plugin made for plugin API 2 run in sandboxed frames with no access to your login, the rest of the page or other plugins. Each frame reaches only its own plugin, with a short key that ends with your session, and asks Termix for anything else through a fixed list of checks. They keep the same look, theme, shortcuts and language. A frame loads nothing from other sites: pictures come through Termix, and it can only cover the screen, open links, start downloads or revoke your API keys right after you used it
- A plugin process starts when something needs it and stops after 10 idle minutes (`TERMIX_PLUGIN_IDLE_MINUTES`). Its jobs, event listeners, operations and services stay with Termix and start it again when they are needed. Plugins on the sign-in and connect paths, and plugins with work to watch, keep running. A plugin process that crashes, hangs, uses too much memory (`TERMIX_PLUGIN_MEMORY_MB`) or CPU (`TERMIX_PLUGIN_CPU_LIMIT`) is restarted, and marked failed if it keeps crashing
- No plugin runs inside the server any more. A plugin made for an older Termix (plugin API 1) stays off until it is updated. The plugins page names each one, says why and links the guide for moving it
- When a newer Termix is out, the plugins page names every installed plugin that won't run on it, so you can update those first
- Plugins from the registry are checked against the build provenance their release workflow signed, and the plugin page shows which build made the installed copy
- A plugin can ask to read the server's environment variables and files, for secrets a config file points at. Termix's own keys and data folder stay out of reach, and an admin has to allow it
- Plugin signing keys now come from an offline Termix root key. Official and community plugins install only when a key the root vouched for signed them, and each signing key expires
- Termix checks a root signed revocation list on start and once a day. A revoked plugin, plugin version or signing key is turned off and every admin gets an alert. Servers without internet keep the last list they had
- Admins get an alert when a plugin update is signed by a different key than the version before
- Desktop app: an update also has to carry a signature from the Termix release key before it installs
- Each audit log entry carries a hash of the one before, so a changed or removed entry shows. Termix checks the chain every hour and alerts every admin when it breaks. Plugins can show the chain's state and its newest hash to keep somewhere else
- Every admin gets an alert for a new admin, role changes, plugin installs, updates, turning a plugin on or giving it access, sign in setting changes, new API keys and a failed plugin revocation check
- Role changes, plugin access grants and sign in switches are written to the audit log
- Each user can list their own API keys with when they were last used, and revoke one or all of them. Admins can sign everyone out at once, and revoke every API key with it
- New API key scope `read`: the key can only read. A new key gets it, and expires after 90 days, unless the creator asks for something else
- Optional admin wait for servers with two or more admins: a new admin, turning off password login, turning off a sign in plugin or a plugin with dangerous access waits a set time, the other admins get an alert and can cancel it. Off by default. Turning it off or shortening it waits too. `TERMIX_ADMIN_HOLD_MINUTES` sets it from the server
- `termix-recover` on the server (`docker exec termix termix-recover`) lists admins, removes a locked out admin's second factor and signs people out, without signing in
- The sign in event plugins get now says which sign in method and device were used
- The server answers `/.well-known/security.txt` with where to report a security problem in Termix
- Docker images are reproducible: building the same commit again gives the same image, byte for byte
- Plugins can give small per host or per tab values, like usage bars, badges and status dots, that Termix draws itself. A dashboard with many hosts no longer needs a plugin frame for each row
- The plugins page shows how much memory Termix and each plugin process use and what keeps a plugin running, and admins get an alert when the server runs low on memory
- Plugin screens load faster and use far less memory: a plugin's background code starts only when something needs it and stops again when idle, every plugin view shares one cached copy of the app's scripts, and repeated reads of your permissions and settings are shared
- A plugin screen in a frame can show other plugins' parts again, like Homepage widgets, Host Metrics manager cards, host page tiles and terminal side panels. Termix draws each part in its own frame over the spot, clipped to the screen, hidden under open menus, and they still scroll, resize, drag in edit modes and take Tab focus
- Sign in methods and second factors from plugins are drawn by Termix itself, so no plugin code runs on the sign in screen. Passkeys and security keys use the browser prompt Termix runs, and the plugin's server checks every answer
- Sign in, serial port and web endpoint plugins run their screens in sandboxed frames too. Termix asks the browser for a serial port or a passkey for them, and shows a web endpoint page only at the address the plugin's server picked
- Theme files can only load images and fonts that ship with the theme
- Admins can turn an account off and back on. A turned off account is signed out everywhere, can't sign in, its API keys stop working and plugins can't run background work as it
- New SSO and LDAP accounts can wait for an admin to approve them before they can sign in. Admins get an alert when someone is waiting
- Invite links: an admin makes a link with roles, an expiry and a number of uses, and it works even when sign up is off. A link that makes an admin waits out the admin cooling-off time
- Display name and email on every account, set by the user or an admin, and the time of each user's last sign in
- Plugins can make, change, turn off and delete accounts and keep their roles in step, for user provisioning from an identity provider. An account made this way is linked to its first SSO or LDAP sign in when the verified email matches, and sign in doesn't rename it
- Access review: one list of every host, folder and credential share, with who has it, at what level, who gave it and when it ends, filtered by user, role or kind and exported as CSV (`GET /rbac/access-review`)
- Admin setting to stop admins from opening every user's hosts. When it is off, admins see only what is shared with them. Turning it on waits out the admin cooling-off time
- Ready made Viewer, Operator, Auditor and Helpdesk roles on new and upgraded servers. They are plain roles to edit or delete
- New permission `admin.audit.view` for reading the audit log
- Sidebar panels put search, their buttons and an icon add button on one row
- The tile picker starts with every group folded when it has more than four, so it reads as a list of apps
- Linux desktop entries list Termix as a terminal emulator, so terminal launchers can find it

### Changed

- The host list works out what each plugin offers for a host once per change instead of on every redraw, which saves a lot of CPU with many plugins
- Firefox no longer logs a clipboard warning for every plugin view
- Parts a plugin page shows from other plugins open at the size they had last time instead of growing from nothing
- Each plugin view downloads its icons as one file instead of dozens
- Status signals for many hosts load much faster: hosts are checked once per request and signals are read side by side
- Text boxes, dropdowns and checkboxes are a shade darker than what they sit on, so they stand out on pages and panels alike
- Server wide status tiles keep their answer for a minute like host tiles, instead of asking the plugin on every refresh
- Each plugin seals its secrets with its own key, so one plugin can't open what another sealed. Values sealed before move to the new key on the first start
- An API key made without picking scopes or an expiry is now read only and lasts 90 days. Ask for `full` and no expiry to get the old behavior. Existing keys keep what they had
- GitHub releases stay drafts until every download is uploaded, and a published release never changes its files
- Over HTTPS the login cookies use the `__Host-` prefix, so another site on a sibling domain can't set or replace them
- The Docker health check uses Node instead of wget, which is no longer in the image. ping needs no extra capability
- Server logs mask API keys, tokens, passwords and private keys, also inside error messages
- Desktop app: the app page is served from its own `app://termix` address instead of from files on disk. Saved view settings move over on the first start. A server older than 26.11.2 that sets `CORS_ALLOWED_ORIGINS` needs `app://termix` added
- Desktop app: updates install on Windows, macOS, AppImage and deb only after the release's signed `SHA256SUMS` checks out. Releases without it are offered as a download link
- Desktop app: the local server runs as an Electron utility process, and the app binary can no longer be started as a plain Node or with Node debug flags
- Desktop app: only the app itself can sign in to its local server. It sends a secret made fresh at every launch, so other programs and other users on the computer can't
- The Docker image runs on Node 26
- A plugin can no longer turn on the server's debugger
- Plugins signed with the old single key keep loading until 2027-05-01. Termix moves installed plugins over to the new signatures on its own, without downloading them again
- The `admin.users.view`, `admin.users.manage` and `admin.sessions.manage` permissions now work: a role with them can list and manage normal users and their sessions without being an admin. Only admins can change an admin account or give admin
- Someone who manages roles without being an admin can only give permissions they hold themselves
- The admin role always has every permission and its list can't be edited
- The admin role and the admin flag always match. A role map from SSO that names `admin` makes the user an admin
- Deleting a user as a non-admin needs a successor other than yourself, so nobody takes over someone's hosts and credentials by accident
- New accounts start with host rows that show the connect buttons, with edit and share behind the arrow, and a short add host form. Pick Advanced in Interface settings for the old look

### Fixed

- A desktop relaying through the server can reach a shared host even when the share has no login of its own
- Settings opens faster: the plugin list loads once and is reused instead of being fetched again by every part of the page
- The companion bar beside a tab scrolls when it has more buttons than fit, instead of covering what is below it
- Desktop app: a plugin copied from the linked server, like Remote Desktop, no longer fails to start with "Cannot find module 'ws'"
- Submenus inside a menu open again instead of being cut off by the menu around them
- Right after the server starts, a host no longer says it needs a plugin that is installed and still starting. Its login waits for that plugin instead
- Windows: saving the database tries again when the file is briefly locked, so a quick restart no longer leaves every plugin off
- Opening a host tool no longer logs an error when no plugin keeps recent activity
- Postgres and MySQL: the list of who a credential is shared with loads again
- Linux desktop app: the window follows the system display scale again, so it is no longer tiny on HiDPI screens. Set `TERMIX_FORCE_DEVICE_SCALE_FACTOR` to pick a scale by hand
- After an update the browser no longer keeps an old copy of the plugin SDK, which broke layouts with a missing export error until site data was cleared
- Outbound requests never reach a cloud metadata address, even for a host allowed as private
- Updating a plugin never moves it back to an older version unless you pick that version
- Saved passwords and keys of hosts and credentials only open for the host or credential they belong to. Existing ones move over at the first start, with a backup of the old values in the data folder
- Outbound checks also refuse private IPv4 addresses written in IPv4-compatible or NAT64 IPv6 form
- Starting the server no longer hangs when downloading a missing plugin from the registry stalls
- Tile grids (dashboards, Homepage, host pages) go back to columns when the window gets wide again, and show their tiles when a page opens on a narrow screen
- A very long path prefix header no longer slows down the request it came with
- Desktop sync: when the same change was sent twice in one sync, the change was saved but the desktop was told it conflicted. The repeat is now answered as a duplicate
- SOCKS4 and SOCKS5 proxy chains set up in the host editor now connect. The proxy type was passed on in a form the proxy client refused
- Hosts shared with you without a login now sync to the desktop and mobile apps, and connecting asks you to add a login instead of saying the host is not on the sync server
- Desktop app: when both the owner and someone a host is shared with are signed in, the shared copy now syncs too
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
- Server answers no longer name the web framework the server runs on
- A broken file upload is answered as a bad request instead of a server error
- Plugin pages can only be shown inside Termix itself, not framed by other sites
- The API docs list the path parameters and answers of every route
- Plugins that run commands with sudo send the sudo password on stdin, so it never shows up in the host's process list
- A login that still has to set up a second factor can only open the setup screen, not manage plugins
- Rotating the JWT secret from the API now really replaces it and signs everyone out
- Error answers from the server no longer include internal error text
- Bad JSON and too large uploads get a 400 or 413 answer instead of a server error
- SSH key uploads on a host are limited to 1 MB
- Download names with unusual characters in a user export are kept safe
- A settings import no longer brings in password reset codes or the audit forwarding token
- Plugin tools on a shared host you have no login for now say a login is missing, not that the host was not found
- Plugins that are still starting after a server restart now show up once they are running, instead of staying missing until you reload the page
- Moving a deleted user's hosts to someone else also moves the folder shares they made
- Folder and credential shares that ran out are removed, like host shares
- A failed user delete no longer puts the database error in the reply
- Desktop app linked to a server: a change the server only partly saved comes back to the desktop instead of both sides looking synced
- Sync no longer fails on every pass on servers upgraded from before 2.8 straight to 2.9 or later
- Desktop app with connections starting on the server: hosts given by name connect again instead of failing with Bad packet length
- Host scripts run on hosts whose login shell is fish or csh
- Hovering a theme in Appearance or setup no longer flashes the page white while its colors load
- Linux desktop app: Ctrl+W closes the active tab instead of the window
- Desktop app and Chrome on macOS: a button's tooltip shows wherever the pointer rests on it, not only beside its icon

### Removed

- Desktop app: the 32-bit Windows (ia32) and 32-bit ARM Linux (armv7l) builds, since Electron no longer makes them

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
