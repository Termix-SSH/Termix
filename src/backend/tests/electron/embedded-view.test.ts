import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createEmbeddedViews, cleanBounds } = createRequire(import.meta.url)(
  "../../../../electron/embedded-view.cjs",
);

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
let contentView: {
  addChildView: ReturnType<typeof vi.fn>;
  removeChildView: ReturnType<typeof vi.fn>;
};
let session: EventEmitter & Record<string, ReturnType<typeof vi.fn>>;
let manager: ReturnType<typeof createEmbeddedViews>;

beforeEach(() => {
  views.length = 0;
  contentView = { addChildView: vi.fn(), removeChildView: vi.fn() };
  session = Object.assign(new EventEmitter(), {
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    clearStorageData: vi.fn().mockResolvedValue(undefined),
    clearCache: vi.fn().mockResolvedValue(undefined),
    closeAllConnections: vi.fn().mockResolvedValue(undefined),
    webRequest: { onBeforeRequest: vi.fn() },
  });
  manager = createEmbeddedViews({
    WebContentsView: FakeView,
    session: { fromPartition: vi.fn(() => session) },
    getMainWindow: () => ({ contentView, isDestroyed: () => false }),
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
    const handler = session.setPermissionRequestHandler.mock.calls[0][0];
    const allow = vi.fn();
    handler(null, "media", allow);
    expect(allow).toHaveBeenCalledWith(false);
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
    expect(session.clearStorageData).toHaveBeenCalled();
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
    manager.open({
      id: "a",
      url: "https://x.example/",
      ignoreCert: true,
      bounds,
    });
    manager.open({ id: "b", url: "https://z.example/", bounds });
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
