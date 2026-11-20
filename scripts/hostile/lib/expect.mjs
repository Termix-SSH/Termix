// What each attack must end in.
//   refused  the attack must not work
//   works    a control: the allowed version must work, or the fixture is broken
//   limit    a known gap the sandbox can't close, listed in the docs; it is
//            reported but does not fail the run
// na lists the channels where an attack can't run (fork, stdio).

const refused = (why, extra = {}) => ({ expect: "refused", why, ...extra });
const works = (why) => ({ expect: "works", why });
const limit = (why) => ({ expect: "limit", why });

const FORK_ONLY = { na: ["stdio"] };

export const BACKEND = {
  "fs.read-data-dir": refused("list core's data folder"),
  "fs.read-canary": refused("read a file in core's data folder"),
  "fs.read-data-files": refused("read the database, keys and uid map"),
  "fs.read-victim": refused("read another plugin's data folder"),
  "fs.read-victim-dotdot": refused("reach another plugin's folder through .."),
  "fs.symlink-escape": refused("link out of its own folder"),
  "fs.write-data-dir": refused("write in core's data folder"),
  "fs.write-victim": refused("write in another plugin's folder"),
  "fs.write-tmp": refused("write in the system temp folder"),
  "fs.write-core": refused("write in core's install folder"),
  "fs.own-control": works("its own data folder"),
  "env.read": refused("core secrets or variables in its environment"),
  "proc.spawn": refused("start a process without process:spawn"),
  "proc.exec": refused("run a shell without process:spawn"),
  "proc.worker-file": refused("start a worker without sandbox.workers"),
  "proc.worker-eval": refused("start a worker from a code string"),
  "proc.dlopen": refused("load a native addon"),
  "proc.binding": refused("reach Node's internal bindings"),
  "proc.linked-binding": refused("reach linked bindings"),
  "proc.debug-parent": refused("open core's inspector"),
  "proc.signal-parent": refused("signal core's process"),
  "proc.signal-parent-internal": refused("signal core through process._kill"),
  "proc.priority-parent": refused("change core's priority"),
  "mod.sqlite": refused("open node:sqlite"),
  "mod.sqlite-require": refused("require node:sqlite"),
  "mod.sqlite-builtin": refused("get node:sqlite as a builtin"),
  "mod.inspector": refused("open node:inspector"),
  "mod.wasi": refused("open node:wasi"),
  "mod.trace-events": refused("open node:trace_events"),
  "net.tcp": refused("open a TCP socket without network:sockets"),
  "net.udp": refused("send UDP without network:sockets"),
  "net.dns": refused("resolve names without network:sockets"),
  "net.http": refused("use node:http without network:sockets"),
  "net.global-fetch": refused("use the global fetch without network:sockets"),
  "net.global-websocket": refused("open a WebSocket without network:sockets"),
  "fetch.metadata": refused("reach the cloud metadata address"),
  "fetch.metadata-v6": refused("reach the IPv6 metadata address"),
  "fetch.loopback": refused("reach 127.0.0.1"),
  "fetch.localhost": refused("reach localhost"),
  "fetch.loopback-v6": refused("reach ::1"),
  "fetch.mapped-v6": refused("reach a v4 mapped loopback"),
  "fetch.decimal": refused("reach loopback written as a number"),
  "fetch.hex": refused("reach loopback written in hex"),
  "fetch.octal": refused("reach loopback written in octal"),
  "fetch.short": refused("reach loopback written short"),
  "fetch.zero": refused("reach 0.0.0.0"),
  "fetch.private-10": refused("reach 10.0.0.0/8"),
  "fetch.private-192": refused("reach 192.168.0.0/16"),
  "fetch.core": refused("reach core's own port"),
  "fetch.allowed-control": works("the one host the admin allowed"),
  "fetch.redirect-private": refused("follow a redirect to a private address", {
    na: ["no-redirect"],
  }),
  "fetch.self-allowed-metadata": refused(
    "name the metadata address in allowPrivateHosts itself",
  ),
  "db.own-control": works("its own table"),
  "db.core-users": refused("read users"),
  "db.core-sessions": refused("read sessions"),
  "db.core-settings": refused("read settings"),
  "db.victim": refused("read another plugin's table"),
  "db.quoted": refused('read "users"'),
  "db.backtick": refused("read `users`"),
  "db.bracket": refused("read [users]"),
  "db.schema": refused("read main.users"),
  "db.union": refused("UNION into users"),
  "db.comment": refused("hide users behind block comments"),
  "db.line-comment": refused("hide users behind a line comment"),
  "db.subquery": refused("read users in a subquery"),
  "db.cte": refused("read users in a CTE"),
  "db.cte-shadow": refused("shadow its own table name with a CTE over users"),
  "db.pragma": refused("PRAGMA on users"),
  "db.pragma-list": refused("list databases"),
  "db.attach": refused("ATTACH a file"),
  "db.master": refused("read sqlite_master"),
  "db.schema-table": refused("read sqlite_schema"),
  "db.load-extension": refused("load an extension"),
  "db.vacuum-into": refused("VACUUM INTO a file"),
  "db.ddl": refused("run DDL"),
  "db.multi": refused("run a second statement"),
  "db.batch-sessions": refused("delete sessions in a batch"),
  "db.batch-victim": refused("change another plugin's table in a batch"),
  "db.batch-pragma": refused("PRAGMA in a batch"),
  "user.as-user": refused("act as a user without users:impersonate"),
  "user.issue-token": refused("mint a user token"),
  "user.replay-token": refused(
    "reuse a request's token after its 30 s grace",
    FORK_ONLY,
  ),
  "secret.unseal-victim": refused("unseal another plugin's secret"),
  "secret.shared-victim": refused("read a secret nobody offered"),
  "flood.unknown-raw": refused(
    "call a capability it was never given by name",
    FORK_ONLY,
  ),
};

