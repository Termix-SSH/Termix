// Opens a local file in the external editor the person picked in a file
// dialog (saved as a desktop setting), or with its default app. Electron main
// starts the editor, so a fenced plugin process never starts programs itself.

const path = require("path");

// Files the system would run rather than open, refused without an editor.
const LAUNCHABLE = new Set([
  "application",
  "appref-ms",
  "bat",
  "chm",
  "cmd",
  "com",
  "cpl",
  "exe",
  "gadget",
  "hta",
  "inf",
  "jar",
  "js",
  "jse",
  "library-ms",
  "lnk",
  "msc",
  "msi",
  "msp",
  "mst",
  "pif",
  "ps1",
  "psd1",
  "psm1",
  "py",
  "pyw",
  "reg",
  "scf",
  "scr",
  "search-ms",
  "settingcontent-ms",
  "url",
  "vbe",
  "vbs",
  "ws",
  "wsf",
  "wsh",
  "xll",
  "app",
  "command",
  "pkg",
  "terminal",
  "tool",
  "workflow",
  "appimage",
  "desktop",
  "run",
  "sh",
]);

function isLaunchable(filePath) {
  // Windows drops trailing dots and spaces, so "a.exe. " is a.exe.
  const name = path.basename(String(filePath)).replace(/[. ]+$/, "");
  return LAUNCHABLE.has(path.extname(name).slice(1).toLowerCase());
}

/**
 * deps: editorPath() gives the saved editor or null, openPath is
 * shell.openPath (resolves to an error text or ""), spawn is for tests.
 */
async function openInEditor(filePath, deps) {
  const spawn = deps.spawn ?? require("child_process").spawn;
  const editor = deps.editorPath();
  if (!editor) {
    if (isLaunchable(filePath)) {
      return {
        success: false,
        error: "Choose an external editor to open this file type",
      };
    }
    const error = await deps.openPath(filePath);
    return error ? { success: false, error } : { success: true };
  }
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(editor, [filePath], {
        detached: true,
        stdio: "ignore",
      });
    } catch (error) {
      resolve({ success: false, error: error.message });
      return;
    }
    child.once("error", (error) =>
      resolve({ success: false, error: error.message }),
    );
    child.once("spawn", () => {
      child.unref();
      resolve({ success: true });
    });
  });
}

module.exports = { openInEditor, isLaunchable };
