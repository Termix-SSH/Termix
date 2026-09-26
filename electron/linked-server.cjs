// The server this desktop is linked to, as the embedded backend reports it.
// The backend owns the link (and its secrets); main only keeps what it needs
// to reach that one origin: the proxy headers and basic auth a reverse proxy
// in front of it wants, whether its certificate may be self-signed, and the
// session for requests main makes itself (C2S tunnels).

let linked = null;

function getOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function setLinkedServer(config) {
  if (!config || !config.origin) {
    linked = null;
    return;
  }
  linked = {
    origin: config.origin,
    serverUrl: config.serverUrl || config.origin,
    token: config.token || null,
    headers: Array.isArray(config.headers) ? config.headers : [],
    basicAuth:
      config.basicAuth && config.basicAuth.username ? config.basicAuth : null,
    allowInvalidCertificate: !!config.allowInvalidCertificate,
  };
}

function getLinkedServer() {
  return linked;
}

function isLinkedOrigin(url) {
  return !!linked && getOrigin(url) === linked.origin;
}

function basicAuthValue(basicAuth) {
  return `Basic ${Buffer.from(
    `${basicAuth.username}:${basicAuth.password || ""}`,
  ).toString("base64")}`;
}

// Adds the link's proxy headers to a request bound for the linked origin.
// With basic auth in front, Authorization belongs to the proxy, so a Termix
// bearer token moves into the jwt cookie, which Termix reads first.
function applyLinkHeaders(url, headers) {
  if (!isLinkedOrigin(url)) return headers;
  const out = { ...headers };
  for (const header of linked.headers) {
    if (header && header.name && header.value) out[header.name] = header.value;
  }
  if (linked.basicAuth) {
    const authKey = Object.keys(out).find(
      (key) => key.toLowerCase() === "authorization",
    );
    const current = authKey ? String(out[authKey]) : "";
    if (authKey) delete out[authKey];
    const bearer = current.match(/^Bearer\s+(.+)$/i);
    if (bearer) {
      const cookieKey =
        Object.keys(out).find((key) => key.toLowerCase() === "cookie") ||
        "Cookie";
      const existing = out[cookieKey] ? `${out[cookieKey]}; ` : "";
      out[cookieKey] = `${existing}jwt=${bearer[1]}`;
    }
    out.Authorization = basicAuthValue(linked.basicAuth);
  }
  return out;
}

// Headers for a request main itself makes to the linked server.
function linkedRequestHeaders(extra = {}) {
  if (!linked) return { ...extra };
  const base = { "X-Electron-App": "true", ...extra };
  if (linked.token) base.Authorization = `Bearer ${linked.token}`;
  return applyLinkHeaders(linked.origin, base);
}

// Answers a basic auth challenge from the linked origin's proxy.
function answerLogin(authInfo, url) {
  if (!linked || !linked.basicAuth) return null;
  if (authInfo && authInfo.isProxy) return null;
  if (!isLinkedOrigin(url)) return null;
  return linked.basicAuth;
}

module.exports = {
  setLinkedServer,
  getLinkedServer,
  isLinkedOrigin,
  applyLinkHeaders,
  linkedRequestHeaders,
  answerLogin,
};
