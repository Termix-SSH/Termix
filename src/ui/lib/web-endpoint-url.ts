import type { WebEndpoint } from "@/types/index";

/**
 * Builds the URL a web endpoint opens at.
 *
 * Direct access points at the host's own address. Tunnel access points at a
 * port the backend has forwarded to the endpoint's port on the host -- so the
 * endpoint's own port is deliberately absent from a tunnel URL.
 *
 * Expects an endpoint whose `path` has already been normalized by
 * `normalizeWebEndpoints` (it always begins with "/"); a raw unvalidated path
 * would produce a malformed URL.
 */
export function resolveWebEndpointUrl({
  hostAddress,
  endpoint,
  localPort,
  tunnelHost,
}: {
  hostAddress: string;
  endpoint: WebEndpoint;
  localPort?: number;
  /**
   * Where the caller can reach the forward the backend bound. Must never be
   * the host string the browser is currently reaching Termix at -- see
   * `separatedTunnelHost`. Defaults to loopback.
   */
  tunnelHost?: string;
}): string {
  const path = endpoint.path && endpoint.path.length > 0 ? endpoint.path : "/";

  if (endpoint.access === "tunnel") {
    if (!localPort) {
      throw new Error("A tunnel endpoint needs a local port to resolve a URL");
    }
    const authority = bracketIfIpv6(tunnelHost?.trim() || "127.0.0.1");
    return `${endpoint.scheme}://${authority}:${localPort}${path}`;
  }

  return `${endpoint.scheme}://${bracketIfIpv6(hostAddress)}:${endpoint.port}${path}`;
}

