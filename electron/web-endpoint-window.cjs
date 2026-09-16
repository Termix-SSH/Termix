const { randomUUID } = require("node:crypto");

function webUrl(value) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error(
      "Web endpoints require an HTTP(S) URL without embedded credentials",
    );
  }
  return url;
}

function createWebEndpointWindows({ BrowserWindow, session, getMainWindow }) {
  const certificates = new WeakMap();
  async function open(event, options = {}) {
    const main = getMainWindow();
    if (
      !main ||
      event.sender !== main.webContents ||
      event.senderFrame !== main.webContents.mainFrame
    ) {
      throw new Error("Only the main Termix window can open web endpoints");
    }
    const url = webUrl(options.url);
    const isolated = session.fromPartition(`web-endpoint-${randomUUID()}`, {
      cache: false,
    });
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
          return target === "about:blank" || !!webUrl(target);
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
      title: `Web endpoint — ${url.hostname}`,
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
module.exports = { createWebEndpointWindows, webUrl };
