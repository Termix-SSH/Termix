// Builds before 26.11.2 loaded the UI from file://, so what the page saved
// in localStorage sits under that origin. This copies it to app://termix
// once, before the main window opens. The old values are read from the
// storage files on disk, since no page may open file:// storage with the
// file protocol fuse off. Nothing here runs page code or opens an IPC channel.

const { readOriginStorage } = require("./local-storage-read.cjs");

const FILE_ORIGIN = "file://";

function writeScript(entries) {
  return `(() => {
    const entries = ${JSON.stringify(entries)};
    let copied = 0;
    for (const [key, value] of entries) {
      if (localStorage.getItem(key) === null) {
        localStorage.setItem(key, value);
        copied++;
      }
    }
    return copied;
  })()`;
}

function cleanEntries(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(
    (entry) =>
      Array.isArray(entry) &&
      entry.length === 2 &&
      typeof entry[0] === "string" &&
      typeof entry[1] === "string",
  );
}

async function withHiddenWindow(BrowserWindow, partition, load, run) {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      partition,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      javascript: true,
      disableBlinkFeatures: "Auxclick",
    },
  });
  try {
    await load(win);
    return await win.webContents.executeJavaScript(run, true);
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

/**
 * Copies file:// localStorage into the app origin. Keys the app origin
 * already has win. Returns how many keys were copied, or null when it had
 * already run.
 */
async function migrateFileStorage({
  BrowserWindow,
  partition,
  markerPath,
  storageDir,
  appBlankUrl,
  fs,
  path,
  readStorage = readOriginStorage,
  log = () => {},
}) {
  if (fs.existsSync(markerPath)) return null;
  let copied = 0;
  try {
    const entries = cleanEntries(
      readStorage({ dir: storageDir, origin: FILE_ORIGIN, fs, path, log }),
    );
    if (entries.length) {
      copied = await withHiddenWindow(
        BrowserWindow,
        partition,
        (win) => win.loadURL(appBlankUrl),
        writeScript(entries),
      );
    }
    log(`Moved ${copied} saved settings to the app origin`);
  } catch (error) {
    // Losing saved view state is better than not starting; try again next time.
    log("Could not move saved settings:", error?.message || String(error));
    return 0;
  }
  try {
    fs.writeFileSync(
      markerPath,
      JSON.stringify({ migratedAt: new Date().toISOString(), copied }),
    );
  } catch {
    // Runs again next start, which copies nothing new.
  }
  return copied;
}

module.exports = { migrateFileStorage, cleanEntries, writeScript };