// Checked by the runner around the plugin, not by the plugin itself.
export const RUNNER = {
  "lock.future-host": refused("lock a host that did not exist yet"),
  "flood.calls": refused("make core stop answering with a call flood"),
  "flood.big": refused("store or send a 200 MB value"),
  "flood.big-raw": refused("push a 200 MB message at core", FORK_ONLY),
  "crash.loop": refused("crash forever without core giving up"),
  "token.other-plugin": refused("use a frame token on another plugin"),
  "token.core-route": refused("use a frame token on a core route"),
  "token.after-logout": refused("use a frame token after logout"),
  "token.expired": refused("use a frame token past its 5 minutes"),
  "token.forged-none": refused("use an unsigned token"),
  "token.forged-key": refused("use a token signed with another key"),
  "token.own-control": works("a frame token on its own plugin's route"),
};

export const FRAME = {
  "frame.token-is-own": refused("get a token for another plugin"),
  "frame.token-victim-route": refused("call another plugin's routes"),
  "frame.pose-plugin": refused("ask for a token as another plugin"),
  "frame.fake-hello": refused("pass as a view or another plugin"),
  "frame.read-parent": refused("read the shell's cookies"),
  "frame.read-parent-storage": refused("read the shell's storage"),
  "frame.read-siblings": refused("read another frame"),
  "frame.cookie": refused("read cookies"),
  "frame.storage-shell-keys": refused("find shell tokens in its storage"),
  "frame.indexeddb": refused("open IndexedDB on the shell's origin"),
  "frame.popup": refused("open a popup"),
  "frame.top-nav": refused("navigate the top window"),
  "shell.open-url": refused("open a window through the shell with no click"),
  "shell.download": refused("start a download with no click"),
  "shell.clipboard-read": refused("read the clipboard with no click"),
  "shell.clipboard-write": refused("write the clipboard with no click"),
  "shell.step-up": refused("ask for a step up with no click"),
  "shell.diagnostics-open": refused("open the diagnostics page with no click"),
  "shell.sign-out": refused("sign the user out without auth:policy"),
  "shell.passkey": refused("run a passkey step without auth:provide"),
  "shell.serial": refused("open a serial port without device:serial"),
  "shell.host-password": refused("read a saved host password"),
  "shell.invoke-victim": refused("run another plugin's action not in uses"),
  "shell.invoke-terminal": refused("type into a terminal without uses"),
  "shell.keybinding": refused("run a keybinding action it did not declare"),
  "core.users-list": refused("list users"),
  "core.victim-settings": refused("read another plugin's admin settings"),
  "core.victim-settings-put": refused("change another plugin's settings"),
  "core.encoded-slash": refused("step out with %2F"),
  "core.dot-dot": refused("step out with .."),
  "core.encoded-dots": refused("step out with %2e%2e"),
  "core.double-encoded": refused("step out with %252e"),
  "core.backslash": refused("step out with backslashes"),
  "core.absolute-url": refused("send a full URL"),
  "core.protocol-relative": refused("send //host"),
  "core.upper-case": refused("dodge the list with upper case"),
  "core.rotate-key": refused("rotate the encryption key"),
  "core.victim-operation": refused("run another plugin's operation"),
  "core.revoke-keys": refused("revoke the user's API keys with no click"),
  "core.plugin-state": refused("turn another plugin off"),
  "core.header-impersonate": refused("send owned headers"),
};

