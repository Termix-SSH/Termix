// Which responses may lose frame-ancestors and X-Frame-Options. The app shell
// is app://termix, so a Termix server page it frames (the local backend, the
// linked server, or a server's login page while linking one) would refuse
// to load. Plugin frame pages already allow app://termix and keep their CSP
// as sent, the same as on the server, and pages from other sites keep
// theirs too.

const APP_ORIGINS = ["app://termix"];
const DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];
const PLUGIN_FRAME = /^\/plugin-assets\/[^/]+\/_frame(\/|$)/;

function headerValues(headers, name) {
  const out = [];
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() !== name) continue;
    out.push(...(Array.isArray(value) ? value : [value]).map(String));
  }
  return out;
}

/** The Termix app shell sends both of these on every page. */
function looksLikeTermixShell(headers) {
  const csp = headerValues(headers, "content-security-policy").join(";");
  const xfo = headerValues(headers, "x-frame-options").join(",");
  return /frame-ancestors\s+'none'/i.test(csp) && /\bdeny\b/i.test(xfo);
}

/**
 * True when the response's frame headers should be relaxed.
 * opts.serverOrigins: origins of the local backend and the linked server.
 * opts.dev: the dev server may hold the app shell.
 */
function shouldRelax(details, opts = {}) {
  if (details.resourceType !== "subFrame") return false;
  let url;
  try {
    url = new URL(details.url);
  } catch {
    return false;
  }
  if (PLUGIN_FRAME.test(url.pathname)) return false;
  const top = details.frame?.top?.url;
  if (top) {
    // app:// is not a special scheme, so URL gives it no origin; compare text.
    const shells = opts.dev ? [...APP_ORIGINS, ...DEV_ORIGINS] : APP_ORIGINS;
    if (!shells.some((shell) => top === shell || top.startsWith(`${shell}/`))) {
      return false;
    }
  }
  const origins = opts.serverOrigins ?? [];
  return (
    origins.includes(url.origin) ||
    looksLikeTermixShell(details.responseHeaders)
  );
}

/** Drops frame-ancestors and X-Frame-Options in place. */
function relaxFrameHeaders(headers) {
  for (const key of Object.keys(headers)) {
    const lower = key.toLowerCase();
    if (lower === "x-frame-options") {
      delete headers[key];
    } else if (lower === "content-security-policy") {
      const values = (
        Array.isArray(headers[key]) ? headers[key] : [headers[key]]
      )
        .map((value) => String(value).replace(/frame-ancestors[^;]*;?/gi, ""))
        .map((value) => value.replace(/\s{2,}/g, " ").trim())
        .filter((value) => value.length > 0);
      if (values.length === 0) delete headers[key];
      else headers[key] = values;
    }
  }
  return headers;
}

module.exports = { shouldRelax, relaxFrameHeaders, looksLikeTermixShell };
