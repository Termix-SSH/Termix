import type { Request, RequestHandler, Response, Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { AcmeNotConfiguredError, type AcmeRunner } from "./runner.js";
import { missingSetting, readSettings } from "./settings.js";

export function registerRoutes(
  ctx: PluginContext,
  router: Router,
  runner: AcmeRunner,
): void {
  router.use(ctx.rbac.require("manage") as unknown as RequestHandler);

  /**
   * @openapi
   * /plugin-api/acme-ssl/status:
   *   get:
   *     summary: ACME certificate status
   *     description: The certificate core serves, whether ACME is configured, and the last issue attempt.
   *     tags: [ACME Certificates]
   *     responses:
   *       200:
   *         description: Status.
   *       403:
   *         description: Missing the acme-ssl.manage permission.
   */
  router.get("/status", async (_req: Request, res: Response) => {
    const settings = await readSettings(ctx);
    res.json({
      tls: await ctx.system.tlsStatus(),
      state: await runner.state(),
      autoRenew: settings.autoRenew,
      missing: missingSetting(settings),
    });
  });

  /**
   * @openapi
   * /plugin-api/acme-ssl/request:
   *   post:
   *     summary: Request a certificate now
   *     description: Runs an ACME order for the configured domain, installs the certificate and reloads HTTPS.
   *     tags: [ACME Certificates]
   *     responses:
   *       200:
   *         description: Certificate issued and installed.
   *       400:
   *         description: A required setting is missing.
   *       403:
   *         description: Missing the acme-ssl.manage permission.
   *       500:
   *         description: The ACME order failed.
   */
  router.post("/request", async (_req: Request, res: Response) => {
    try {
      const result = await runner.issue();
      res.json({
        success: true,
        reloadMessage: result.reload.message,
        tls: result.tls,
        state: await runner.state(),
      });
    } catch (error) {
      if (error instanceof AcmeNotConfiguredError) {
        return res
          .status(400)
          .json({ error: error.message, missing: error.field });
      }
      const message = error instanceof Error ? error.message : String(error);
      ctx.log.warn(`Certificate request failed: ${message}`);
      res.status(500).json({ error: `Certificate request failed: ${message}` });
    }
  });
}
