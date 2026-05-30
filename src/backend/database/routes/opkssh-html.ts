import { sshLogger } from "../../utils/logger.js";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Replicates openpubkey's client/choosers/web_chooser.go IssuerToName().
// OPKSSH's /select handler keys its providerMap by this derived name, NOT by the
// `alias` field in config.yml. We need the same mapping so we can normalize any
// `op=` query param we receive (which can be alias, issuer with protocol, or
// issuer without protocol depending on client version) to what OPKSSH expects.
function opksshIssuerToName(issuer: string): string | null {
  if (!issuer) return null;
  const withScheme =
    issuer.startsWith("http://") || issuer.startsWith("https://")
      ? issuer
      : `https://${issuer}`;
  if (withScheme.startsWith("https://accounts.google.com")) return "google";
  if (withScheme.startsWith("https://login.microsoftonline.com"))
    return "azure";
  if (withScheme.startsWith("https://gitlab.com")) return "gitlab";
  if (withScheme.startsWith("https://issuer.hello.coop")) return "hello";
  if (withScheme.startsWith("https://")) {
    const host = withScheme.slice("https://".length).split("/")[0];
    return host || null;
  }
  return null;
}

export function normalizeSelectOpParam(
  rawOp: string,
  providers: Array<{ alias: string; issuer: string }>,
): string {
  if (!rawOp) return rawOp;
  const knownNames = new Set(
    providers
      .map((p) => opksshIssuerToName(p.issuer))
      .filter((n): n is string => typeof n === "string" && n.length > 0),
  );
  if (knownNames.has(rawOp)) return rawOp;

  const derivedFromRaw = opksshIssuerToName(rawOp);
  if (derivedFromRaw && knownNames.has(derivedFromRaw)) return derivedFromRaw;

  const matchByAlias = providers.find((p) => p.alias === rawOp);
  if (matchByAlias) {
    const name = opksshIssuerToName(matchByAlias.issuer);
    if (name) return name;
  }

  return rawOp;
}

type OpksshErrorPageOptions = {
  title: string;
  heading: string;
  message: string;
  details?: string;
  requestId?: string;
  statusCode?: number;
};

export function renderOpksshErrorPage(opts: OpksshErrorPageOptions): string {
  const title = escapeHtml(opts.title);
  const heading = escapeHtml(opts.heading);
  const message = escapeHtml(opts.message);
  const detailsBlock = opts.details
    ? `<pre class="details">${escapeHtml(opts.details)}</pre>`
    : "";
  const requestIdBlock = opts.requestId
    ? `<p class="request-id">Request ID: ${escapeHtml(opts.requestId)}</p>`
    : "";

  return `<!DOCTYPE html>
<html>
<head>
  <title>${title}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: #18181b;
      color: #fafafa;
      padding: 1rem;
    }
    .container {
      text-align: center;
      background: #27272a;
      padding: 3rem 2rem;
      border-radius: 0.625rem;
      border: 1px solid rgba(255, 255, 255, 0.1);
      max-width: 720px;
      width: 100%;
    }
    h1 {
      color: #fafafa;
      font-size: 1.5rem;
      font-weight: 600;
      margin-bottom: 0.75rem;
    }
    p {
      color: #9ca3af;
      font-size: 0.95rem;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
    }
    p + p { margin-top: 0.5rem; }
    .details {
      color: #d4d4d8;
      text-align: left;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.8rem;
      line-height: 1.45;
      margin-top: 1.25rem;
      padding: 0.875rem 1rem;
      background: #0f0f11;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 0.5rem;
      white-space: pre-wrap;
      word-break: break-word;
      overflow-x: auto;
    }
    .request-id {
      color: #6b7280;
      font-size: 0.75rem;
      margin-top: 1rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>${heading}</h1>
    <p>${message}</p>
    ${detailsBlock}
    ${requestIdBlock}
  </div>
</body>
</html>`;
}

