import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  createEmbeddedViews,
  cleanBounds,
} = require("../../../../electron/embedded-view.cjs");
const {
  createIsolatedWindows,
} = require("../../../../electron/isolated-window.cjs");

const views: FakeView[] = [];

class FakeView {
  webContents = Object.assign(new EventEmitter(), {
    setWindowOpenHandler: vi.fn(),
    loadURL: vi.fn().mockResolvedValue(undefined),
    isDestroyed: () => false,
    close: vi.fn(),
  });
  setBounds = vi.fn();
  setVisible = vi.fn();
  constructor(public options: { webPreferences: Record<string, unknown> }) {
    views.push(this);
  }
}

const bounds = { x: 10.4, y: 20.6, width: 300, height: 200 };
const GRANT_A = "a".repeat(48);
const GRANT_B = "b".repeat(48);

function grant(
  id: string,
  url: string,
  extra: Record<string, unknown> = {},
): void {
  manager.addGrant({
    grant: id,
    pluginId: "web-endpoint",
    url,
    ignoreCert: true,
    expiresAt: Date.now() + 60_000,
    ...extra,
  });
}
let contentView: {
  addChildView: ReturnType<typeof vi.fn>;
  removeChildView: ReturnType<typeof vi.fn>;
};
type FakeSession = EventEmitter & Record<string, ReturnType<typeof vi.fn>>;
// One fake per partition name, like Electron's session.fromPartition.
let sessions: Map<string, FakeSession>;
let fromPartition: ReturnType<typeof vi.fn>;
let log: ReturnType<typeof vi.fn>;
let manager: ReturnType<typeof createEmbeddedViews>;

function sessionOf(view: FakeView): FakeSession {
  return view.options.webPreferences.session as FakeSession;
}

beforeEach(() => {
  views.length = 0;
  contentView = { addChildView: vi.fn(), removeChildView: vi.fn() };
  sessions = new Map();
  fromPartition = vi.fn((name: string) => {
    if (!sessions.has(name)) {
      sessions.set(
        name,
        Object.assign(new EventEmitter(), {
          setPermissionRequestHandler: vi.fn(),
          setPermissionCheckHandler: vi.fn(),
          clearStorageData: vi.fn().mockResolvedValue(undefined),
          clearCache: vi.fn().mockResolvedValue(undefined),
          clearAuthCache: vi.fn().mockResolvedValue(undefined),
          closeAllConnections: vi.fn().mockResolvedValue(undefined),
          webRequest: { onBeforeRequest: vi.fn() },
        }),
      );
    }
    return sessions.get(name);
  });
  log = vi.fn();
  manager = createEmbeddedViews({
    WebContentsView: FakeView,
    session: { fromPartition },
    getMainWindow: () => ({ contentView, isDestroyed: () => false }),
    log,
  });
});

