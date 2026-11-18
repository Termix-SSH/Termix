const { isolatedUrl } = require("./isolated-window.cjs");

function cleanBounds(bounds) {
  const value = (n) => Math.max(0, Math.round(Number(n) || 0));
  return {
    x: value(bounds?.x),
    y: value(bounds?.y),
    width: value(bounds?.width),
    height: value(bounds?.height),
  };
}

/**
 * Native web views drawn inside the main window, for pages that do not work
 * in a sandboxed iframe. Each one is a WebContentsView in its own
 * non-persistent session, with the same limits as an isolated window: no
 * permissions, no downloads, http(s) and ws(s) only. The renderer owns the
 * placement and sends the bounds of the element the view should cover.
 *
 * A plugin's page comes as a grant its backend made (ctx.desktop.grantView):
 * the backend sends the address and certificate rule here, the renderer only
 * names the grant. A plain url from the renderer never trusts a bad
 * certificate.
 */
const MAX_GRANTS = 500;

function createEmbeddedViews({ WebContentsView, session, getMainWindow }) {
  const views = new Map();
  const grants = new Map();

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
    void Promise.allSettled([
      entry.session.clearStorageData(),
      entry.session.clearCache(),
      entry.session.closeAllConnections(),
    ]);
  }

  function destroyAll() {
    for (const id of [...views.keys()]) destroy(id);
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
    const existing = views.get(id);
    if (existing) {
      if (existing.url === url.href && existing.ignoreCert === ignoreCert) {
        setBounds(id, options.bounds);
        setVisible(id, options.visible !== false);
        return { success: true };
      }
      destroy(id);
    }

    const isolated = session.fromPartition(
      `embedded-view-${id}-${Date.now()}`,
      {
        cache: false,
      },
    );
    isolated.setPermissionRequestHandler((_c, _p, callback) => callback(false));
    isolated.setPermissionCheckHandler(() => false);
    isolated.on("will-download", (event) => event.preventDefault());
    isolated.webRequest.onBeforeRequest((details, callback) => {
      const protocol = new URL(details.url).protocol;
      callback({
        cancel: !["http:", "https:", "ws:", "wss:"].includes(protocol),
      });
    });

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
    handleCertificateError,
  };
}

module.exports = { createEmbeddedViews, cleanBounds };
