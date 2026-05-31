import type { Router, Request, Response } from "express";
import { sshLogger } from "../../utils/logger.js";
import {
  normalizeSelectOpParam,
  renderOpksshErrorPage,
  rewriteOPKSSHHtml,
} from "./opkssh-html.js";

export function registerHostOpksshRoutes(router: Router): void {
  /**
   * @openapi
   * /host/opkssh-chooser/{requestId}:
   *   get:
   *     summary: Proxy OPKSSH provider chooser page and all related resources
   *     tags: [SSH]
   *     parameters:
   *       - name: requestId
   *         in: path
   *         required: true
   *         schema:
   *           type: string
   *         description: Authentication request ID
   *     responses:
   *       200:
   *         description: Chooser page content
   *       404:
   *         description: Session not found
   *       500:
   *         description: Proxy error
   */

  router.use(
    "/opkssh-chooser/:requestId",
    async (req: Request, res: Response) => {
      const requestId = Array.isArray(req.params.requestId)
        ? req.params.requestId[0]
        : req.params.requestId;

      const fullPath = req.originalUrl || req.url;
      const pathAfterRequestIdTemp =
        fullPath.split(`/host/opkssh-chooser/${requestId}`)[1] || "";

      sshLogger.info("OPKSSH chooser proxy request", {
        operation: "opkssh_chooser_proxy_request",
        requestId,
        url: req.url,
        originalUrl: req.originalUrl,
        fullPath,
        pathAfterRequestId: pathAfterRequestIdTemp,
        method: req.method,
      });

      try {
        const { getActiveAuthSession, registerOAuthState } =
          await import("../../ssh/opkssh-auth.js");
        const session = getActiveAuthSession(requestId);

        if (!session) {
          sshLogger.error("Session not found for chooser request", {
            operation: "opkssh_chooser_session_not_found",
            requestId,
          });
          res.status(404).send(
            renderOpksshErrorPage({
              title: "Session Not Found",
              heading: "Session Not Found",
              message: "This authentication session has expired or is invalid.",
              requestId,
            }),
          );
          return;
        }

        const axios = (await import("axios")).default;

        const fullPath = req.originalUrl || req.url;
        const pathAfterRequestId =
          fullPath.split(`/host/opkssh-chooser/${requestId}`)[1] || "";
        const targetPath = pathAfterRequestId || "/chooser";

        if (!session.localPort || session.localPort === 0) {
          sshLogger.error("OPKSSH session has no local port", {
            operation: "opkssh_chooser_proxy",
            requestId,
            sessionStatus: session.status,
          });
          res.status(500).send(
            renderOpksshErrorPage({
              title: "Error",
              heading: "Authentication Error",
              message:
                "Failed to load authentication page. OPKSSH process may not be ready yet. Please try again.",
              requestId,
            }),
          );
          return;
        }

        // /select on OPKSSH's chooser redirects (possibly via multiple local hops) to the
        // external OAuth provider URL. The hops we may see:
        //   1. /select -> /select/ (Go ServeMux canonicalization, same chooser port)
        //   2. /select/?op=ALIAS -> http://localhost:CALLBACK_PORT/login (OPKSSH's separate callback listener)
        //   3. /login on the callback listener -> https://<provider>/authorize?... (external OAuth URL)
        if (targetPath.startsWith("/select")) {
          const selectaxios = (await import("axios")).default;
          const rawQs = targetPath.includes("?")
            ? targetPath.slice(targetPath.indexOf("?"))
            : "";

          let qs = rawQs;
          let opMappedFrom: string | undefined;
          if (rawQs) {
            try {
              const params = new URLSearchParams(rawQs.replace(/^\?/, ""));
              const rawOp = params.get("op");
              if (rawOp) {
                const mappedOp = normalizeSelectOpParam(
                  rawOp,
                  session.providers || [],
                );
                if (mappedOp !== rawOp) {
                  params.set("op", mappedOp);
                  qs = `?${params.toString()}`;
                  opMappedFrom = rawOp;
                }
              }
            } catch {
              /* keep rawQs if parsing fails */
            }
          }

          const chooserHost = `127.0.0.1:${session.localPort}`;
          const startUrl = `http://${chooserHost}/select/${qs}`;

          sshLogger.info("Proxying OPKSSH /select", {
            operation: "opkssh_select_proxy",
            requestId,
            targetUrl: startUrl,
            opMappedFrom,
          });

          const isLocalHostname = (host: string): boolean => {
            const bare = host.split(":")[0];
            return (
              bare === "127.0.0.1" || bare === "localhost" || bare === "[::1]"
            );
          };

          interface UpstreamResponse {
            status: number;
            location?: string;
            contentType: string;
            body: string;
            targetUrl: string;
            elapsedMs: number;
          }

          const fetchUpstream = async (
            url: string,
          ): Promise<UpstreamResponse> => {
            const started = Date.now();
            let hostHeader = chooserHost;
            try {
              hostHeader = new URL(url).host;
            } catch {
              /* fall back to chooser host */
            }
            const r = await selectaxios({
              method: "GET",
              url,
              maxRedirects: 0,
              validateStatus: () => true,
              timeout: 10000,
              responseType: "text",
              transformResponse: (v) => v,
              headers: { host: hostHeader },
            });
            const locHeader = r.headers["location"];
            const location = Array.isArray(locHeader)
              ? locHeader[0]
              : locHeader;
            const ctHeader = r.headers["content-type"];
            const ctRaw = Array.isArray(ctHeader) ? ctHeader[0] : ctHeader;
            const contentType = typeof ctRaw === "string" ? ctRaw : "";
            const body =
              typeof r.data === "string" ? r.data : String(r.data ?? "");
            return {
              status: r.status,
              location: typeof location === "string" ? location : undefined,
              contentType,
              body,
              targetUrl: url,
              elapsedMs: Date.now() - started,
            };
          };

          const logResponse = (response: UpstreamResponse): void => {
            sshLogger.info("OPKSSH /select upstream response", {
              operation: "opkssh_select_upstream_response",
              requestId,
              targetUrl: response.targetUrl,
              status: response.status,
              location: response.location,
              contentType: response.contentType,
              elapsedMs: response.elapsedMs,
              bodyPreview: response.body.slice(0, 256),
            });
          };

          const MAX_HOPS = 4;

          try {
            let response = await fetchUpstream(startUrl);
            logResponse(response);

            for (let hop = 0; hop < MAX_HOPS; hop++) {
              if (
                response.status < 300 ||
                response.status >= 400 ||
                !response.location
              ) {
                break;
              }
              const loc = response.location;

              // Relative path: resolve against the current upstream.
              if (loc.startsWith("/")) {
                let currentHost = chooserHost;
                try {
                  currentHost = new URL(response.targetUrl).host;
                } catch {
                  /* keep default */
                }
                response = await fetchUpstream(`http://${currentHost}${loc}`);
                logResponse(response);
                continue;
              }

              // Absolute URL: if it points to a localhost OPKSSH endpoint, capture
              // the port. Then redirect the BROWSER to the proxied path so that
              // Set-Cookie headers from OPKSSH's /login handler reach the browser
              // directly — following them server-side would swallow the cookie.
              if (/^https?:\/\//i.test(loc)) {
                try {
                  const parsed = new URL(loc);
                  if (isLocalHostname(parsed.host)) {
                    // Capture callback listener port if not yet known.
                    if (!session.callbackPort) {
                      const port = parseInt(parsed.port, 10);
                      if (!Number.isNaN(port)) {
                        session.callbackPort = port;
                        sshLogger.info(
                          "Captured OPKSSH callback listener port from /select redirect",
                          {
                            operation: "opkssh_select_callback_port_detected",
                            requestId,
                            callbackPort: port,
                          },
                        );
                      }
                    }
                    // Redirect browser through the chooser proxy so it can receive
                    // the state cookie that OPKSSH sets on /login.
                    const browserPath = `/host/opkssh-chooser/${requestId}${parsed.pathname}${parsed.search}`;
                    sshLogger.info(
                      "Redirecting browser to OPKSSH callback listener via proxy",
                      {
                        operation: "opkssh_select_browser_redirect_to_login",
                        requestId,
                        browserPath,
                        callbackPort: session.callbackPort,
                      },
                    );
                    res.redirect(302, browserPath);
                    return;
                  }
                  // External OAuth provider URL — done, handled below.
                  break;
                } catch {
                  break;
                }
              }

              break;
            }

            const isExternalRedirect =
              response.status >= 300 &&
              response.status < 400 &&
              !!response.location &&
              /^https?:\/\//i.test(response.location) &&
              (() => {
                try {
                  return !isLocalHostname(
                    new URL(response.location as string).host,
                  );
                } catch {
                  return false;
                }
              })();

            if (isExternalRedirect) {
              const oauthUrl = response.location as string;
              try {
                const parsed = new URL(oauthUrl);
                const oauthState = parsed.searchParams.get("state");
                if (oauthState) registerOAuthState(oauthState, requestId);
              } catch {
                /* already validated above */
              }
              sshLogger.info(
                "OPKSSH /select redirecting browser to OAuth provider",
                {
                  operation: "opkssh_select_redirect",
                  requestId,
                  oauthUrl,
                },
              );
              res.redirect(302, oauthUrl);
              return;
            }

            const bodyPreview = response.body.slice(0, 512);
            const detailLines = [
              `Upstream: ${response.targetUrl}`,
              `Status: ${response.status}`,
              response.location ? `Location: ${response.location}` : undefined,
              `Content-Type: ${response.contentType || "(none)"}`,
              `Elapsed: ${response.elapsedMs}ms`,
              "",
              bodyPreview
                ? `Body (first 512 chars):\n${bodyPreview}`
                : "Body: (empty)",
            ].filter(Boolean) as string[];

            sshLogger.error(
              "OPKSSH /select did not produce an OAuth redirect",
              {
                operation: "opkssh_select_no_oauth_redirect",
                requestId,
                status: response.status,
                location: response.location,
                contentType: response.contentType,
                bodyPreview,
              },
            );

            res.status(502).send(
              renderOpksshErrorPage({
                title: "OPKSSH error",
                heading: "Failed to get OAuth redirect",
                message:
                  "OPKSSH did not return an external OAuth provider URL. " +
                  "This typically indicates a configuration mismatch between the provider's redirect_uris " +
                  "and the Termix callback path. Check the server log for the OPKSSH response body.",
                details: detailLines.join("\n"),
                requestId,
              }),
            );
          } catch (err) {
            sshLogger.error("Error proxying OPKSSH /select", err, {
              operation: "opkssh_select_proxy_error",
              requestId,
              targetUrl: startUrl,
            });
            const errMsg = err instanceof Error ? err.message : String(err);
            res.status(502).send(
              renderOpksshErrorPage({
                title: "OPKSSH error",
                heading: "Failed to reach OPKSSH service",
                message:
                  "Termix could not connect to the local OPKSSH authentication service. " +
                  "The OPKSSH process may have exited or is not listening yet.",
                details: `Upstream: ${startUrl}\nError: ${errMsg}`,
                requestId,
              }),
            );
          }
          return;
        }

        // Paths served by the callback listener, not the chooser.
        // The browser is redirected here so it receives Set-Cookie from OPKSSH.
        const isCallbackListenerPath =
          targetPath === "/login" ||
          targetPath.startsWith("/login?") ||
          targetPath === "/login-callback" ||
          targetPath.startsWith("/login-callback?");

        const upstreamPort =
          isCallbackListenerPath && session.callbackPort
            ? session.callbackPort
            : session.localPort;

        const targetUrl = `http://127.0.0.1:${upstreamPort}${targetPath}`;

        sshLogger.info("Proxying to OPKSSH chooser", {
          operation: "opkssh_chooser_proxy_request_to_opkssh",
          requestId,
          targetUrl,
          upstreamPort,
          targetPath,
        });

        const response = await axios({
          method: req.method,
          url: targetUrl,
          headers: {
            ...req.headers,
            host: `127.0.0.1:${upstreamPort}`,
          },
          data: req.body,
          timeout: 10000,
          validateStatus: () => true,
          maxRedirects: 0,
          responseType: "arraybuffer",
        });

        sshLogger.info("OPKSSH chooser response received", {
          operation: "opkssh_chooser_proxy_response",
          requestId,
          statusCode: response.status,
          contentType: response.headers["content-type"],
          contentLength: response.headers["content-length"],
          hasLocation: !!response.headers.location,
        });

        Object.entries(response.headers).forEach(([key, value]) => {
          if (key.toLowerCase() === "transfer-encoding") {
            return;
          }
          if (key.toLowerCase() === "location") {
            const location = value as string;
            if (location.startsWith("/")) {
              res.setHeader(
                key,
                `/host/opkssh-chooser/${requestId}${location}`,
              );
            } else {
              const localhostMatch = location.match(
                /^http:\/\/(?:localhost|127\.0\.0\.1):(\d+)(\/.*)?$/,
              );
              if (localhostMatch) {
                const port = parseInt(localhostMatch[1], 10);
                const path = localhostMatch[2] || "/";
                if (session.callbackPort && port === session.callbackPort) {
                  res.setHeader(
                    key,
                    `/host/opkssh-callback/${requestId}${path}`,
                  );
                } else if (port === session.localPort) {
                  res.setHeader(
                    key,
                    `/host/opkssh-chooser/${requestId}${path}`,
                  );
                } else {
                  const isCallback =
                    path.includes("login") || path.includes("callback");
                  const prefix = isCallback
                    ? "opkssh-callback"
                    : "opkssh-chooser";
                  res.setHeader(key, `/host/${prefix}/${requestId}${path}`);
                }
              } else {
                // External redirect (e.g. to OIDC provider) — capture OAuth state for session binding
                try {
                  const redirectUrl = new URL(location);
                  const oauthState = redirectUrl.searchParams.get("state");
                  if (oauthState) {
                    registerOAuthState(oauthState, requestId);
                  }
                } catch {
                  // Not a valid URL, skip state capture
                }
                res.setHeader(key, value as string);
              }
            }
          } else if (key.toLowerCase() === "set-cookie") {
            // Rewrite cookies from OPKSSH's internal listener so they are scoped
            // to the Termix proxy path instead of OPKSSH's internal path.
            // The state cookie set by /login must survive to /login-callback.
            const cookies = Array.isArray(value) ? value : [value as string];
            const rewritten = cookies.map((cookie) => {
              return cookie
                .replace(/;\s*domain=[^;]*/gi, "")
                .replace(/;\s*path=[^;]*/gi, "; Path=/host/opkssh-callback/")
                .concat(
                  cookie.match(/;\s*path=/i)
                    ? ""
                    : "; Path=/host/opkssh-callback/",
                );
            });
            res.setHeader(key, rewritten);
          } else {
            res.setHeader(key, value as string);
          }
        });

        // Set a cookie to correlate this browser with the requestId.
        // OAuth state capture from Location headers only works for 3xx redirects;
        // if OPKSSH redirects via JavaScript, the state is never registered.
        // This cookie survives the OIDC round-trip and identifies the session on callback.
        res.cookie("opkssh_request_id", requestId, {
          path: "/host/",
          httpOnly: true,
          sameSite: "lax",
          maxAge: 5 * 60 * 1000,
        });

        const contentType = String(response.headers["content-type"] || "");
        if (contentType.includes("text/html")) {
          const html = rewriteOPKSSHHtml(
            response.data.toString("utf-8"),
            requestId,
            "opkssh-chooser",
          );
          res.status(response.status).send(html);
        } else {
          res.status(response.status).send(response.data);
        }
      } catch (error) {
        sshLogger.error("Error proxying OPKSSH chooser", error, {
          operation: "opkssh_chooser_proxy_error",
          requestId,
        });
        res.status(500).send(
          renderOpksshErrorPage({
            title: "Error",
            heading: "Error",
            message: "Failed to load authentication page. Please try again.",
            requestId,
          }),
        );
      }
    },
  );

  /**
   * @openapi
   * /host/opkssh-callback:
   *   get:
   *     summary: Static OAuth callback from OIDC provider for OPKSSH authentication
   *     tags: [SSH]
   *     responses:
   *       200:
   *         description: Callback processed successfully
   *       404:
   *         description: No active authentication session found
   *       500:
   *         description: Authentication failed
   */
  router.get("/opkssh-callback", async (req: Request, res: Response) => {
    try {
      sshLogger.info("OAuth callback received", {
        operation: "opkssh_static_callback_received",
        host: req.headers.host,
      });

      const {
        getUserIdFromRequest,
        getActiveSessionsForUser,
        getActiveAuthSession,
        getRequestIdByOAuthState,
        clearOAuthState,
      } = await import("../../ssh/opkssh-auth.js");

      const userId = await getUserIdFromRequest({
        cookies: req.cookies,
        headers: req.headers as Record<string, string | undefined>,
      });

      sshLogger.info("User ID resolved", {
        operation: "opkssh_callback_user_lookup",
        userId: userId || "null",
        hasCookies: !!req.cookies?.jwt,
        cookieKeys: Object.keys(req.cookies || {}),
      });

      let userSessions: Awaited<ReturnType<typeof getActiveSessionsForUser>> =
        [];

      if (userId) {
        userSessions = getActiveSessionsForUser(userId);
      } else {
        // No JWT cookie (e.g. OAuth redirect landed in external browser).
        // Try to find the correct session via the OAuth state parameter.
        const oauthState = req.query.state as string | undefined;

        if (oauthState) {
          const mappedRequestId = getRequestIdByOAuthState(oauthState);
          if (mappedRequestId) {
            const mappedSession = getActiveAuthSession(mappedRequestId);
            if (mappedSession) {
              userSessions = [mappedSession];
              clearOAuthState(oauthState);
              sshLogger.info("Resolved session via OAuth state parameter", {
                operation: "opkssh_callback_state_lookup",
                requestId: mappedRequestId,
              });
            }
          }
        }

        // Fallback: use the opkssh_request_id cookie set by the chooser proxy.
        // State capture only works for 3xx redirects; if OPKSSH redirects via
        // JavaScript in the HTML, the state is never registered in the map.
        if (userSessions.length === 0) {
          const cookieRequestId = req.cookies?.opkssh_request_id;
          if (cookieRequestId) {
            const cookieSession = getActiveAuthSession(cookieRequestId);
            if (cookieSession) {
              userSessions = [cookieSession];
              res.clearCookie("opkssh_request_id", { path: "/host/" });
              sshLogger.info("Resolved session via opkssh_request_id cookie", {
                operation: "opkssh_callback_cookie_lookup",
                requestId: cookieRequestId,
              });
            }
          }
        }

        if (userSessions.length === 0) {
          sshLogger.warn(
            "OAuth callback with no JWT, no matching state, and no session cookie",
            {
              operation: "opkssh_callback_no_session_match",
              hasState: !!oauthState,
              hasCookie: !!req.cookies?.opkssh_request_id,
            },
          );
          res
            .status(401)
            .send("Authentication callback failed: unable to identify session");
          return;
        }
      }

      sshLogger.info("Active sessions for user", {
        operation: "opkssh_callback_session_lookup",
        userId,
        sessionCount: userSessions.length,
        sessions: userSessions.map((s) => ({
          requestId: s.requestId,
          status: s.status,
          hasCallbackPort: !!s.callbackPort,
          callbackPort: s.callbackPort,
          hasLocalPort: !!s.localPort,
          localPort: s.localPort,
        })),
      });

      if (userSessions.length === 0) {
        sshLogger.error("No active sessions for callback", {
          operation: "opkssh_callback_no_sessions",
          userId,
        });
        res.status(404).send("No active authentication session found");
        return;
      }

      const session = userSessions[userSessions.length - 1];

      if (!session.callbackPort) {
        sshLogger.error("Session callback port not ready", {
          operation: "opkssh_callback_port_not_ready",
          userId,
          requestId: session.requestId,
          sessionStatus: session.status,
          hasLocalPort: !!session.localPort,
        });
        res.status(503).send("OPKSSH callback listener not ready yet");
        return;
      }

      const queryString = req.url.includes("?")
        ? req.url.substring(req.url.indexOf("?"))
        : "";
      // OPKSSH's internal callback listener handles `/login-callback` regardless of the
      // path used in --remote-redirect-uri. The dynamic route below defaults to that path.
      const redirectUrl = `/host/opkssh-callback/${session.requestId}${queryString}`;

      sshLogger.info("Redirecting OAuth callback to dynamic route", {
        operation: "opkssh_static_callback_redirect",
        userId,
        requestId: session.requestId,
        callbackPort: session.callbackPort,
        queryParams: Object.keys(req.query),
        redirectUrl,
      });

      res.redirect(302, redirectUrl);
    } catch (error) {
      sshLogger.error("Error handling OPKSSH static callback", error, {
        operation: "opkssh_static_callback_error",
        url: req.url,
        originalUrl: req.originalUrl,
      });
      res.status(500).send("Authentication callback failed");
    }
  });

  /**
   * @openapi
   * /host/opkssh-callback/{requestId}:
   *   get:
   *     summary: OAuth callback from OIDC provider for OPKSSH authentication (handles all sub-paths)
   *     tags: [SSH]
   *     parameters:
   *       - name: requestId
   *         in: path
   *         required: true
   *         schema:
   *           type: string
   *         description: Authentication request ID
   *     responses:
   *       200:
   *         description: Callback processed successfully
   *       404:
   *         description: Invalid authentication session
   *       500:
   *         description: Authentication failed
   */
  router.use(
    "/opkssh-callback/:requestId",
    async (req: Request, res: Response) => {
      const requestId = Array.isArray(req.params.requestId)
        ? req.params.requestId[0]
        : req.params.requestId;

      try {
        const { getActiveAuthSession } =
          await import("../../ssh/opkssh-auth.js");
        const session = getActiveAuthSession(requestId);

        if (!session) {
          res.status(404).send(
            renderOpksshErrorPage({
              title: "Session Not Found",
              heading: "Session Not Found",
              message:
                "Authentication session expired or invalid. Please close this window and try again.",
              requestId,
            }),
          );
          return;
        }

        const axios = (await import("axios")).default;
        const fullPath = req.originalUrl || req.url;
        const pathAfterRequestId =
          fullPath.split(`/host/opkssh-callback/${requestId}`)[1] || "";
        // pathAfterRequestId may be "", "?query=...", "/subpath", or "/subpath?query=..."
        // OPKSSH's internal listener serves /login-callback, so when no sub-path is present
        // (query-only or empty), prepend it.
        const targetPath =
          pathAfterRequestId === "" || pathAfterRequestId.startsWith("?")
            ? `/login-callback${pathAfterRequestId}`
            : pathAfterRequestId;

        if (!session.callbackPort || session.callbackPort === 0) {
          sshLogger.error("OPKSSH callback session has no callback port", {
            operation: "opkssh_callback_proxy",
            requestId,
            sessionStatus: session.status,
          });
          res.status(500).send(
            renderOpksshErrorPage({
              title: "Error",
              heading: "Callback Error",
              message:
                "OPKSSH callback listener not ready. Please try authenticating again.",
              requestId,
            }),
          );
          return;
        }

        const targetUrl = `http://127.0.0.1:${session.callbackPort}${targetPath}`;

        const response = await axios({
          method: req.method,
          url: targetUrl,
          headers: {
            ...req.headers,
            host: `127.0.0.1:${session.callbackPort}`,
          },
          data: req.body,
          timeout: 10000,
          validateStatus: () => true,
          maxRedirects: 0,
          responseType: "arraybuffer",
        });

        Object.entries(response.headers).forEach(([key, value]) => {
          if (key.toLowerCase() === "transfer-encoding") {
            return;
          }
          if (key.toLowerCase() === "location") {
            const location = value as string;
            if (location.startsWith("/")) {
              res.setHeader(
                key,
                `/host/opkssh-callback/${requestId}${location}`,
              );
            } else {
              res.setHeader(key, value as string);
            }
          } else {
            res.setHeader(key, value as string);
          }
        });

        const contentType = String(response.headers["content-type"] || "");
        if (contentType.includes("text/html")) {
          const html = rewriteOPKSSHHtml(
            response.data.toString("utf-8"),
            requestId,
            "opkssh-callback",
          );
          res.status(response.status).send(html);
        } else {
          res.status(response.status).send(response.data);
        }
      } catch (error) {
        sshLogger.error("Error handling OPKSSH OAuth callback", error, {
          operation: "opkssh_oauth_callback_error",
          requestId,
        });

        res.status(500).send(
          renderOpksshErrorPage({
            title: "Error",
            heading: "Error",
            message: "An unexpected error occurred. Please try again.",
            requestId,
          }),
        );
      }
    },
  );
}
