const path = require("path");

// Saved by the file manager after the user picks an editor in a file dialog.
const EXTERNAL_EDITOR_SETTING = "fileManager.externalEditorPath";

// Extensions the OS would run rather than open in an editor. With no editor
// configured the temp copy goes to shell.openPath, and its name comes from
// the remote server.
const LAUNCHABLE_EXTENSIONS = new Set([
  // Windows
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
  // macOS
  "app",
  "command",
  "pkg",
  "terminal",
  "tool",
  "workflow",
  // Linux
  "appimage",
  "desktop",
  "run",
  "sh",
]);

function isLaunchableFileName(fileName) {
  // Windows drops trailing dots and spaces, so "a.exe. " is saved as a.exe.
  const name = path.basename(String(fileName || "")).replace(/[. ]+$/, "");
  const extension = path.extname(name).slice(1).toLowerCase();
  return LAUNCHABLE_EXTENSIONS.has(extension);
}

module.exports = { EXTERNAL_EDITOR_SETTING, isLaunchableFileName };
