// Chromium derives safeStorage's backend from the running desktop and falls back
// to the "basic_text" store for anything it has no mapping for, which is every
// wlroots-style compositor (Hyprland, sway, niri, river, ...).
// safeStorage.isEncryptionAvailable() reports false for that store, so every
// credential the desktop app persists through it -- the remote sync JWT, the
// Electron auth cookie -- is refused at the point of writing. The refusal is
// invisible from the outside: the user signs in, nothing is stored, and the next
// sync tick reports the session as expired rather than as never saved.
//
// Those desktops still run an ordinary Secret Service (gnome-keyring, KWallet's
// compatibility service, KeePassXC, ...), so naming the libsecret backend is
// enough to make encryption available again. Desktops whose auto-detection
// already resolves to KWallet keep it, and an explicit --password-store from the
// user always wins.
//
// Moving a machine off "basic_text" cannot orphan stored secrets: nothing was
// ever written there, because isEncryptionAvailable() gated every write.
const KWALLET_DESKTOPS = /\b(kde|plasma|lxqt)\b/i;
const LIBSECRET_STORE = "gnome-libsecret";

/**
 * Picks safeStorage's backend on Linux, and returns the store it selected (or
 * null when auto-detection was left to decide).
 *
 * Must run before the app is ready: Chromium reads the switch when the store is
 * first opened, and appending it afterwards has no effect.
 */
function selectLinuxPasswordStore(commandLine, env) {
  if (commandLine.hasSwitch("password-store")) {
    return null;
  }

  const desktop = `${env.XDG_CURRENT_DESKTOP || ""}:${env.DESKTOP_SESSION || ""}`;
  if (KWALLET_DESKTOPS.test(desktop)) {
    return null;
  }

  commandLine.appendSwitch("password-store", LIBSECRET_STORE);
  return LIBSECRET_STORE;
}

module.exports = { selectLinuxPasswordStore };