export function rewriteOPKSSHHtml(
  html: string,
  requestId: string,
  routePrefix: "opkssh-chooser" | "opkssh-callback",
): string {
  const basePath = `/host/${routePrefix}/${requestId}`;
  const localHostPattern = "(?:localhost|127\\.0\\.0\\.1)";

  const attrPatterns = ["action", "href", "src", "formaction"];
  for (const attr of attrPatterns) {
    html = html.replace(
      new RegExp(`${attr}="(/[^"]*)`, "g"),
      `${attr}="${basePath}$1`,
    );
    html = html.replace(
      new RegExp(`${attr}='(/[^']*)`, "g"),
      `${attr}='${basePath}$1`,
    );
  }

  for (const attr of ["href", "action", "src", "formaction"]) {
    html = html.replace(
      new RegExp(
        `${attr}=["']?http:\\/\\/${localHostPattern}:\\d+\\/([^"'\\s]*)`,
        "g",
      ),
      `${attr}="${basePath}/$1`,
    );
  }

  html = html.replace(
    new RegExp(
      `(window\\.location\\.href\\s*=\\s*["'])http:\\/\\/${localHostPattern}:\\d+\\/([^"']*)(["'])`,
      "g",
    ),
    `$1${basePath}/$2$3`,
  );
  html = html.replace(
    new RegExp(
      `(window\\.location\\s*=\\s*["'])http:\\/\\/${localHostPattern}:\\d+\\/([^"']*)(["'])`,
      "g",
    ),
    `$1${basePath}/$2$3`,
  );
  html = html.replace(
    new RegExp(
      `(fetch\\(["'])http:\\/\\/${localHostPattern}:\\d+\\/([^"']*)(["'])`,
      "g",
    ),
    `$1${basePath}/$2$3`,
  );

  html = html.replace(
    new RegExp(
      `(location\\.assign\\(["'])http:\\/\\/${localHostPattern}:\\d+\\/([^"']*)(["']\\))`,
      "g",
    ),
    `$1${basePath}/$2$3`,
  );
  html = html.replace(
    new RegExp(
      `(location\\.replace\\(["'])http:\\/\\/${localHostPattern}:\\d+\\/([^"']*)(["']\\))`,
      "g",
    ),
    `$1${basePath}/$2$3`,
  );

  // XMLHttpRequest.open("GET", "http://localhost:PORT/path", ...)
  html = html.replace(
    new RegExp(
      `(\\.open\\(["']\\w+["']\\s*,\\s*["'])http:\\/\\/${localHostPattern}:\\d+\\/([^"']*)(["'])`,
      "g",
    ),
    `$1${basePath}/$2$3`,
  );

  html = html.replace(
    new RegExp(
      `(<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^;]+;\\s*url=)http:\\/\\/${localHostPattern}:\\d+\\/([^"']+)(["'][^>]*>)`,
      "gi",
    ),
    `$1${basePath}/$2$3`,
  );

  html = html.replace(
    new RegExp(
      `(data-[\\w-]+=["'])http:\\/\\/${localHostPattern}:\\d+\\/([^"']*)(["'])`,
      "g",
    ),
    `$1${basePath}/$2$3`,
  );

  const baseTag = `<base href="${basePath}/">`;

  if (html.includes("<base")) {
    sshLogger.info("Replacing existing base tag", {
      operation: "opkssh_html_rewrite_base_tag",
      requestId,
      basePath,
    });
    html = html.replace(/<base[^>]*>/i, baseTag);
  } else if (html.includes("<head>")) {
    sshLogger.info("Inserting base tag into head", {
      operation: "opkssh_html_rewrite_base_tag_insert",
      requestId,
      basePath,
    });
    html = html.replace(/<head>/i, `<head>${baseTag}`);
  } else {
    sshLogger.warn("No <head> tag found, wrapping HTML", {
      operation: "opkssh_html_rewrite_no_head",
      requestId,
      htmlLength: html.length,
      htmlPreview: html.substring(0, 200),
    });
    html = `<!DOCTYPE html><html><head>${baseTag}</head><body>${html}</body></html>`;
  }

  sshLogger.info("HTML rewrite complete", {
    operation: "opkssh_html_rewrite_complete",
    requestId,
    routePrefix,
    hasBaseTag: html.includes("<base href="),
    staticAssetCount: (html.match(/\/static\//g) || []).length,
  });

  return html;
}
