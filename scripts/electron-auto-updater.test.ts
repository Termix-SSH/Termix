import { createRequire } from "node:module";
import path from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const updates = require("../electron/auto-updater.cjs") as {
  channelFile: (channel: string, platform: string, arch: string) => string;
  getInstallKind: (input: Record<string, unknown>) => string;
  resolveRelease: (
    releases: unknown,
    opts: { currentVersion: string; platform: string; arch: string },
  ) => {
    tag: string;
    version: string;
    channel: string;
    feedUrl: string;
    releaseUrl: string;
  } | null;
  createUpdater: (deps: Record<string, unknown>) => {
    getState: () => Record<string, unknown>;
    check: () => Promise<Record<string, unknown>>;
    download: () => Promise<Record<string, unknown>>;
    install: () => boolean;
    setMode: (mode: string) => Record<string, unknown>;
  };
};

function release(tag: string, assets: string[], extra = {}) {
  return {
    tag_name: tag,
    draft: false,
    html_url: `https://github.com/Termix-SSH/Termix/releases/tag/${tag}`,
    assets: assets.map((name) => ({ name })),
    ...extra,
  };
}

const ALL = [
  "latest.yml",
  "latest-mac.yml",
  "latest-linux.yml",
  "latest-linux-arm64.yml",
  "latest-linux-arm.yml",
  "beta.yml",
  "beta-mac.yml",
  "beta-linux.yml",
];

const win = { platform: "win32", arch: "x64" };

describe("channelFile", () => {
  it("matches the names electron-builder writes", () => {
    expect(updates.channelFile("latest", "win32", "x64")).toBe("latest.yml");
    expect(updates.channelFile("latest", "darwin", "arm64")).toBe(
      "latest-mac.yml",
    );
    expect(updates.channelFile("latest", "linux", "x64")).toBe(
      "latest-linux.yml",
    );
    expect(updates.channelFile("beta", "linux", "arm64")).toBe(
      "beta-linux-arm64.yml",
    );
    expect(updates.channelFile("latest", "linux", "arm")).toBe(
      "latest-linux-arm.yml",
    );
  });
});

describe("resolveRelease", () => {
  it("picks the newest stable release and points the feed at its tag", () => {
    const found = updates.resolveRelease(
      [release("v26.10.2", ALL), release("v26.10.3", ALL)],
      { currentVersion: "26.10.1", ...win },
    );
    expect(found).toMatchObject({
      tag: "v26.10.3",
      version: "26.10.3",
      channel: "latest",
      feedUrl:
        "https://github.com/Termix-SSH/Termix/releases/download/v26.10.3",
    });
  });

  it("ignores SDK, 2.9.x patch and draft releases", () => {
    expect(
      updates.resolveRelease(
        [
          release("sdk-v1.0.9", ALL),
          release("release-2.9.4-tag", ALL),
          release("v26.11.0", ALL, { draft: true }),
        ],
        { currentVersion: "26.10.1", ...win },
      ),
    ).toBeNull();
  });

  it("returns null when nothing is newer", () => {
    expect(
      updates.resolveRelease([release("v26.10.1", ALL)], {
        currentVersion: "26.10.1",
        ...win,
      }),
    ).toBeNull();
  });

  it("keeps stable installs off betas", () => {
    expect(
      updates.resolveRelease([release("v26.11.0-beta.1", ALL)], {
        currentVersion: "26.10.1",
        ...win,
      }),
    ).toBeNull();
  });

  it("moves a beta install to the next beta, then to stable", () => {
    expect(
      updates.resolveRelease(
        [release("v26.11.0-beta.1", ALL), release("v26.11.0-beta.2", ALL)],
        { currentVersion: "26.11.0-beta.1", ...win },
      ),
    ).toMatchObject({ tag: "v26.11.0-beta.2", channel: "beta" });
    expect(
      updates.resolveRelease(
        [release("v26.11.0-beta.2", ALL), release("v26.11.0", ALL)],
        { currentVersion: "26.11.0-beta.2", ...win },
      ),
    ).toMatchObject({ tag: "v26.11.0", channel: "latest" });
  });

  it("waits while the newest release is still uploading", () => {
    expect(
      updates.resolveRelease(
        [release("v26.10.2", ALL), release("v26.10.3", ["termix.exe"])],
        { currentVersion: "26.10.1", ...win },
      ),
    ).toBeNull();
  });

  it("needs this platform's channel file", () => {
    const releases = [release("v26.10.2", ["latest.yml", "latest-mac.yml"])];
    expect(
      updates.resolveRelease(releases, {
        currentVersion: "26.10.1",
        platform: "linux",
        arch: "x64",
      }),
    ).toBeNull();
    expect(
      updates.resolveRelease(releases, {
        currentVersion: "26.10.1",
        platform: "darwin",
        arch: "arm64",
      }),
    ).not.toBeNull();
  });

  it("handles junk input", () => {
    expect(
      updates.resolveRelease(null, { currentVersion: "26.10.1", ...win }),
    ).toBeNull();
    expect(
      updates.resolveRelease([release("v26.10.2", ALL)], {
        currentVersion: "dev",
        ...win,
      }),
    ).toBeNull();
  });
});

