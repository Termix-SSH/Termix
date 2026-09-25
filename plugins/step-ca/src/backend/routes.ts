import type { Request, Response, Router } from "express";
import type { AuthSessions } from "./auth-session.js";

/**
 * The identity provider redirects here without a Termix session: the sign-in
 * may finish in another browser, so it is matched by the OAuth state.
 */
export const PUBLIC_PATHS = ["/callback"];

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function resultPage(ok: boolean, message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Termix</title>
<style>body{font-family:system-ui,sans-serif;background:#111;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
main{max-width:28rem;padding:2rem;border:1px solid #333;background:#181818}h1{font-size:1.1rem;margin:0 0 .5rem}p{margin:0;color:#aaa}</style></head>
<body><main><h1>${ok ? "Signed in" : "Sign-in failed"}</h1><p>${escapeHtml(message)}</p></main></body></html>`;
}

export function registerRoutes(router: Router, sessions: AuthSessions): void {
  /**
   * @openapi
   * /plugin-api/step-ca/callback:
   *   get:
   *     summary: OIDC callback for a Step CA sign-in
   *     description: Public. The redirect URI registered with the identity provider behind the CA's OIDC provisioner. Exchanges the code, has the CA sign the key and tells the terminal to reconnect. The 2.8 URI /host/step-ca-callback redirects here.
   *     tags: [Step CA]
   *     parameters:
   *       - name: state
   *         in: query
   *         schema:
   *           type: string
   *       - name: code
   *         in: query
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Signed in; an HTML page the browser can close.
   *       400:
   *         description: The sign-in failed or is no longer active.
   */
  router.get("/callback", async (req: Request, res: Response) => {
    const query = (name: string): string | undefined => {
      const value = req.query[name];
      return typeof value === "string" ? value : undefined;
    };
    const result = await sessions.complete({
      state: query("state"),
      code: query("code"),
      error: query("error"),
      error_description: query("error_description"),
    });
    res
      .status(result.ok ? 200 : 400)
      .type("html")
      .send(resultPage(result.ok, result.message));
  });
}
