const { Agent, fetch: undiciFetch } = require("undici");

function createRemoteSyncFetch(getConfig) {
  let invalidCertificateAgent;
  return function fetchRemoteSync(url, options = {}) {
    const config = getConfig();
    const target = new URL(url);
    const allowInvalidCertificate =
      config?.allowInvalidCertificate === true &&
      config.serverUrl &&
      target.protocol === "https:" &&
      target.origin === new URL(config.serverUrl).origin;
    if (!allowInvalidCertificate) return fetch(url, options);

    invalidCertificateAgent ??= new Agent({
      connect: { rejectUnauthorized: false },
    });
    return undiciFetch(url, {
      ...options,
      dispatcher: invalidCertificateAgent,
      // A redirected request must not inherit the configured origin's TLS exception.
      redirect: "error",
    });
  };
}

module.exports = { createRemoteSyncFetch };
