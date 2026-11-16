/**
 * The scale factor to force on Linux, or null to follow the system.
 *
 * KDE on Wayland with fractional scaling put clicks in the wrong place
 * (https://github.com/brave/brave-browser/issues/50028), so it gets 1 there.
 * Forcing it everywhere made the app tiny on HiDPI screens.
 * TERMIX_FORCE_DEVICE_SCALE_FACTOR sets it by hand, "0" turns it off.
 */
function forcedScaleFactor(env = process.env) {
  const manual = (env.TERMIX_FORCE_DEVICE_SCALE_FACTOR || "").trim();
  if (manual) {
    const value = Number(manual);
    if (!Number.isFinite(value) || value <= 0 || value > 8) return null;
    return String(value);
  }
  const desktop = (env.XDG_CURRENT_DESKTOP || "").toUpperCase();
  const wayland =
    (env.XDG_SESSION_TYPE || "").toLowerCase() === "wayland" ||
    !!env.WAYLAND_DISPLAY;
  return wayland && desktop.split(":").includes("KDE") ? "1" : null;
}

module.exports = { forcedScaleFactor };
