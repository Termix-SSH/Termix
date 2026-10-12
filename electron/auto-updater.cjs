// Desktop self updates. The release is picked from the GitHub releases list
// instead of electron-updater's GitHub provider, because the repo also holds
// SDK and 2.9.x releases, and a new release exists a while before its files
// finish uploading. The channel file is uploaded last, so a release counts
// only once it has one for this platform.

const path = require("path");

const REPO = "Termix-SSH/Termix";
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases?per_page=30`;
const DOWNLOAD_BASE = `https://github.com/${REPO}/releases/download/`;
const MODES = ["automatic", "prompt", "never"];
const DEFAULT_MODE = "prompt";
const FIRST_CHECK_DELAY = 30 * 1000;
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/;

function parseVersion(value) {
  const match = VERSION.exec(String(value || "").trim());
  if (!match) return null;
  return {
    parts: match.slice(1, 4).map(Number),
    beta: match[4] == null ? null : Number(match[4]),
  };
}

// A beta sorts before the release it leads up to.
function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a.parts[i] !== b.parts[i]) return a.parts[i] - b.parts[i];
  }
  if (a.beta === b.beta) return 0;
  if (a.beta == null) return 1;
  if (b.beta == null) return -1;
  return a.beta - b.beta;
}

// Matches the names electron-builder writes and electron-updater reads.
function channelFile(channel, platform, arch) {
  if (platform === "win32") return `${channel}.yml`;
  if (platform === "darwin") return `${channel}-mac.yml`;
  return `${channel}-linux${arch === "x64" ? "" : `-${arch}`}.yml`;
}

/**
 * The newest release this install should move to, or null. Stable installs
 * only see stable releases; a beta install also sees newer betas.
 */
function resolveRelease(releases, { currentVersion, platform, arch }) {
  const current = parseVersion(currentVersion);
  if (!current || !Array.isArray(releases)) return null;
  const allowBeta = current.beta != null;

  const newest = releases
    .filter((release) => release && !release.draft)
    .map((release) => ({ release, version: parseVersion(release.tag_name) }))
    .filter(
      ({ release, version }) =>
        version &&
        release.tag_name.startsWith("v") &&
        (allowBeta || version.beta == null) &&
        compareVersions(version, current) > 0,
    )
    .sort((a, b) => compareVersions(b.version, a.version))[0];
  if (!newest) return null;

  const { release, version } = newest;
  const channel = version.beta == null ? "latest" : "beta";
  const file = channelFile(channel, platform, arch);
  const assets = Array.isArray(release.assets) ? release.assets : [];
  if (!assets.some((asset) => asset && asset.name === file)) return null;

  return {
    tag: release.tag_name,
    version: release.tag_name.slice(1),
    channel,
    feedUrl: `${DOWNLOAD_BASE}${release.tag_name}`,
    releaseUrl:
      release.html_url ||
      `https://github.com/${REPO}/releases/tag/${release.tag_name}`,
  };
}

/**
 * How this copy of the app was installed, which decides whether it can
 * replace itself:
 * - auto: NSIS, DMG, AppImage or deb, updated in place
 * - manual: MSI, Chocolatey, Flatpak, portable builds and 32-bit Windows, told where to download
 * - store: Mac App Store
 * - disabled: dev builds
 */
function getInstallKind({
  platform,
  arch,
  isPackaged,
  mas,
  env,
  execPath,
  resourcesPath,
  exists,
  readFile,
}) {
  if (!isPackaged) return "disabled";
  if (mas) return "store";

  if (platform === "linux") {
    if (env.FLATPAK_ID || exists("/.flatpak-info")) return "manual";
    if (env.APPIMAGE) return "auto";
    try {
      const type = readFile(path.join(resourcesPath, "package-type")).trim();
      // The AUR package reuses the deb's files, so ask dpkg if it owns us.
      if (type === "deb" && exists("/var/lib/dpkg/info/termix.list")) {
        return "auto";
      }
    } catch {
      // Not a package install.
    }
    return "manual";
  }

  if (platform === "win32") {
    if (arch !== "x64") return "manual";
    const uninstaller = path.join(
      path.dirname(execPath),
      "Uninstall Termix.exe",
    );
    return exists(uninstaller) ? "auto" : "manual";
  }

  if (platform === "darwin") {
    // Still running from the mounted DMG.
    return execPath.startsWith("/Volumes/") ? "manual" : "auto";
  }

  return "manual";
}

function normalizeMode(mode) {
  return MODES.includes(mode) ? mode : DEFAULT_MODE;
}

