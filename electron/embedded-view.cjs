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
 */
function createEmbeddedViews({ WebContentsView, session, getMainWindow }) {
  const views = new Map();

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
    const url = isolatedUrl(options.url);
    const existing = views.get(id);
    if (existing) {
      if (
        existing.url === url.href &&
        existing.ignoreCert === !!options.ignoreCert
      ) {
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

    const view = new WebContentsView({
      webPreferences: {
        session: isolated,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
        webSecurity: true,
      },
    });
    const canNavigate = (target) => {
      try {
        return target === "about:blank" || !!isolatedUrl(target);
      } catch {
        return false;
      }
    };
    for (const name of ["will-navigate", "will-redirect"]) {
      view.webContents.on(name, (event, target) => {
        if (!canNavigate(target)) event.preventDefault();
      });
    }
    view.webContents.setWindowOpenHandler(({ url: target }) =>
      canNavigate(target)
        ? {
            action: "allow",
            overrideBrowserWindowOptions: {
              webPreferences: { session: isolated, sandbox: true },
            },
          }
        : { action: "deny" },
    );

    views.set(id, {
      view,
      session: isolated,
      url: url.href,
      origin: url.origin,
      ignoreCert: !!options.ignoreCert,
    });
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
    for (const entry of views.values()) {
      if (entry.view.webContents !== contents) continue;
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
    open,
    setBounds,
    setVisible,
    destroy,
    destroyAll,
    handleCertificateError,
  };
}

module.exports = { createEmbeddedViews, cleanBounds };
