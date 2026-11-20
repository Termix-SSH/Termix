const { createHash, randomBytes, randomUUID } = require("node:crypto");
const {
  isolatedUrl,
  KEPT_LOGIN_PARTITION_PREFIX,
} = require("./isolated-window.cjs");

function cleanBounds(bounds) {
  const value = (n) => Math.max(0, Math.round(Number(n) || 0));
  return {
    x: value(bounds?.x),
    y: value(bounds?.y),
    width: value(bounds?.width),
    height: value(bounds?.height),
  };
}

// This machine. Ports here change and get reused (desktop tunnels), so an
// address on it is no lasting identity for a login. Hosts are as URL writes
// them, so ::ffff:127.0.0.1 reads [::ffff:7f00:1].
function isLoopbackHost(host) {
  if (["[::1]", "[::]", "0.0.0.0"].includes(host)) return true;
  if (/^127\.\d+\.\d+\.\d+$/.test(host)) return true;
  if (/^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/.test(host)) return true;
  const name = host.endsWith(".") ? host.slice(0, -1) : host;
  return name === "localhost" || name.endsWith(".localhost");
}

/**
 * Native web views drawn inside the main window, for pages that do not work
 * in a sandboxed iframe. Each one is a WebContentsView in its own
 * non-persistent session, with the same limits as an isolated window: no
 * permissions, no downloads, http(s) and ws(s) only. The renderer owns the
 * placement and sends the bounds of the element the view should cover.
 *
 * A plugin's page comes as a grant its backend made (ctx.desktop.grantView):
 * the backend sends the address, certificate rule and user here, the
 * renderer only names the grant. A plain url from the renderer never trusts a
 * bad certificate.
 *
 * A granted page keeps its login while the app runs: every view granted to
 * the same user, plugin, origin and certificate rule shares one in-memory
 * session, so a reload or a reopened tab is still signed in. Plain urls,
 * grants without a user and pages on this machine get a session of their own
 * that is cleared when the view closes. Signing out of Termix
 * (forgetSessions) starts a new generation, so nothing opened after it
 * reaches the sessions from before.
 */
const MAX_GRANTS = 500;