function createUpdater({
  currentVersion,
  platform,
  arch,
  kind,
  getMode,
  saveMode,
  fetchReleases,
  loadAutoUpdater,
  send,
  log,
  beforeInstall,
}) {
  const state = {
    kind,
    mode: normalizeMode(getMode()),
    currentVersion,
    status: "idle",
    version: null,
    releaseUrl: null,
    progress: null,
    error: null,
  };
  const enabled = kind === "auto" || kind === "manual";
  let updater = null;
  let timer = null;
  let checkedOnce = false;

  function update(patch) {
    Object.assign(state, patch);
    send({ ...state });
  }

  function getUpdater() {
    if (updater) return updater;
    updater = loadAutoUpdater();
    updater.logger = {
      info: (...args) => log("[updater]", ...args),
      warn: (...args) => log("[updater]", ...args),
      error: (...args) => log("[updater]", ...args),
      debug: () => {},
    };
    updater.autoInstallOnAppQuit = true;
    updater.on("update-available", (info) =>
      update({
        status: updater.autoDownload ? "downloading" : "available",
        version: info.version,
        progress: null,
        error: null,
      }),
    );
    updater.on("update-not-available", () =>
      update({ status: "up-to-date", error: null }),
    );
    updater.on("download-progress", (progress) =>
      update({
        status: "downloading",
        progress: Math.round(progress.percent || 0),
      }),
    );
    updater.on("update-downloaded", (info) =>
      update({
        status: "downloaded",
        version: info.version,
        progress: 100,
        error: null,
      }),
    );
    updater.on("error", (error) => {
      log("[updater] error:", error?.message || String(error));
      update({ status: "error", error: error?.message || String(error) });
    });
    return updater;
  }

  async function check() {
    if (!enabled) return { ...state };
    if (["checking", "downloading", "downloaded"].includes(state.status)) {
      return { ...state };
    }
    checkedOnce = true;
    update({ status: "checking", error: null });

    let release;
    try {
      release = resolveRelease(await fetchReleases(), {
        currentVersion,
        platform,
        arch,
      });
    } catch (error) {
      log("[updater] release lookup failed:", error?.message || String(error));
      update({ status: "error", error: error?.message || String(error) });
      return { ...state };
    }

    if (!release) {
      update({ status: "up-to-date" });
      return { ...state };
    }

    update({ version: release.version, releaseUrl: release.releaseUrl });
    if (kind === "manual") {
      update({ status: "available" });
      return { ...state };
    }

    try {
      const auto = getUpdater();
      auto.setFeedURL({ provider: "generic", url: release.feedUrl });
      auto.channel = release.channel;
      auto.allowDowngrade = false;
      auto.autoDownload = state.mode === "automatic";
      await auto.checkForUpdates();
    } catch (error) {
      log("[updater] check failed:", error?.message || String(error));
      update({ status: "error", error: error?.message || String(error) });
    }
    return { ...state };
  }

  async function download() {
    if (kind !== "auto" || state.status !== "available") return { ...state };
    update({ status: "downloading", progress: 0 });
    try {
      await getUpdater().downloadUpdate();
    } catch (error) {
      log("[updater] download failed:", error?.message || String(error));
      update({ status: "error", error: error?.message || String(error) });
    }
    return { ...state };
  }

  function install() {
    if (kind !== "auto" || state.status !== "downloaded") return false;
    // The tray keeps windows alive on close, so mark the quit first.
    beforeInstall?.();
    setImmediate(() => getUpdater().quitAndInstall());
    return true;
  }

  function setMode(mode) {
    if (!MODES.includes(mode)) return { ...state };
    saveMode(mode);
    update({ mode });
    if (updater) updater.autoDownload = mode === "automatic";
    if (mode !== "never" && !checkedOnce) void check();
    return { ...state };
  }

  function start() {
    if (!enabled || timer) return;
    setTimeout(() => {
      if (state.mode !== "never") void check();
    }, FIRST_CHECK_DELAY).unref?.();
    timer = setInterval(() => {
      if (state.mode !== "never") void check();
    }, CHECK_INTERVAL);
    timer.unref?.();
  }

  return {
    getState: () => ({ ...state }),
    check,
    download,
    install,
    setMode,
    start,
  };
}

module.exports = {
  DEFAULT_MODE,
  RELEASES_API,
  channelFile,
  compareVersions,
  createUpdater,
  getInstallKind,
  normalizeMode,
  parseVersion,
  resolveRelease,
};