describe("embedded views", () => {
  it("opens a locked down view at the given bounds", () => {
    manager.open({ id: "a", url: "https://pve.example:8006/", bounds });
    const [view] = views;
    expect(view.options.webPreferences).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
    });
    expect(contentView.addChildView).toHaveBeenCalledWith(view);
    expect(view.setBounds).toHaveBeenCalledWith({
      x: 10,
      y: 21,
      width: 300,
      height: 200,
    });
    expect(view.webContents.loadURL).toHaveBeenCalledWith(
      "https://pve.example:8006/",
    );
    const handler =
      sessionOf(view).setPermissionRequestHandler.mock.calls[0][0];
    const allow = vi.fn();
    handler(null, "media", allow);
    expect(allow).toHaveBeenCalledWith(false);
  });

  it("gives popups the view's locked down settings and rules", () => {
    grant(GRANT_A, "https://pve.example:8006/");
    manager.open({
      id: "p",
      grant: GRANT_A,
      pluginId: "web-endpoint",
      bounds,
    });
    const [view] = views;
    const openHandler = view.webContents.setWindowOpenHandler.mock.calls[0][0];
    expect(openHandler({ url: "file:///etc/passwd" })).toEqual({
      action: "deny",
    });
    const allowed = openHandler({ url: "https://pve.example:8006/console" });
    expect(allowed.action).toBe("allow");
    expect(allowed.overrideBrowserWindowOptions.webPreferences).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      webSecurity: true,
      session: sessionOf(view),
    });

    // The popup gets the same navigation and window rules as the view.
    const popupContents = Object.assign(new EventEmitter(), {
      setWindowOpenHandler: vi.fn(),
    });
    const popup = Object.assign(new EventEmitter(), {
      webContents: popupContents,
      setMenu: vi.fn(),
      isDestroyed: () => false,
      destroy: vi.fn(),
    });
    view.webContents.emit("did-create-window", popup);
    expect(popupContents.setWindowOpenHandler).toHaveBeenCalled();
    const navigation = { preventDefault: vi.fn() };
    popupContents.emit("will-navigate", navigation, "file:///tmp/secret");
    expect(navigation.preventDefault).toHaveBeenCalled();

    // Its certificate errors follow the view's own origin rule.
    const allow = vi.fn();
    const event = { preventDefault: vi.fn() };
    expect(
      manager.handleCertificateError(
        event,
        popupContents,
        "https://evil.example/",
        allow,
      ),
    ).toBe(true);
    expect(allow).toHaveBeenCalledWith(false);

    manager.destroy("p");
    expect(popup.destroy).toHaveBeenCalled();
  });

  it("refuses urls that are not plain http or https", () => {
    expect(() =>
      manager.open({ id: "a", url: "file:///etc/passwd", bounds }),
    ).toThrow();
    expect(() =>
      manager.open({ id: "a", url: "https://u:p@host/", bounds }),
    ).toThrow();
  });

  it("moves and hides an open view, and closes it", () => {
    manager.open({ id: "a", url: "https://x.example/", bounds });
    manager.setBounds("a", { x: 1, y: 2, width: 3, height: 4 });
    manager.setVisible("a", false);
    const [view] = views;
    expect(view.setBounds).toHaveBeenLastCalledWith({
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    });
    expect(view.setVisible).toHaveBeenLastCalledWith(false);
    manager.destroy("a");
    expect(contentView.removeChildView).toHaveBeenCalledWith(view);
    expect(view.webContents.close).toHaveBeenCalled();
    expect(sessionOf(view).clearStorageData).toHaveBeenCalled();
  });

  it("reuses a view for the same url and replaces it for a new one", () => {
    manager.open({ id: "a", url: "https://x.example/", bounds });
    manager.open({ id: "a", url: "https://x.example/", bounds });
    expect(views).toHaveLength(1);
    manager.open({ id: "a", url: "https://y.example/", bounds });
    expect(views).toHaveLength(2);
    expect(contentView.removeChildView).toHaveBeenCalledWith(views[0]);
  });

  it("accepts an invalid certificate only for its own origin and only when asked", () => {
    grant(GRANT_A, "https://x.example/");
    manager.open({ id: "a", grant: GRANT_A, pluginId: "web-endpoint", bounds });
    // A url from the renderer never trusts a bad certificate.
    manager.open({
      id: "b",
      url: "https://z.example/",
      ignoreCert: true,
      bounds,
    });
    const check = (index: number, url: string) => {
      const event = { preventDefault: vi.fn() };
      const callback = vi.fn();
      const handled = manager.handleCertificateError(
        event,
        views[index].webContents,
        url,
        callback,
      );
      return { handled, allowed: callback.mock.calls[0]?.[0] };
    };
    expect(check(0, "https://x.example/page")).toEqual({
      handled: true,
      allowed: true,
    });
    expect(check(0, "https://other.example/")).toEqual({
      handled: true,
      allowed: false,
    });
    expect(check(1, "https://z.example/")).toEqual({
      handled: true,
      allowed: false,
    });
    expect(
      manager.handleCertificateError({}, {}, "https://x.example/", vi.fn()),
    ).toBe(false);
  });

  it("opens a grant only for the plugin it was made for", () => {
    grant(GRANT_A, "https://x.example/");
    expect(
      manager.open({ id: "a", grant: GRANT_A, pluginId: "other", bounds }),
    ).toEqual({ success: false, error: "Unknown view grant" });
    expect(
      manager.open({
        id: "a",
        grant: GRANT_B,
        pluginId: "web-endpoint",
        bounds,
      }),
    ).toEqual({ success: false, error: "Unknown view grant" });
    expect(views).toHaveLength(0);
    expect(
      manager.open({
        id: "a",
        grant: GRANT_A,
        pluginId: "web-endpoint",
        bounds,
      }),
    ).toEqual({ success: true });
    expect(views[0].webContents.loadURL).toHaveBeenCalledWith(
      "https://x.example/",
    );
  });

  it("drops expired grants and refuses bad ones", () => {
    grant(GRANT_A, "https://x.example/", { expiresAt: Date.now() + 5 });
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 1000);
      expect(
        manager.open({
          id: "a",
          grant: GRANT_A,
          pluginId: "web-endpoint",
          bounds,
        }).success,
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
    expect(() => grant("short", "https://x.example/")).toThrow();
    expect(() => grant(GRANT_B, "file:///etc/passwd")).toThrow();
    expect(() =>
      grant(GRANT_B, "https://x.example/", { expiresAt: Date.now() - 1 }),
    ).toThrow();
  });

  it("never trusts a bad certificate on a plain http grant", () => {
    grant(GRANT_A, "http://x.example/");
    manager.open({ id: "a", grant: GRANT_A, pluginId: "web-endpoint", bounds });
    const callback = vi.fn();
    manager.handleCertificateError(
      { preventDefault: vi.fn() },
      views[0].webContents,
      "https://x.example/",
      callback,
    );
    expect(callback).toHaveBeenCalledWith(false);
  });

  it("closes everything", () => {
    manager.open({ id: "a", url: "https://x.example/", bounds });
    manager.open({ id: "b", url: "https://y.example/", bounds });
    manager.destroyAll();
    expect(contentView.removeChildView).toHaveBeenCalledTimes(2);
  });

  it("keeps bounds as whole, non negative numbers", () => {
    expect(cleanBounds({ x: -5, y: "x", width: 9.5, height: 1 })).toEqual({
      x: 0,
      y: 0,
      width: 10,
      height: 1,
    });
  });
});

