/**
 * The login URL a server hands the desktop app goes to shell.openExternal,
 * so only web pages pass: any other scheme (file:, smb:, ms-msdt:, ...)
 * would launch whatever OS handler is registered for it.
 */
function isExternalLoginUrl(value) {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/** A non-privileged port for the loopback callback listener. */
function isCallbackPort(value) {
  return Number.isInteger(value) && value >= 1024 && value <= 65535;
}

module.exports = { isExternalLoginUrl, isCallbackPort };
