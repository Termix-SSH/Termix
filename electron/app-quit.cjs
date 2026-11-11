function quitApp(app, window) {
  window?.destroy();
  app.quit();
}

/**
 * What closing the main window does: "close" lets it go, "hide" keeps the app
 * in the tray, "quit" quits the whole app.
 */
function closeAction({ isQuitting, hasTray, platform, env, closeToTray }) {
  if (isQuitting || !hasTray) return "close";
  // Stock GNOME has no tray to bring a hidden window back from, and its dock
  // Quit only closes windows, so closing quits there.
  if (platform === "linux" && /gnome/i.test(env?.XDG_CURRENT_DESKTOP || "")) {
    return "quit";
  }
  return closeToTray === false ? "quit" : "hide";
}

module.exports = { quitApp, closeAction };
