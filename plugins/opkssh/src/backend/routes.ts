import axios from "axios";
import type { Request, Response, Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import {
  normalizeSelectOpParam,
  renderErrorPage,
  rewriteOpksshHtml,
} from "./html.js";
import {
  PLUGIN_PATH,
  type AuthSession,
  type AuthSessions,
} from "./auth-session.js";
import type { TokenStore } from "./token-store.js";

/**
 * The browser reaches these without a Termix session: the sign-in may finish
 * in a different browser, and the identity provider redirects to /callback.
 * Each is matched to its sign-in by the request id, the OAuth state or the
 * opkssh_request_id cookie.
 */
export const PUBLIC_PATHS = [
  "/chooser/:requestId",
  "/chooser/:requestId/*",
  "/callback",
  "/callback/:requestId",
  "/callback/:requestId/*",
];

const REQUEST_COOKIE = "opkssh_request_id";
const MAX_HOPS = 4;

function isLocalHostname(host: string): boolean {
  const bare = host.split(":")[0];
  return bare === "127.0.0.1" || bare === "localhost" || bare === "[::1]";
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function param(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export function registerRoutes(
  router: Router,
  ctx: PluginContext,
  sessions: AuthSessions,
  tokens: TokenStore,
): void {
  /** The plugin's public path prefix on this install, base path included. */
  const prefix = (req: Request): string => {
    const base = new URL(ctx.http.baseUrl(req)).pathname.replace(/\/$/, "");
    return `${base}${PLUGIN_PATH}`;
  };

  const pathAfter = (req: Request, marker: string): string => {
    const full = req.originalUrl || req.url;
    const index = full.indexOf(marker);
    return index === -1 ? "" : full.slice(index + marker.length);
  };

  const sessionNotFound = (res: Response, requestId: string) => {
    res.status(404).send(
      renderErrorPage({
        title: "Session Not Found",
        heading: "Session Not Found",
        message:
          "This authentication session has expired or is invalid. Please close this window and try again.",
        requestId,
      }),
    );
  };

  async function actingUserWithAccess(
    req: Request,
    res: Response,
  ): Promise<{ userId: string; hostId: number } | null> {
    const userId = ctx.currentActor();
    const hostId = Number(param(req.params.hostId));
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return null;
    }
    if (!Number.isInteger(hostId) || hostId <= 0) {
      res.status(400).json({ error: "Invalid host id" });
      return null;
    }
    const access = await ctx.hosts.checkAccess(hostId, "connect");
    if (!access.hasAccess) {
      res.status(404).json({ error: "Host not found" });
      return null;
    }
    return { userId, hostId };
  }

  /**
   * @openapi
   * /plugin-api/opkssh/token/{hostId}:
   *   get:
   *     summary: Get the cached OPKSSH certificate status for a host
   *     description: Whether the current user has a valid cached certificate for this host, and when it expires.
   *     tags: [OPKSSH]
   *     parameters:
   *       - name: hostId
   *         in: path
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Certificate status.
   *       400:
   *         description: Invalid host id.
   *       404:
   *         description: Host not found or not accessible.
   */
  router.get("/token/:hostId", async (req: Request, res: Response) => {
    const target = await actingUserWithAccess(req, res);
    if (!target) return;
    res.json(await tokens.status(target.userId, target.hostId));
  });

  /**
   * @openapi
   * /plugin-api/opkssh/token/{hostId}:
   *   delete:
   *     summary: Forget the cached OPKSSH certificate for a host
   *     description: The next connection to the host asks for a browser sign-in again.
   *     tags: [OPKSSH]
   *     parameters:
   *       - name: hostId
   *         in: path
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Certificate removed, or there was none.
   *       400:
   *         description: Invalid host id.
   *       404:
   *         description: Host not found or not accessible.
   */
  router.delete("/token/:hostId", async (req: Request, res: Response) => {
    const target = await actingUserWithAccess(req, res);
    if (!target) return;
    await tokens.remove(target.userId, target.hostId);
    res.json({ success: true });
  });

  /**
   * Follows OPKSSH's /select hops until it names the identity provider:
   * /select to /select/ on the chooser, then /login on the callback listener,
   * then the provider's authorize URL.
   */
  async function proxySelect(
    req: Request,
    res: Response,
    session: AuthSession,
    targetPath: string,
  ): Promise<void> {
    const requestId = session.requestId;
    const rawQs = targetPath.includes("?")
      ? targetPath.slice(targetPath.indexOf("?"))
      : "";
    let qs = rawQs;
    if (rawQs) {
      try {
        const params = new URLSearchParams(rawQs.replace(/^\?/, ""));
        const rawOp = params.get("op");
        if (rawOp) {
          const mapped = normalizeSelectOpParam(rawOp, session.providers);
          if (mapped !== rawOp) {
            params.set("op", mapped);
            qs = `?${params.toString()}`;
          }
        }
      } catch {
        // keep the raw query
      }
    }

    const chooserHost = `127.0.0.1:${session.localPort}`;
    const startUrl = `http://${chooserHost}/select/${qs}`;

    const fetchUpstream = async (url: string) => {
      let hostHeader = chooserHost;
      try {
        hostHeader = new URL(url).host;
      } catch {
        // keep the chooser host
      }
      const response = await axios({
        method: "GET",
        url,
        maxRedirects: 0,
        validateStatus: () => true,
        timeout: 10000,
        responseType: "text",
        transformResponse: (value) => value,
        headers: { host: hostHeader },
      });
      const location = response.headers["location"];
      const contentType = response.headers["content-type"];
      return {
        status: response.status,
        location: typeof location === "string" ? location : undefined,
        contentType: typeof contentType === "string" ? contentType : "",
        body:
          typeof response.data === "string"
            ? response.data
            : String(response.data ?? ""),
        targetUrl: url,
      };
    };

    try {
      let response = await fetchUpstream(startUrl);
      for (let hop = 0; hop < MAX_HOPS; hop++) {
        if (response.status < 300 || response.status >= 400) break;
        const location = response.location;
        if (!location) break;

        if (location.startsWith("/")) {
          let currentHost = chooserHost;
          try {
            currentHost = new URL(response.targetUrl).host;
          } catch {
            // keep the chooser host
          }
          response = await fetchUpstream(`http://${currentHost}${location}`);
          continue;
        }

        if (/^https?:\/\//i.test(location)) {
          const parsed = new URL(location);
          if (isLocalHostname(parsed.host)) {
            if (!session.callbackPort) {
              const port = parseInt(parsed.port, 10);
              if (!Number.isNaN(port)) session.callbackPort = port;
            }
            // Send the browser through the proxy so it gets the state cookie
            // OPKSSH sets on /login; following it here would swallow it.
            res.redirect(
              302,
              `${prefix(req)}/chooser/${requestId}${parsed.pathname}${parsed.search}`,
            );
            return;
          }
        }
        break;
      }

      let external: URL | null = null;
      if (
        response.status >= 300 &&
        response.status < 400 &&
        response.location &&
        /^https?:\/\//i.test(response.location)
      ) {
        try {
          const parsed = new URL(response.location);
          if (!isLocalHostname(parsed.host)) external = parsed;
        } catch {
          external = null;
        }
      }

      if (external) {
        const state = external.searchParams.get("state");
        if (state) sessions.registerOAuthState(state, requestId);
        res.redirect(302, external.toString());
        return;
      }

      const bodyPreview = response.body.slice(0, 512);
      ctx.log.error(
        `OPKSSH /select did not produce an OAuth redirect (status ${response.status})`,
      );
      res.status(502).send(
        renderErrorPage({
          title: "OPKSSH error",
          heading: "Failed to get OAuth redirect",
          message:
            "OPKSSH did not return an external OAuth provider URL. " +
            "This typically indicates a configuration mismatch between the provider's redirect_uris " +
            "and the Termix callback path. Check the server log for the OPKSSH response body.",
          details: [
            `Upstream: ${response.targetUrl}`,
            `Status: ${response.status}`,
            response.location ? `Location: ${response.location}` : "",
            `Content-Type: ${response.contentType || "(none)"}`,
            "",
            bodyPreview
              ? `Body (first 512 chars):\n${bodyPreview}`
              : "Body: (empty)",
          ]
            .filter((line, index) => line || index === 4)
            .join("\n"),
          requestId,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.log.error(`Error proxying OPKSSH /select: ${message}`);
      res.status(502).send(
        renderErrorPage({
          title: "OPKSSH error",
          heading: "Failed to reach OPKSSH service",
          message:
            "Termix could not connect to the local OPKSSH authentication service. " +
            "The OPKSSH process may have exited or is not listening yet.",
          details: `Upstream: ${startUrl}\nError: ${message}`,
          requestId,
        }),
      );
    }
  }

  /**
   * @openapi
   * /plugin-api/opkssh/chooser/{requestId}:
   *   get:
   *     summary: Proxy the OPKSSH provider chooser page and its resources
   *     description: Public. Serves OPKSSH's local chooser for one sign-in, rewriting its URLs to this path. Any subpath is proxied too.
   *     tags: [OPKSSH]
   *     parameters:
   *       - name: requestId
   *         in: path
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Chooser page content.
   *       302:
   *         description: Redirect to the identity provider or the callback listener.
   *       404:
   *         description: Sign-in not found.
   *       502:
   *         description: OPKSSH did not answer as expected.
   */
  router.use("/chooser/:requestId", async (req: Request, res: Response) => {
    const requestId = param(req.params.requestId);
    const session = sessions.get(requestId);
    if (!session) {
      sessionNotFound(res, requestId);
      return;
    }
    if (!session.localPort) {
      res.status(500).send(
        renderErrorPage({
          title: "Error",
          heading: "Authentication Error",
          message:
            "Failed to load authentication page. OPKSSH process may not be ready yet. Please try again.",
          requestId,
        }),
      );
      return;
    }

    const base = prefix(req);
    const chooserBase = `${base}/chooser/${requestId}`;
    const callbackBase = `${base}/callback/${requestId}`;
    const targetPath = pathAfter(req, `/chooser/${requestId}`) || "/chooser";

    if (targetPath.startsWith("/select")) {
      await proxySelect(req, res, session, targetPath);
      return;
    }

    // The browser is sent here for OPKSSH's login listener so it receives
    // the listener's cookies.
    const onCallbackListener =
      /^\/login(?:\?|$)/.test(targetPath) ||
      /^\/login-callback(?:\?|$)/.test(targetPath);
    const upstreamPort =
      onCallbackListener && session.callbackPort
        ? session.callbackPort
        : session.localPort;

    try {
      const response = await axios({
        method: req.method,
        url: `http://127.0.0.1:${upstreamPort}${targetPath}`,
        headers: { ...req.headers, host: `127.0.0.1:${upstreamPort}` },
        data: req.body,
        timeout: 10000,
        validateStatus: () => true,
        maxRedirects: 0,
        responseType: "arraybuffer",
      });

      for (const [key, value] of Object.entries(response.headers)) {
        const lower = key.toLowerCase();
        if (lower === "transfer-encoding") continue;
        if (lower === "location") {
          const location = String(value);
          if (location.startsWith("/")) {
            res.setHeader(key, `${chooserBase}${location}`);
            continue;
          }
          const local = location.match(
            /^http:\/\/(?:localhost|127\.0\.0\.1):(\d+)(\/.*)?$/,
          );
          if (local) {
            const port = parseInt(local[1], 10);
            const path = local[2] || "/";
            const toCallback =
              (session.callbackPort && port === session.callbackPort) ||
              (port !== session.localPort &&
                (path.includes("login") || path.includes("callback")));
            res.setHeader(
              key,
              `${toCallback ? callbackBase : chooserBase}${path}`,
            );
            continue;
          }
          try {
            const state = new URL(location).searchParams.get("state");
            if (state) sessions.registerOAuthState(state, requestId);
          } catch {
            // not a URL
          }
          res.setHeader(key, location);
        } else if (lower === "set-cookie") {
          // Scope OPKSSH's cookies to the proxied callback, where the state
          // cookie set by /login has to arrive.
          const cookies = Array.isArray(value) ? value : [String(value)];
          res.setHeader(
            key,
            cookies.map((cookie) =>
              /;\s*path=/i.test(cookie)
                ? cookie
                    .replace(/;\s*domain=[^;]*/gi, "")
                    .replace(/;\s*path=[^;]*/gi, `; Path=${base}/callback/`)
                : `${cookie.replace(/;\s*domain=[^;]*/gi, "")}; Path=${base}/callback/`,
            ),
          );
        } else if (value !== undefined) {
          res.setHeader(key, value as string | string[]);
        }
      }

      // Survives the identity provider round trip, for when OPKSSH
      // redirects with script and no state was captured.
      res.cookie(REQUEST_COOKIE, requestId, {
        path: `${base}/`,
        httpOnly: true,
        sameSite: "lax",
        maxAge: 5 * 60 * 1000,
      });

      const contentType = String(response.headers["content-type"] || "");
      const data = Buffer.from(response.data as ArrayBuffer);
      if (contentType.includes("text/html")) {
        res
          .status(response.status)
          .send(rewriteOpksshHtml(data.toString("utf-8"), chooserBase));
      } else {
        res.status(response.status).send(data);
      }
    } catch (error) {
      ctx.log.error(
        `Error proxying OPKSSH chooser: ${error instanceof Error ? error.message : String(error)}`,
      );
      res.status(500).send(
        renderErrorPage({
          title: "Error",
          heading: "Error",
          message: "Failed to load authentication page. Please try again.",
          requestId,
        }),
      );
    }
  });

  /**
   * @openapi
   * /plugin-api/opkssh/callback:
   *   get:
   *     summary: OAuth callback from the identity provider for an OPKSSH sign-in
   *     description: Public. The redirect URI registered with the identity provider. Finds the sign-in by OAuth state or the opkssh_request_id cookie and forwards to its proxied callback listener.
   *     tags: [OPKSSH]
   *     responses:
   *       302:
   *         description: Forwarded to the sign-in's callback listener.
   *       401:
   *         description: No sign-in matches this callback.
   *       503:
   *         description: OPKSSH's callback listener is not ready yet.
   */
  router.get("/callback", (req: Request, res: Response) => {
    const base = prefix(req);
    const state = typeof req.query.state === "string" ? req.query.state : "";
    let session = state ? sessions.takeByOAuthState(state) : undefined;
    if (!session) {
      const cookieId = readCookie(req, REQUEST_COOKIE);
      if (cookieId) {
        session = sessions.get(cookieId);
        if (session) res.clearCookie(REQUEST_COOKIE, { path: `${base}/` });
      }
    }
    if (!session) {
      ctx.log.warn("OPKSSH callback matched no sign-in");
      res
        .status(401)
        .send("Authentication callback failed: unable to identify session");
      return;
    }
    if (!session.callbackPort) {
      res.status(503).send("OPKSSH callback listener not ready yet");
      return;
    }
    const query = req.url.includes("?")
      ? req.url.slice(req.url.indexOf("?"))
      : "";
    res.redirect(302, `${base}/callback/${session.requestId}${query}`);
  });

  /**
   * @openapi
   * /plugin-api/opkssh/callback/{requestId}:
   *   get:
   *     summary: Proxy OPKSSH's local callback listener for one sign-in
   *     description: Public. Forwards to OPKSSH's login-callback listener, which prints the key and certificate once the code exchange succeeds. Any subpath is proxied too.
   *     tags: [OPKSSH]
   *     parameters:
   *       - name: requestId
   *         in: path
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: The listener's page.
   *       404:
   *         description: Sign-in not found.
   *       500:
   *         description: The listener is not ready.
   */
  router.use("/callback/:requestId", async (req: Request, res: Response) => {
    const requestId = param(req.params.requestId);
    const session = sessions.get(requestId);
    if (!session) {
      sessionNotFound(res, requestId);
      return;
    }
    if (!session.callbackPort) {
      res.status(500).send(
        renderErrorPage({
          title: "Error",
          heading: "Callback Error",
          message:
            "OPKSSH callback listener not ready. Please try authenticating again.",
          requestId,
        }),
      );
      return;
    }

    const callbackBase = `${prefix(req)}/callback/${requestId}`;
    const after = pathAfter(req, `/callback/${requestId}`);
    // The listener serves /login-callback whatever the public path was.
    const targetPath =
      after === "" || after.startsWith("?") ? `/login-callback${after}` : after;

    try {
      const response = await axios({
        method: req.method,
        url: `http://127.0.0.1:${session.callbackPort}${targetPath}`,
        headers: { ...req.headers, host: `127.0.0.1:${session.callbackPort}` },
        data: req.body,
        timeout: 10000,
        validateStatus: () => true,
        maxRedirects: 0,
        responseType: "arraybuffer",
      });

      for (const [key, value] of Object.entries(response.headers)) {
        const lower = key.toLowerCase();
        if (lower === "transfer-encoding" || value === undefined) continue;
        if (lower === "location" && String(value).startsWith("/")) {
          res.setHeader(key, `${callbackBase}${String(value)}`);
        } else {
          res.setHeader(key, value as string | string[]);
        }
      }

      const contentType = String(response.headers["content-type"] || "");
      const data = Buffer.from(response.data as ArrayBuffer);
      if (contentType.includes("text/html")) {
        res
          .status(response.status)
          .send(rewriteOpksshHtml(data.toString("utf-8"), callbackBase));
      } else {
        res.status(response.status).send(data);
      }
    } catch (error) {
      ctx.log.error(
        `Error handling OPKSSH callback: ${error instanceof Error ? error.message : String(error)}`,
      );
      res.status(500).send(
        renderErrorPage({
          title: "Error",
          heading: "Error",
          message: "An unexpected error occurred. Please try again.",
          requestId,
        }),
      );
    }
  });
}
