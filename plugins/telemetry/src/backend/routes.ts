import type { Request, RequestHandler, Response, Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { isEnabled, readSettings } from "./collect.js";
import type { Reporter } from "./reporter.js";
import { sanitizeUsage, type UsageStore } from "./usage.js";

/** Whether the signed-in user's feature usage should be counted. */
export async function shouldTrackUser(
  ctx: PluginContext,
  userId: string | undefined,
  env?: Record<string, string | undefined>,
): Promise<boolean> {
  if (!userId) return false;
  const settings = await readSettings(ctx);
  if (!isEnabled(settings, env) || !settings.includeFeatureUsage) return false;
  return (await ctx.settings.getUser(userId, "shareFeatureUsage")) !== false;
}

export function registerRoutes(
  ctx: PluginContext,
  router: Router,
  reporter: Reporter,
  usage: UsageStore,
  env?: Record<string, string | undefined>,
): void {
  const manage = ctx.rbac.require("manage") as unknown as RequestHandler;

  /**
   * @openapi
   * /plugin-api/telemetry/status:
   *   get:
   *     summary: Usage statistics status
   *     description: Whether usage statistics are sent, whether ENABLE_TELEMETRY locks that, the instance ID and the last attempt.
   *     tags: [Usage Statistics]
   *     responses:
   *       200:
   *         description: Status.
   *       403:
   *         description: Missing the telemetry.manage permission.
   */
  router.get("/status", manage, async (_req: Request, res: Response) => {
    res.json(await reporter.status());
  });

  /**
   * @openapi
   * /plugin-api/telemetry/preview:
   *   get:
   *     summary: Preview the next report
   *     description: The exact event that would be sent right now, without the API key.
   *     tags: [Usage Statistics]
   *     responses:
   *       200:
   *         description: The event.
   *       403:
   *         description: Missing the telemetry.manage permission.
   */
  router.get("/preview", manage, async (_req: Request, res: Response) => {
    res.json(await reporter.preview());
  });

  /**
   * @openapi
   * /plugin-api/telemetry/send:
   *   post:
   *     summary: Send usage statistics now
   *     description: Sends the report straight away. Does nothing while usage statistics are turned off.
   *     tags: [Usage Statistics]
   *     responses:
   *       200:
   *         description: Whether a report was sent.
   *       403:
   *         description: Missing the telemetry.manage permission.
   *       502:
   *         description: The report could not be delivered.
   */
  router.post("/send", manage, async (_req: Request, res: Response) => {
    try {
      res.json(await reporter.send({ force: true }));
    } catch (error) {
      res.status(502).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * @openapi
   * /plugin-api/telemetry/reset-id:
   *   post:
   *     summary: Reset the instance ID
   *     description: Picks a new random instance ID, so later reports look like a new install.
   *     tags: [Usage Statistics]
   *     responses:
   *       200:
   *         description: The new ID.
   *       403:
   *         description: Missing the telemetry.manage permission.
   */
  router.post("/reset-id", manage, async (_req: Request, res: Response) => {
    res.json({ instanceId: await reporter.resetInstanceId() });
  });

  /**
   * @openapi
   * /plugin-api/telemetry/usage/config:
   *   get:
   *     summary: Whether to count this user's feature usage
   *     description: False when usage statistics or feature usage are off, or the user turned off their own part.
   *     tags: [Usage Statistics]
   *     responses:
   *       200:
   *         description: "{ track: boolean }"
   */
  router.get("/usage/config", async (_req: Request, res: Response) => {
    res.json({ track: await shouldTrackUser(ctx, ctx.currentActor(), env) });
  });

  /**
   * @openapi
   * /plugin-api/telemetry/usage:
   *   post:
   *     summary: Add feature usage counts
   *     description: Counts from the signed-in user's browser, added to the next report. Ignored when this user is not counted. Names and counts are checked and capped.
   *     tags: [Usage Statistics]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               features:
   *                 type: object
   *                 additionalProperties:
   *                   type: integer
   *     responses:
   *       204:
   *         description: Recorded or ignored.
   */
  router.post("/usage", async (req: Request, res: Response) => {
    if (await shouldTrackUser(ctx, ctx.currentActor(), env)) {
      const counts = sanitizeUsage(req.body?.features);
      if (Object.keys(counts).length > 0) await usage.add(counts);
    }
    res.status(204).end();
  });
}
