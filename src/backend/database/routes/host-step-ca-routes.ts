import type { Request, Response, Router } from "express";
import { escapeHtml } from "./opkssh-html.js";

function resultPage(ok: boolean, message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Termix</title>
<style>body{font-family:system-ui,sans-serif;background:#111;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
main{max-width:28rem;padding:2rem;border:1px solid #333;background:#181818}h1{font-size:1.1rem;margin:0 0 .5rem}p{margin:0;color:#aaa}</style></head>
<body><main><h1>${ok ? "Signed in" : "Sign-in failed"}</h1><p>${escapeHtml(message)}</p></main></body></html>`;
}

/**
 * The OIDC redirect target for Step CA sign-ins. Unauthenticated on purpose:
 * the browser that finishes the sign-in may not be the one running Termix,
 * so the request is matched to its session by the OAuth state.
 */
export function registerHostStepCaRoutes(router: Router): void {
  router.get("/step-ca-callback", async (req: Request, res: Response) => {
    const { completeStepCaAuth } = await import("../../hosts/step-ca-auth.js");
    const query = req.query as Record<string, string | undefined>;
    const result = await completeStepCaAuth({
      state: query.state,
      code: query.code,
      error: query.error,
      error_description: query.error_description,
    });
    res
      .status(result.ok ? 200 : 400)
      .type("html")
      .send(resultPage(result.ok, result.message));
  });
}
