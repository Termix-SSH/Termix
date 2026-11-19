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

/**
 * Shows the first close to tray notice. It only counts as seen once the
 * system says it appeared, so one hidden by Do Not Disturb shows next time.
 * Windows uses the tray balloon, which works without a Start menu shortcut,
 * so the portable build shows it too.
 */
function showTrayNotice({ platform, tray, Notification, text, onShown }) {
  if (!text) return false;
  if (platform === "win32" && tray && !tray.isDestroyed()) {
    tray.removeListener("balloon-show", onShown);
    tray.once("balloon-show", onShown);
    tray.displayBalloon({
      title: text.title,
      content: text.body,
      iconType: "info",
      noSound: true,
    });
    return true;
  }
  if (!Notification.isSupported()) return false;
  const notice = new Notification({ ...text, silent: true });
  notice.once("show", onShown);
  notice.show();
  return true;
}

module.exports = { quitApp, closeAction, showTrayNotice };