describe("getInstallKind", () => {
  const base = {
    platform: "win32",
    arch: "x64",
    isPackaged: true,
    mas: false,
    env: {},
    execPath: path.join("C:", "Program Files", "Termix", "Termix.exe"),
    resourcesPath: "/opt/Termix/resources",
    exists: () => false,
    readFile: () => {
      throw new Error("missing");
    },
  };

  it("disables dev builds and leaves the App Store alone", () => {
    expect(updates.getInstallKind({ ...base, isPackaged: false })).toBe(
      "disabled",
    );
    expect(
      updates.getInstallKind({ ...base, platform: "darwin", mas: true }),
    ).toBe("store");
  });

  it("updates NSIS installs and only links MSI, portable and 32-bit", () => {
    const uninstaller = path.join(
      path.dirname(base.execPath),
      "Uninstall Termix.exe",
    );
    const nsis = (target: string) => target === uninstaller;
    expect(updates.getInstallKind({ ...base, exists: nsis })).toBe("auto");
    expect(updates.getInstallKind(base)).toBe("manual");
    expect(
      updates.getInstallKind({ ...base, arch: "ia32", exists: nsis }),
    ).toBe("manual");
  });

  it("updates DMG installs unless run from the mounted image", () => {
    const mac = { ...base, platform: "darwin", arch: "arm64" };
    expect(
      updates.getInstallKind({
        ...mac,
        execPath: "/Applications/Termix.app/Contents/MacOS/Termix",
      }),
    ).toBe("auto");
    expect(
      updates.getInstallKind({
        ...mac,
        execPath: "/Volumes/Termix/Termix.app/Contents/MacOS/Termix",
      }),
    ).toBe("manual");
  });

  it("tells Linux installs apart", () => {
    const linux = { ...base, platform: "linux" };
    expect(updates.getInstallKind({ ...linux, env: { FLATPAK_ID: "x" } })).toBe(
      "manual",
    );
    expect(
      updates.getInstallKind({
        ...linux,
        exists: (target: string) => target === "/.flatpak-info",
      }),
    ).toBe("manual");
    expect(
      updates.getInstallKind({ ...linux, env: { APPIMAGE: "/tmp/a" } }),
    ).toBe("auto");
    const dpkgOwned = (target: string) =>
      target === "/var/lib/dpkg/info/termix.list";
    expect(
      updates.getInstallKind({
        ...linux,
        exists: dpkgOwned,
        readFile: () => "deb\n",
      }),
    ).toBe("auto");
    // The AUR package ships the deb's files without dpkg.
    expect(updates.getInstallKind({ ...linux, readFile: () => "deb\n" })).toBe(
      "manual",
    );
    expect(updates.getInstallKind(linux)).toBe("manual");
  });
});