function createEmbeddedViews({
  WebContentsView,
  session,
  getMainWindow,
  log = () => {},
}) {
  const views = new Map();
  const grants = new Map();
  let generation = 1;
  // Part of every kept login's name, so nothing else can work one out and
  // open that session.
  const secret = randomBytes(32).toString("hex");
  // Shared sessions of this generation, cleared at the next sign-out even
  // when no view uses them any more.
  const sharedSessions = new Set();
  const lockedDown = new WeakSet();

  function addGrant(payload = {}) {
    const grant = String(payload.grant || "");
    const pluginId = String(payload.pluginId || "");
    const expiresAt = Number(payload.expiresAt);
    if (!/^[0-9a-f]{48}$/.test(grant) || !pluginId) {
      throw new Error("Bad view grant");
    }
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      throw new Error("Bad view grant");
    }
    const url = isolatedUrl(payload.url);
    const now = Date.now();
    for (const [id, entry] of grants) {
      if (entry.expiresAt <= now) grants.delete(id);
    }
    while (grants.size >= MAX_GRANTS) {
      grants.delete(grants.keys().next().value);
    }
    grants.set(grant, {
      pluginId,
      url: url.href,
      ignoreCert: payload.ignoreCert === true && url.protocol === "https:",
      userId:
        typeof payload.userId === "string" && payload.userId
          ? payload.userId
          : null,
      expiresAt,
    });
    return { success: true };
  }

  function grantFor(grant, pluginId) {
    const entry = grants.get(String(grant || ""));
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      grants.delete(String(grant));
      return null;
    }
    return entry.pluginId === String(pluginId || "") ? entry : null;
  }

  // The shared session a target's view uses, or null for one of its own.
  function partitionFor(target, url) {
    if (!target.userId || isLoopbackHost(url.hostname)) return null;
    const scope = JSON.stringify([
      "embedded-login",
      secret,
      generation,
      target.userId,
      target.pluginId,
      url.origin,
      target.ignoreCert === true,
    ]);
    const hash = createHash("sha256").update(scope).digest("hex");
    return `${KEPT_LOGIN_PARTITION_PREFIX}${hash}`;
  }

  // The same limits as an isolated window, set once per session.
  function lockDown(isolated) {
    if (lockedDown.has(isolated)) return;
    lockedDown.add(isolated);
    isolated.setPermissionRequestHandler((_c, _p, callback) => callback(false));
    isolated.setPermissionCheckHandler(() => false);
    isolated.on("will-download", (event) => event.preventDefault());
    isolated.webRequest.onBeforeRequest((details, callback) => {
      const protocol = new URL(details.url).protocol;
      callback({
        cancel: !["http:", "https:", "ws:", "wss:"].includes(protocol),
      });
    });
  }
  // Popups opened from a view, so a certificate error there is judged by
  // the view's rules.
  const popupContents = new WeakMap();

  function destroy(id) {
    const entry = views.get(id);
    if (!entry) return;
    views.delete(id);
    const main = getMainWindow();
    if (main && !main.isDestroyed()) {
      try {
        main.contentView.removeChildView(entry.view);
      } catch {
        /* already detached */
      }
    }
    for (const popup of [...entry.popups]) {
      if (!popup.isDestroyed()) popup.destroy();
    }
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close();
    // A shared session outlives its views until sign-out.
    if (entry.partition) return;
    void Promise.allSettled([
      entry.session.clearStorageData(),
      entry.session.clearCache(),
      entry.session.closeAllConnections(),
    ]);
  }

  function destroyAll() {
    for (const id of [...views.keys()]) destroy(id);
  }

  /**
   * Termix sign-out. At once: a new generation, so later opens get new
   * sessions, no grants and no views. Then each clear of the old shared
   * sessions runs on its own; one that fails is logged and its data stays
   * out of reach until the app quits. One sign-out can call this twice, and a
   * login made in between then has to sign in to its pages again.
   */
  function forgetSessions() {
    generation += 1;
    const retired = [...sharedSessions];
    sharedSessions.clear();
    grants.clear();
    destroyAll();
    return Promise.all(
      retired.flatMap((isolated) =>
        [
          "clearStorageData",
          "clearCache",
          "clearAuthCache",
          "closeAllConnections",
        ].map((method) =>
          new Promise((resolve) => resolve(isolated[method]())).catch((error) =>
            log(`[embedded-view] ${method} failed: ${error}`),
          ),
        ),
      ),
    ).then(() => undefined);
  }

  function open(options = {}) {
    const main = getMainWindow();
    if (!main) throw new Error("No window to attach a view to");
    const id = String(options.id || "");
    if (!id) throw new Error("A view needs an id");
    let target = { url: options.url, ignoreCert: false };
    if (options.grant !== undefined) {
      const granted = grantFor(options.grant, options.pluginId);
      // The renderer falls back to a sandboxed iframe from its server.
      if (!granted) return { success: false, error: "Unknown view grant" };
      target = granted;
    }
    const url = isolatedUrl(target.url);
    const ignoreCert = target.ignoreCert === true;
    const partition = partitionFor(target, url);
    const existing = views.get(id);
    if (existing) {
      if (
        existing.url === url.href &&
        existing.ignoreCert === ignoreCert &&
        existing.partition === partition
      ) {
        setBounds(id, options.bounds);
        setVisible(id, options.visible !== false);
        return { success: true };
      }
      destroy(id);
    }

    const isolated = session.fromPartition(
      partition ?? `embedded-view-${randomUUID()}`,
      {
        cache: false,
      },
    );
    lockDown(isolated);
    if (partition) sharedSessions.add(isolated);

    const preferences = {
      session: isolated,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      // Middle clicks on links never open windows of their own.
      disableBlinkFeatures: "Auxclick",
    };
    const view = new WebContentsView({ webPreferences: preferences });
    const entry = {
      view,
      session: isolated,
      partition,
      url: url.href,
      origin: url.origin,
      ignoreCert,
      popups: new Set(),
    };
    const canNavigate = (target) => {
      try {
        return target === "about:blank" || !!isolatedUrl(target);
      } catch {
        return false;
      }
    };
    // The view and every popup it opens follow the same rules.
    const guard = (contents) => {
      for (const name of ["will-navigate", "will-redirect"]) {
        contents.on(name, (event, target) => {
          if (!canNavigate(target)) event.preventDefault();
        });
      }
      contents.on("will-attach-webview", (event) => event.preventDefault());
      contents.setWindowOpenHandler(({ url: target }) =>
        canNavigate(target)
          ? {
              action: "allow",
              overrideBrowserWindowOptions: { webPreferences: preferences },
            }
          : { action: "deny" },
      );
      contents.on("did-create-window", (popup) => {
        entry.popups.add(popup);
        popup.setMenu?.(null);
        popupContents.set(popup.webContents, entry);
        guard(popup.webContents);
        popup.once("closed", () => entry.popups.delete(popup));
      });
    };
    guard(view.webContents);

    views.set(id, entry);
    main.contentView.addChildView(view);
    setBounds(id, options.bounds);
    setVisible(id, options.visible !== false);
    view.webContents.loadURL(url.href).catch(() => {});
    return { success: true };
  }

  function setBounds(id, bounds) {
    const entry = views.get(id);
    if (entry) entry.view.setBounds(cleanBounds(bounds));
  }

  function setVisible(id, visible) {
    const entry = views.get(id);
    if (entry) entry.view.setVisible(!!visible);
  }

  function handleCertificateError(event, contents, url, callback) {
    const candidates = [...views.values()];
    const popupOwner = popupContents.get(contents);
    if (popupOwner) candidates.unshift(popupOwner);
    for (const entry of candidates) {
      if (entry !== popupOwner && entry.view.webContents !== contents) continue;
      event.preventDefault();
      let allowed = false;
      try {
        allowed = entry.ignoreCert && new URL(url).origin === entry.origin;
      } catch {
        /* malformed URL is refused */
      }
      callback(allowed);
      return true;
    }
    return false;
  }

  return {
    addGrant,
    open,
    setBounds,
    setVisible,
    destroy,
    destroyAll,
    forgetSessions,
    handleCertificateError,
  };
}

module.exports = { createEmbeddedViews, cleanBounds };
