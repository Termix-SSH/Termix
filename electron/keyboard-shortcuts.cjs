/**
 * The app menu on Windows and Linux. It is hidden, but its keys still work.
 * Electron's default one closes the window on Ctrl+W, so this one has no
 * Close: Ctrl+W goes to the page, where a terminal can use it and the shell
 * closes the tab otherwise.
 */
function windowsLinuxMenuTemplate() {
  return [
    { label: "File", submenu: [{ role: "quit" }] },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "delete" },
        { type: "separator" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { label: "Window", submenu: [{ role: "minimize" }] },
  ];
}

module.exports = { windowsLinuxMenuTemplate };