describe("createUpdater", () => {
  afterEach(() => vi.useRealTimers());

  function fakeAutoUpdater() {
    const emitter = new EventEmitter() as EventEmitter &
      Record<string, unknown>;
    emitter.setFeedURL = vi.fn();
    emitter.checkForUpdates = vi.fn(async () => {
      emitter.emit("update-available", { version: "26.10.2" });
    });
    emitter.downloadUpdate = vi.fn(async () => {
      emitter.emit("update-downloaded", { version: "26.10.2" });
    });
    emitter.quitAndInstall = vi.fn();
    return emitter;
  }

  function setup(kind = "auto", mode = "prompt") {
    const auto = fakeAutoUpdater();
    const saved: string[] = [];
    const sent: Array<Record<string, unknown>> = [];
    const beforeInstall = vi.fn();
    const updater = updates.createUpdater({
      currentVersion: "26.10.1",
      ...win,
      kind,
      getMode: () => mode,
      saveMode: (next: string) => saved.push(next),
      fetchReleases: async () => [release("v26.10.2", ALL)],
      loadAutoUpdater: () => auto,
      send: (state: Record<string, unknown>) => sent.push(state),
      log: () => {},
      beforeInstall,
    });
    return { auto, updater, saved, sent, beforeInstall };
  }

  it("asks before downloading in prompt mode", async () => {
    const { auto, updater } = setup();
    const state = await updater.check();
    expect(auto.setFeedURL).toHaveBeenCalledWith({
      provider: "generic",
      url: "https://github.com/Termix-SSH/Termix/releases/download/v26.10.2",
    });
    expect(auto.autoDownload).toBe(false);
    expect(auto.allowDowngrade).toBe(false);
    expect(state).toMatchObject({ status: "available", version: "26.10.2" });

    expect((await updater.download()).status).toBe("downloaded");
    expect(updater.install()).toBe(true);
  });

  it("downloads on its own in automatic mode", async () => {
    const { auto, updater } = setup("auto", "automatic");
    await updater.check();
    expect(auto.autoDownload).toBe(true);
    expect(updater.getState().status).toBe("downloading");
  });

  it("marks the quit before installing so the tray lets go", async () => {
    vi.useFakeTimers();
    const { auto, updater, beforeInstall } = setup();
    await updater.check();
    await updater.download();
    updater.install();
    expect(beforeInstall).toHaveBeenCalled();
    vi.runAllTimers();
    expect(auto.quitAndInstall).toHaveBeenCalled();
  });

  it("only links the release for installs that can not update", async () => {
    const { auto, updater } = setup("manual");
    const state = await updater.check();
    expect(auto.setFeedURL).not.toHaveBeenCalled();
    expect(state).toMatchObject({
      status: "available",
      releaseUrl: "https://github.com/Termix-SSH/Termix/releases/tag/v26.10.2",
    });
    expect(updater.install()).toBe(false);
  });

  it("does nothing for store and dev builds", async () => {
    for (const kind of ["store", "disabled"]) {
      const { auto, updater } = setup(kind);
      expect((await updater.check()).status).toBe("idle");
      expect(auto.setFeedURL).not.toHaveBeenCalled();
    }
  });

  it("saves valid modes only and falls back to prompt", () => {
    const { updater, saved } = setup("auto", "bogus");
    expect(updater.getState().mode).toBe("prompt");
    updater.setMode("never");
    updater.setMode("sometimes");
    expect(saved).toEqual(["never"]);
    expect(updater.getState().mode).toBe("never");
  });

  it("reports a failed lookup instead of throwing", async () => {
    const updater = updates.createUpdater({
      currentVersion: "26.10.1",
      ...win,
      kind: "auto",
      getMode: () => "prompt",
      saveMode: () => {},
      fetchReleases: async () => {
        throw new Error("offline");
      },
      loadAutoUpdater: () => fakeAutoUpdater(),
      send: () => {},
      log: () => {},
    });
    expect(await updater.check()).toMatchObject({
      status: "error",
      error: "offline",
    });
  });
});