// Requests the outside origin must never see.
export const LEAKS = {
  "leak.img": refused("an image"),
  "leak.css": refused("a CSS background"),
  "leak.css-import": refused("a CSS @import"),
  "leak.font": refused("a font"),
  "leak.video": refused("a video"),
  "leak.audio": refused("an audio element"),
  "leak.iframe": refused("a nested frame"),
  "leak.svg-image": refused("an SVG image"),
  "leak.prefetch": refused("a prefetch"),
  "leak.stylesheet": refused("a stylesheet link"),
  "leak.beacon": refused("a beacon"),
  "leak.fetch": refused("fetch"),
  "leak.websocket": refused("a WebSocket"),
  "leak.event-source": refused("an EventSource"),
  "leak.form": refused("a form post"),
  "leak.worker": refused("fetch from a worker"),
  "leak.object": refused("an object element"),
  "leak.popup": refused("a popup"),
  "leak.topnav": refused("navigating the top window"),
  "leak.openurl": refused("a window the shell opened"),
  "leak.selfnav": limit(
    "a frame can always navigate itself; it only carries what the plugin can already see",
  ),
};

export const PAGE = {
  "page.top-nav": refused("the shell page left its URL"),
  "page.popup": refused("a new window or tab opened"),
  "page.toasts": refused("more than 20 toasts in a minute"),
  "page.foreign-overlay": refused("a foreign view drawn outside its frame"),
  "page.overlay-takeover": refused(
    "a background frame covering the shell with nobody asking",
  ),
  "page.download": refused("a download started"),
};

export const SUPPLY = {
  "supply.upload-dev-off": refused("upload a file with developer mode off"),
  "supply.upload-bad-sig": refused("upload with a broken signature"),
  "supply.upload-untrusted-key": refused("upload signed by an unknown key"),
  "supply.upload-replace-bundled": refused(
    "replace a bundled plugin by upload",
  ),
  "supply.upload-path-escape": refused(
    "unpack a file outside the plugin folder",
  ),
  "supply.upload-symlink": refused("unpack a symlink"),
  "supply.upload-control": works("an unsigned upload in developer mode"),
};

/**
 * Supply chain attacks a real server can't be set up for: the root keys are
 * compiled in, so no test key may sign a chain a server trusts. These run
 * through the real download and install code in process instead. Each names
 * its test; hostile.test.ts checks the test is still there.
 */
export const IN_PROCESS = {
  "supply.expired-cert": {
    file: "src/backend/tests/plugins/registry-index.test.ts",
    test: "refuses a release signed by an expired certificate",
  },
  "supply.revoked-key": {
    file: "src/backend/tests/plugins/registry-index.test.ts",
    test: "refuses a release signed by a revoked key",
  },
  "supply.wrong-tier-key": {
    file: "src/backend/tests/plugins/registry-index.test.ts",
    test: "refuses a community certified key for an official release",
  },
  "supply.swapped-file": {
    file: "src/backend/tests/plugins/registry-index.test.ts",
    test: "refuses a file that does not match its signature",
  },
  "supply.other-registry-key": {
    file: "src/backend/tests/plugins/registry-index.test.ts",
    test: "checks against the keys of the registry it came from",
  },
  "supply.downgrade": {
    file: "src/backend/tests/plugins/manage.test.ts",
    test: "never moves to an older version unless the admin names it",
  },
  "supply.wrong-attestation": {
    file: "src/backend/tests/plugins/provenance.test.ts",
    test: "refuses a bundle for another file or digest",
  },
  "supply.not-an-attestation": {
    file: "src/backend/tests/plugins/provenance.test.ts",
    test: "refuses something that is not an in-toto bundle",
  },
  "supply.revoked-root": {
    file: "src/backend/tests/plugins/trust-chain.test.ts",
    test: "refuses a cert for a revoked key or from a revoked root",
  },
  "desktop.process-attacks": {
    file: "src/backend/tests/plugins/sandbox/desktop-fence.test.ts",
    test: "refuses the hostile suite's process attacks",
  },
};

export const ALL = {
  ...BACKEND,
  ...RUNNER,
  ...FRAME,
  ...LEAKS,
  ...PAGE,
  ...SUPPLY,
};
