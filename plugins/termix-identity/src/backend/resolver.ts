import type { Request, Response } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { HANDLE_REGEX, asError } from "./handles.js";
import { matchesAlgoFilter } from "./keys.js";
import type { KeyRow, Store } from "./store.js";

/**
 * The resolver needs no login: servers fetch it from scripts. Paths are
 * relative to /plugin-api/termix-identity/.
 */
export const PUBLIC_PATHS = ["/u/:handle", "/u/:handle/:algo"];

/** The public resolver path for a handle, below the base URL. */
export function resolverPath(handle: string): string {
  return `/plugin-api/termix-identity/u/${handle}`;
}

// A disabled or removed key must not keep being served by a cache, and the
// feed stays out of search indexes. Set on every response, 404s included.
function setResolverHeaders(res: Response) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
}

function notFound(res: Response, body = "Not found\n") {
  return res.status(404).type("text/plain").send(body);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderHtml(
  handle: string,
  keys: Array<Pick<KeyRow, "algorithm" | "publicKey">>,
  resolverUrl: string,
): string {
  const keyRows = keys.length
    ? keys
        .map(
          (key) =>
            `<div class="key"><span class="algo">${escapeHtml(
              key.algorithm,
            )}</span><code>${escapeHtml(key.publicKey)}</code></div>`,
        )
        .join("")
    : `<p class="empty">No public keys published yet.</p>`;

  // A standalone page, not the React app, so the dark theme is inlined.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<meta name="color-scheme" content="dark" />
<title>Termix ID @${escapeHtml(handle)}</title>
<style>
  :root {
    --bg: #0c0d0b; --panel: #141614; --panel-2: #181a17; --border: rgba(255,255,255,.12);
    --fg: #f8f8f6; --muted: #8f9189; --accent: #f59145;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); line-height: 1.5;
         font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  .wrap { max-width: 820px; margin: 0 auto; padding: 32px 16px 48px; }
  .card { background: var(--panel); border: 1px solid var(--border); }
  header.card { padding: 16px 18px; display: flex; align-items: center; gap: 10px; }
  h1 { font-size: 1.05rem; font-weight: 700; margin: 0; letter-spacing: .02em; color: var(--fg); }
  h1 .handle { color: var(--accent); }
  .label { font-size: 10px; font-weight: 700; letter-spacing: .18em; text-transform: uppercase;
           color: var(--muted); margin: 22px 0 8px; }
  pre.cmd { margin: 0; background: var(--panel-2); border: 1px solid var(--border); color: var(--muted);
            padding: 12px 14px; overflow-x: auto; font-size: 12px;
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .keys { display: flex; flex-direction: column; gap: 8px; }
  .key { background: var(--panel); border: 1px solid var(--border); padding: 10px 12px;
         display: flex; align-items: center; gap: 10px; overflow-x: auto; }
  .algo { flex: 0 0 auto; font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
          color: var(--accent); border: 1px solid rgba(245,145,69,.4); padding: 1px 5px; line-height: 1.4; }
  code { white-space: pre; word-break: break-all; font-size: 12px; color: var(--muted);
         font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .empty { color: var(--muted); font-size: 13px; }
  footer { margin-top: 28px; color: var(--muted); font-size: 11px; letter-spacing: .04em; }
</style>
</head>
<body>
  <div class="wrap">
    <header class="card">
      <h1>Termix ID <span class="handle">@${escapeHtml(handle)}</span></h1>
    </header>

    <div class="label">Provision a server</div>
    <pre class="cmd">curl -fsSL ${escapeHtml(resolverUrl)} &gt;&gt; ~/.ssh/authorized_keys</pre>

    <div class="label">Published keys</div>
    <div class="keys">${keyRows}</div>

    <footer>Served by Termix</footer>
  </div>
</body>
</html>`;
}

export function createResolver(ctx: PluginContext, store: Store) {
  const handleOf = (req: Request) =>
    String(req.params.handle || "").toLowerCase();

  /** authorized_keys as text, or a small viewer for browsers. */
  async function keys(req: Request, res: Response) {
    setResolverHeaders(res);
    const handle = handleOf(req);
    if (!HANDLE_REGEX.test(handle)) return notFound(res);
    const algoFilter = req.params.algo
      ? String(req.params.algo).toUpperCase()
      : null;

    try {
      const identity = await store.identityByHandle(handle);
      if (!identity) return notFound(res);

      const published = (await store.enabledKeys(identity.id)).filter((key) =>
        matchesAlgoFilter(key.algorithm, algoFilter),
      );

      if ((req.headers.accept || "").includes("text/html")) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.send(
          renderHtml(
            handle,
            published,
            `${ctx.http.baseUrl(req)}${resolverPath(handle)}`,
          ),
        );
      }

      const body = published
        .map((key) => `${key.publicKey} #termix-id @${handle}`)
        .join("\n");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.send(body ? `${body}\n` : "");
    } catch (error) {
      ctx.log.error("Termix ID resolve failed", asError(error));
      return res.status(500).type("text/plain").send("Internal Server Error\n");
    }
  }

  /** The CA public key, for TrustedUserCAKeys or an @cert-authority line. */
  async function caKey(req: Request, res: Response) {
    setResolverHeaders(res);
    const handle = handleOf(req);
    if (!HANDLE_REGEX.test(handle)) return notFound(res);

    try {
      const identity = await store.identityByHandle(handle);
      if (!identity) return notFound(res);
      const ca = await store.caForIdentity(identity.id);
      if (!ca) return notFound(res, "No CA configured\n");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.send(`${ca.publicKey} termix-id-ca@${handle}\n`);
    } catch (error) {
      ctx.log.error("Termix ID CA resolve failed", asError(error));
      return res.status(500).type("text/plain").send("Internal Server Error\n");
    }
  }

  return { keys, caKey };
}
