/** Whether a request goes to this app's own backend on loopback. */
function isLocalBackendUrl(url, port) {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "http:" &&
      (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") &&
      parsed.port === String(port)
    );
  } catch {
    return false;
  }
}

module.exports = { isLocalBackendUrl };
