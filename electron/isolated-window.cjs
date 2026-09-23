const { randomUUID } = require("node:crypto");

function isolatedUrl(value) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error(
      "Isolated windows require an HTTP(S) URL without embedded credentials",
    );
  }
  return url;
}

/**
 * Opens a BrowserWindow in its own non-persistent session, isolated from the
 * main Termix window's cookies and storage. Used for any URL a plugin wants
 * shown without sharing Termix's own session (a tunnelled or direct host web
 * UI today; core has no other caller yet).
 *
 * Two ways in, both trusted: the renderer's own IPC call (checked against the
 * main window's webContents before reaching here) and the embedded backend's
 * fork IPC request (trusted because it is this app's own forked process, not
 * arbitrary web content -- see the "backend-request" handler below).
 */
function createIsolatedWindows({ BrowserWindow, session, getMainWindow }) {
  const certificates = new WeakMap();
  async function open(options = {}) {
    const main = getMainWindow();
    if (!main) {
      throw new Error("No window to attach an isolated window to");
    }
    const url = isolatedUrl(options.url);
    const isolated = session.fromPartition(
      options.partition || `isolated-window-${randomUUID()}`,
      { cache: false },
    );
    isolated.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
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
      webviewTag: false,
      webSecurity: true,
    };
    const windows = new Set();
    const allowedCertificateOrigin =
      options.ignoreCert === true ? url.origin : null;
    const configure = (win) => {
      windows.add(win);
      certificates.set(win.webContents, allowedCertificateOrigin);
      win.setMenu(null);
      const canNavigate = (target) => {
        try {
          return target === "about:blank" || !!isolatedUrl(target);
        } catch {
          return false;
        }
      };
      for (const name of ["will-navigate", "will-redirect"]) {
        win.webContents.on(name, (event, target) => {
          if (!canNavigate(target)) event.preventDefault();
        });
      }
      win.webContents.setWindowOpenHandler(({ url: target }) =>
        canNavigate(target)
          ? {
              action: "allow",
              overrideBrowserWindowOptions: { webPreferences: preferences },
            }
          : { action: "deny" },
      );
      win.webContents.on("did-create-window", configure);
      win.on("closed", () => {
        windows.delete(win);
        if (windows.size === 0) {
          void Promise.allSettled([
            isolated.clearStorageData(),
            isolated.clearCache(),
            isolated.closeAllConnections(),
          ]);
        }
      });
    };
    const win = new BrowserWindow({
      width: 1100,
      height: 800,
      title: options.title || url.hostname,
      webPreferences: preferences,
    });
    configure(win);
    const close = () => {
      for (const child of [...windows])
        if (!child.isDestroyed()) child.destroy();
    };
    main.once("closed", close);
    win.once("closed", () => {
      main.removeListener("closed", close);
      close();
    });
    try {
      await win.loadURL(url.href);
    } catch (error) {
      close();
      throw error;
    }
    return { success: true };
  }
  function handleCertificateError(event, contents, url, callback) {
    if (!certificates.has(contents)) return false;
    event.preventDefault();
    let allowed = false;
    try {
      allowed = certificates.get(contents) === new URL(url).origin;
    } catch {
      /* malformed URL is refused */
    }
    callback(allowed);
    return true;
  }
  return { open, handleCertificateError };
}
module.exports = { createIsolatedWindows, isolatedUrl };
