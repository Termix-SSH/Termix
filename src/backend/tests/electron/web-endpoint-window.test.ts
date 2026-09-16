import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { createWebEndpointWindows } = createRequire(import.meta.url)(
  "../../../../electron/web-endpoint-window.cjs",
);
const created: FakeWindow[] = [];
class FakeWindow extends EventEmitter {
  options: Record<string, unknown>;
  destroyed = false;
  webContents = Object.assign(new EventEmitter(), {
    mainFrame: {},
    setWindowOpenHandler: vi.fn(),
  });
  setMenu = vi.fn();
  loadURL = vi.fn().mockResolvedValue(undefined);
  constructor(options: Record<string, unknown>) {
    super();
    this.options = options;
    created.push(this);
  }
  isDestroyed() {
    return this.destroyed;
  }
  destroy() {
    this.destroyed = true;
    this.emit("closed");
  }
}
let main: FakeWindow;
type TestSession = EventEmitter & {
  setPermissionRequestHandler: ReturnType<typeof vi.fn>;
  setPermissionCheckHandler: ReturnType<typeof vi.fn>;
  webRequest: { onBeforeRequest: ReturnType<typeof vi.fn> };
  clearStorageData: ReturnType<typeof vi.fn>;
  clearCache: ReturnType<typeof vi.fn>;
  closeAllConnections: ReturnType<typeof vi.fn>;
};
let sessions: TestSession[];
let fromPartition: ReturnType<typeof vi.fn>;
let manager: ReturnType<typeof createWebEndpointWindows>;
function event() {
  return { sender: main.webContents, senderFrame: main.webContents.mainFrame };
}
beforeEach(() => {
  created.length = 0;
  sessions = [];
  main = new FakeWindow({});
  created.length = 0;
  fromPartition = vi.fn(() => {
    const session = Object.assign(new EventEmitter(), {
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      webRequest: { onBeforeRequest: vi.fn() },
      clearStorageData: vi.fn().mockResolvedValue(undefined),
      clearCache: vi.fn().mockResolvedValue(undefined),
      closeAllConnections: vi.fn().mockResolvedValue(undefined),
    });
    sessions.push(session);
    return session;
  });
  manager = createWebEndpointWindows({
    BrowserWindow: FakeWindow,
    session: { fromPartition },
    getMainWindow: () => main,
  });
});
describe("isolated endpoint windows", () => {
  it("creates unique non-persistent sessions without preload or Node privileges", async () => {
    await manager.open(event(), { url: "https://service.test" });
    await manager.open(event(), { url: "https://service.test" });
    expect(fromPartition.mock.calls[0][0]).not.toBe(
      fromPartition.mock.calls[1][0],
    );
    expect(fromPartition.mock.calls[0][0]).not.toMatch(/^persist:/);
    expect(created[0].options.webPreferences).toEqual({
      session: sessions[0],
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      webSecurity: true,
    });
  });
  it("rejects subframes, other windows and non-web destinations before creating a session", async () => {
    await expect(
      manager.open(
        { ...event(), senderFrame: {} },
        { url: "https://service.test" },
      ),
    ).rejects.toThrow(/main Termix/);
    await expect(
      manager.open({ ...event(), sender: {} }, { url: "https://service.test" }),
    ).rejects.toThrow(/main Termix/);
    for (const url of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "https://user:secret@service.test",
    ]) {
      await expect(manager.open(event(), { url })).rejects.toThrow();
    }
    expect(fromPartition).not.toHaveBeenCalled();
  });
  it("keeps login popups in the same isolated session and blocks native-protocol navigation", async () => {
    await manager.open(event(), { url: "https://service.test" });
    const win = created[0],
      open = win.webContents.setWindowOpenHandler.mock.calls[0][0];
    expect(
      open({ url: "https://login.test" }).overrideBrowserWindowOptions
        .webPreferences.session,
    ).toBe(sessions[0]);
    expect(open({ url: "file:///tmp/secret" }).action).toBe("deny");
    const navigation = { preventDefault: vi.fn() };
    win.webContents.emit("will-redirect", navigation, "file:///tmp/secret");
    expect(navigation.preventDefault).toHaveBeenCalled();
    const callback = vi.fn();
    sessions[0].webRequest.onBeforeRequest.mock.calls[0][0](
      { url: "file:///tmp/secret" },
      callback,
    );
    expect(callback).toHaveBeenCalledWith({ cancel: true });
  });
  it("limits invalid certificates to the opted-in origin, including its port", async () => {
    await manager.open(event(), {
      url: "https://service.test:8443",
      ignoreCert: true,
    });
    const e = { preventDefault: vi.fn() },
      callback = vi.fn();
    expect(
      manager.handleCertificateError(
        e,
        created[0].webContents,
        "https://service.test:8443/path",
        callback,
      ),
    ).toBe(true);
    expect(callback).toHaveBeenLastCalledWith(true);
    manager.handleCertificateError(
      e,
      created[0].webContents,
      "https://service.test:9443",
      callback,
    );
    expect(callback).toHaveBeenLastCalledWith(false);
    expect(
      manager.handleCertificateError(
        e,
        main.webContents,
        "https://service.test:8443",
        callback,
      ),
    ).toBe(false);
  });
  it("closes login popups and clears session data when the endpoint closes", async () => {
    await manager.open(event(), { url: "https://service.test" });
    const root = created[0],
      popup = new FakeWindow({});
    root.webContents.emit("did-create-window", popup);
    root.destroy();
    expect(popup.isDestroyed()).toBe(true);
    expect(sessions[0].clearStorageData).toHaveBeenCalledOnce();
    expect(sessions[0].closeAllConnections).toHaveBeenCalledOnce();
  });
});