/** A bare IPv6 literal has to be bracketed to be a legal URL authority. */
function bracketIfIpv6(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

/** Host spellings that mean "this machine". */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/**
 * Each loopback spelling mapped to a DIFFERENT one that reaches the same
 * machine. Being a different string is the entire point.
 */
const LOOPBACK_ALIASES: Record<string, string> = {
  localhost: "127.0.0.1",
  "127.0.0.1": "localhost",
  "::1": "127.0.0.1",
  "[::1]": "127.0.0.1",
};

/**
 * A host string that reaches the same machine as `pageHost` but is a
 * different key in the browser's cookie jar -- or null when none can be
 * derived.
 *
 * This is a security mitigation, not a cosmetic choice. Cookies are keyed by
 * host and IGNORE the port, and SameSite computes "site" as scheme +
 * registrable domain -- also ignoring the port. So a forward reached at the
 * very host string serving Termix is same-site with Termix, and two things
 * follow:
 *
 *   1. the browser attaches Termix's `jwt` cookie to every request the framed
 *      third-party server sees, including its access log; and
 *   2. a `Set-Cookie: jwt=...` from that server lands in the jar Termix's own
 *      API calls read from -- and both auth middlewares read the cookie
 *      BEFORE the Authorization header, so it decides who Termix acts as.
 *
 * Both directions were reproduced against a real SSH forward.
 *
 * Only loopback literals get an alias. A same-registrable-domain name would
 * not be safe even though it is a different host: the target could answer
 * `Set-Cookie: jwt=...; Domain=example.com`, which reaches Termix anyway.
 * Loopback literals cannot carry a Domain attribute, so they are the only
 * spellings that close both directions.
 */
export function separatedTunnelHost(pageHost: string): string | null {
  return LOOPBACK_ALIASES[pageHost.trim().toLowerCase()] ?? null;
}

/** Lowercase, trim, drop surrounding IPv6 brackets and a single trailing dot. */
function normalizeHost(host: string): string {
  let h = host.trim().toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  if (h.endsWith(".")) h = h.slice(0, -1);
  return h;
}

/**
 * Whether a browser would attach Termix's `jwt` cookie to a request for
 * `targetHost` while the page is served from `pageHost` -- or accept a
 * `Set-Cookie` from `targetHost` into the jar Termix's own API reads.
 *
 * The web client sets `jwt` host-only (no `Domain`), so the port is irrelevant
 * and the disclosure direction is exactly an equal host. The reverse direction
 * -- the target answering `Set-Cookie: jwt=...; Domain=<parent>` -- reaches
 * Termix whenever the two share a domain, so a parent/sub relationship counts
 * too. The suffix check is anchored on a dot boundary so `eviltermix.example`
 * is not treated as same-site with `termix.example`.
 *
 * A precise registrable-domain (eTLD+1) test would also catch sibling
 * subdomains under a shared parent, but needs a public-suffix list this app
 * does not bundle; the exact/parent/sub check closes the reported same-host
 * case only. This is defense in depth, not cookie isolation: embedded frames
 * must use credentialless plus an opaque sandbox origin, including redirects.
 */
export function sharesCookieSiteWithPage(
  targetHost: string,
  pageHost: string,
): boolean {
  const t = normalizeHost(targetHost);
  const p = normalizeHost(pageHost);
  if (!t || !p) return false;
  if (t === p) return true;
  return t.endsWith("." + p) || p.endsWith("." + t);
}

function defaultPageHost(): string {
  return typeof window === "undefined" ? "127.0.0.1" : window.location.hostname;
}

/**
 * Why a web endpoint must not be opened from this client.
 *
 * `loopback-bind-on-remote-backend` -- the forward binds where the backend
 * runs. In a browser that is the server, so a loopback bind answers only to
 * the server itself: the open succeeds, the port exists, and the browser
 * still gets nothing.
 *
 * `shares-session-cookie-with-termix` -- the tunnel URL would resolve to the
 * same host string the page is served from, handing Termix's session token to
 * the tunnelled service. See `separatedTunnelHost`.
 *
 * `direct-shares-session-cookie` -- the same leak without a tunnel: a direct
 * endpoint's target host shares Termix's cookie site, so the browser attaches
 * the `jwt` to it (and accepts one back). A different port is not a different
 * cookie key. See `sharesCookieSiteWithPage`.
 */
export type WebEndpointRefusalReason =
  | "loopback-bind-on-remote-backend"
  | "shares-session-cookie-with-termix"
  | "direct-shares-session-cookie";

/**
 * Why a web endpoint must not be opened from this client, or null when it may.
 *
 * Covers both access modes. A tunnel is refused when its forward would either
 * be unreachable (loopback bind on a remote backend) or resolve to the page's
 * own host string (`shares-session-cookie-with-termix`). A DIRECT endpoint is
 * refused when its target host shares Termix's cookie site
 * (`direct-shares-session-cookie`) -- the same leak, reached without a tunnel:
 * cookies ignore the port, so a UI on the very host serving Termix receives
 * the session. `hostAddress` is the direct endpoint's target host and is
 * ignored for tunnels.
 *
 * The desktop is exempt: its session is Bearer-only with no `jwt` in the jar,
 * and its API base ("localhost") is already separated from where tunnels
 * resolve ("127.0.0.1").
 */
export function webEndpointRefusalReason(
  endpoint: Pick<WebEndpoint, "access" | "bindHost">,
  runningInElectron: boolean,
  hostAddress: string | undefined,
  pageHost: string = defaultPageHost(),
): WebEndpointRefusalReason | null {
  if (runningInElectron) return null;

  if (endpoint.access === "direct") {
    if (hostAddress && sharesCookieSiteWithPage(hostAddress, pageHost)) {
      return "direct-shares-session-cookie";
    }
    return null;
  }

  if (endpoint.access !== "tunnel") return null;

  const bindHost = (endpoint.bindHost ?? "").trim().toLowerCase();
  // Reported first when both apply: the bind address is what the user has to
  // change either way, and it is the more specific instruction.
  if (!bindHost || LOOPBACK_HOSTS.has(bindHost)) {
    return "loopback-bind-on-remote-backend";
  }

  if (!separatedTunnelHost(pageHost)) {
    return "shares-session-cookie-with-termix";
  }
  return null;
}

/**
 * Where this client should reach a forward the backend bound, or null when no
 * host string is both reachable and safe -- in which case
 * `unreachableTunnelReason` explains why and the caller must not open.
 */
export function currentTunnelHost(
  runningInElectron: boolean,
  pageHost: string = defaultPageHost(),
): string | null {
  if (runningInElectron) return "127.0.0.1";
  return separatedTunnelHost(pageHost);
}