describe("kept logins", () => {
  let grants = 0;
  // Opens a fresh grant, the way a plugin's Reload or reopened tab does.
  function openGranted(
    id: string,
    url: string,
    extra: Record<string, unknown> = {},
  ): FakeView {
    const next = (++grants).toString(16).padStart(48, "0");
    grant(next, url, { userId: "user-1", ignoreCert: false, ...extra });
    manager.open({
      id,
      grant: next,
      pluginId: extra.pluginId ?? "web-endpoint",
      bounds,
    });
    return views[views.length - 1];
  }
  const clears = (s: FakeSession) =>
    [
      s.clearStorageData,
      s.clearCache,
      s.clearAuthCache,
      s.closeAllConnections,
    ].map((clear) => clear.mock.calls.length);

  it("shares one session across views of the same person, plugin and origin", () => {
    const first = openGranted("a", "https://pi.example/admin/");
    const second = openGranted("b", "https://pi.example/admin/login");
    expect(sessionOf(second)).toBe(sessionOf(first));
    manager.destroy("a");
    expect(clears(sessionOf(first))).toEqual([0, 0, 0, 0]);
    expect(second.webContents.close).not.toHaveBeenCalled();
    const third = openGranted("c", "https://pi.example/admin/");
    expect(sessionOf(third)).toBe(sessionOf(first));
    expect(
      fromPartition.mock.calls.some(([name]) => name.startsWith("persist:")),
    ).toBe(false);
  });

  it("keeps people, plugins, origins and certificate rules apart", () => {
    const base = sessionOf(openGranted("a", "https://pi.example/"));
    const others = [
      openGranted("b", "https://pi.example/", { userId: "user-2" }),
      openGranted("c", "https://pi.example/", { pluginId: "other" }),
      openGranted("d", "https://pihole.example/"),
      openGranted("e", "http://pi.example/"),
      openGranted("f", "https://pi.example:8443/"),
      openGranted("g", "https://pi.example/", { ignoreCert: true }),
    ].map(sessionOf);
    expect(new Set([base, ...others]).size).toBe(7);
  });

  it("gives plain urls, grants without a person and this machine a session of their own", () => {
    manager.open({ id: "plain", url: "https://pi.example/", bounds });
    const own = [
      views[0],
      openGranted("none", "https://pi.example/", { userId: undefined }),
      openGranted("empty", "https://pi.example/", { userId: "" }),
      openGranted("number", "https://pi.example/", { userId: 1 }),
      openGranted("object", "https://pi.example/", { userId: {} }),
    ];
    const loopback = [
      "http://127.0.0.1:8080/",
      "http://127.10.20.30/",
      "http://127.1/",
      "http://[::1]:3000/",
      "http://[0:0:0:0:0:0:0:1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:127.9.8.7]:8080/",
      "http://0.0.0.0/",
      "http://[::]/",
      "http://localhost/",
      "http://LOCALHOST./",
      "http://pi.localhost/",
    ];
    const local = loopback.map((url, index) =>
      openGranted(`loop-${index}`, url),
    );
    own.push(...local);
    expect(new Set(own.map(sessionOf)).size).toBe(own.length);
    manager.destroyAll();
    for (const view of own) {
      expect(sessionOf(view).clearStorageData).toHaveBeenCalled();
    }
    // Reopened with a fresh grant, a page on this machine starts over.
    loopback.forEach((url, index) => {
      const again = openGranted(`loop-${index}`, url);
      expect(sessionOf(again)).not.toBe(sessionOf(local[index]));
    });
    // A name that only starts with localhost, and a mapped address that is
    // not 127.x, are somewhere else.
    for (const url of [
      "http://localhost.evil.example/",
      "http://[::ffff:192.168.0.1]/",
    ]) {
      const first = openGranted(`${url}-1`, url);
      const second = openGranted(`${url}-2`, url);
      expect(sessionOf(second)).toBe(sessionOf(first));
    }
  });

  it.each(["http://127.0.0.1:8080/", "http://[::ffff:127.0.0.1]:8080/"])(
    "starts a fresh session when the same view id reopens at a fixed time: %s",
    async (url) => {
      const clock = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
      let finish = () => {};
      try {
        const old = sessionOf(openGranted("same-id", url));
        const pending = new Promise<void>((resolve) => {
          finish = resolve;
        });
        old.clearStorageData.mockReturnValueOnce(pending);
        manager.destroy("same-id");

        const fresh = sessionOf(openGranted("same-id", url));
        expect(fresh).not.toBe(old);
        expect(clears(fresh)).toEqual([0, 0, 0, 0]);

        finish();
        await pending;
        expect(clears(fresh)).toEqual([0, 0, 0, 0]);
      } finally {
        finish();
        clock.mockRestore();
      }
    },
  );

  it("starts a fresh session when a plain url replaces a view at a fixed time", () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    try {
      manager.open({ id: "same-id", url: "https://x.example/", bounds });
      manager.open({ id: "same-id", url: "https://y.example/", bounds });
      const [replaced, replacement] = views;
      expect(sessionOf(replacement)).not.toBe(sessionOf(replaced));
      const [first, second] = fromPartition.mock.calls.map(([name]) => name);
      expect(second).not.toBe(first);
    } finally {
      clock.mockRestore();
    }
  });

  it("names a kept login with a secret of its own", () => {
    openGranted("a", "https://pi.example/");
    const [name] = fromPartition.mock.calls[0];
    manager = createEmbeddedViews({
      WebContentsView: FakeView,
      session: { fromPartition },
      getMainWindow: () => ({ contentView, isDestroyed: () => false }),
    });
    openGranted("a", "https://pi.example/");
    expect(fromPartition.mock.calls[1][0]).not.toBe(name);
    // The scope alone does not give the name away.
    const scope = JSON.stringify([
      "embedded-login",
      1,
      "user-1",
      "web-endpoint",
      "https://pi.example",
      false,
    ]);
    const guess = createHash("sha256").update(scope).digest("hex");
    expect(name).not.toContain(guess);
  });

  it("keeps a kept login out of reach of isolated windows", async () => {
    openGranted("a", "https://pi.example/");
    const [name] = fromPartition.mock.calls[0];
    const windows = createIsolatedWindows({
      BrowserWindow: vi.fn(),
      session: { fromPartition },
      getMainWindow: () => ({}),
    });
    await expect(
      windows.open({ url: "https://pi.example/", partition: name }),
    ).rejects.toThrow();
    expect(fromPartition).toHaveBeenCalledTimes(1);
  });

  it("locks a shared session down once", () => {
    const view = openGranted("a", "https://pi.example/");
    openGranted("b", "https://pi.example/");
    manager.destroyAll();
    openGranted("c", "https://pi.example/");
    const shared = sessionOf(view);
    expect(shared.setPermissionRequestHandler).toHaveBeenCalledTimes(1);
    expect(shared.setPermissionCheckHandler).toHaveBeenCalledTimes(1);
    expect(shared.listenerCount("will-download")).toBe(1);
    expect(shared.webRequest.onBeforeRequest).toHaveBeenCalledTimes(1);
  });

  it("replaces a view under the same id when the person changes", () => {
    const first = openGranted("a", "https://pi.example/");
    openGranted("a", "https://pi.example/");
    expect(views).toHaveLength(1);
    const second = openGranted("a", "https://pi.example/", {
      userId: "user-2",
    });
    expect(views).toHaveLength(2);
    expect(first.webContents.close).toHaveBeenCalled();
    expect(sessionOf(second)).not.toBe(sessionOf(first));
  });

  it("keeps the session when the window reloads or closes", () => {
    const first = openGranted("a", "https://pi.example/");
    manager.destroyAll();
    expect(clears(sessionOf(first))).toEqual([0, 0, 0, 0]);
    expect(sessionOf(openGranted("a", "https://pi.example/"))).toBe(
      sessionOf(first),
    );
  });

  it("forgets every kept login at sign-out", async () => {
    const open = openGranted("a", "https://pi.example/");
    const closed = openGranted("b", "https://other.example/");
    manager.destroy("b");
    grant(GRANT_A, "https://pi.example/", { userId: "user-1" });

    await manager.forgetSessions();

    expect(open.webContents.close).toHaveBeenCalled();
    expect(clears(sessionOf(open))).toEqual([1, 1, 1, 1]);
    expect(clears(sessionOf(closed))).toEqual([1, 1, 1, 1]);
    expect(
      manager.open({
        id: "a",
        grant: GRANT_A,
        pluginId: "web-endpoint",
        bounds,
      }),
    ).toEqual({ success: false, error: "Unknown view grant" });

    // A new login gets a new, locked down session.
    const after = sessionOf(openGranted("a", "https://pi.example/"));
    expect(after).not.toBe(sessionOf(open));
    expect(after.setPermissionRequestHandler).toHaveBeenCalledTimes(1);

    // A second sign-out clears only what came after the first.
    await manager.forgetSessions();
    expect(clears(after)).toEqual([1, 1, 1, 1]);
    expect(clears(sessionOf(open))).toEqual([1, 1, 1, 1]);
  });

  it("starts every clear even when one fails, and logs the failure", async () => {
    const shared = sessionOf(openGranted("a", "https://pi.example/"));
    shared.clearStorageData.mockRejectedValueOnce(new Error("busy"));
    shared.clearCache.mockImplementationOnce(() => {
      throw new Error("gone");
    });
    await expect(manager.forgetSessions()).resolves.toBeUndefined();
    expect(clears(shared)).toEqual([1, 1, 1, 1]);
    expect(log).toHaveBeenCalledTimes(2);
  });

  it("never lets a slow clear reach the next login's session", async () => {
    const old = sessionOf(openGranted("a", "https://pi.example/"));
    let finish = () => {};
    old.clearStorageData.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const done = manager.forgetSessions();
    const fresh = sessionOf(openGranted("a", "https://pi.example/"));
    expect(fresh).not.toBe(old);
    finish();
    await done;
    expect(clears(fresh)).toEqual([0, 0, 0, 0]);
    expect(views[views.length - 1].webContents.close).not.toHaveBeenCalled();
  });
});
