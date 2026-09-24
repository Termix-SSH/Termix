import crypto from "node:crypto";
import type { Request, Response, Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import type { AutomationDefinition } from "../types.js";
import { computeNextDueAt } from "./cron.js";
import type { Deps } from "./deps.js";
import type { AutomationEngine } from "./engine.js";
import type { AutomationRepository, AutomationRow } from "./repository.js";
import { missingPlugins, parseDefinition } from "./requirements.js";
import { isNonEmptyString, validateDefinition } from "./validate.js";

export interface RouteDeps {
  ctx: PluginContext;
  repository: AutomationRepository;
  engine: Pick<AutomationEngine, "run">;
  deps: Deps;
}

function parseId(raw: unknown): number | null {
  const id = typeof raw === "string" ? parseInt(raw, 10) : NaN;
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a || "", "utf8");
  const right = Buffer.from(b || "", "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/**
 * The wire shape of an automation: the definition parsed, the webhook token
 * hash blanked, and the plugins it needs that are not running.
 */
export function serializeAutomation(row: AutomationRow, deps: Deps) {
  let definition: AutomationDefinition | null = parseDefinition(row.definition);
  if (definition?.trigger?.kind === "webhook") {
    definition = {
      ...definition,
      trigger: { ...definition.trigger, tokenHash: "" },
    };
  }
  return {
    ...row,
    definition,
    missingPlugins: missingPlugins(definition, deps),
  };
}

export async function syncSchedule(
  repository: AutomationRepository,
  automationId: number,
  definition: AutomationDefinition,
): Promise<void> {
  if (definition.trigger?.kind !== "schedule") {
    await repository.deleteSchedule(automationId);
    return;
  }
  const trigger = definition.trigger;
  await repository.upsertSchedule({
    automationId,
    cron: trigger.cron ?? null,
    intervalSeconds: trigger.intervalSeconds ?? null,
    timezone: trigger.timezone ?? null,
    nextDueAt: computeNextDueAt({
      cron: trigger.cron,
      intervalSeconds: trigger.intervalSeconds,
      timezone: trigger.timezone,
    }),
  });
}

export function registerRoutes(
  router: Router,
  { ctx, repository, engine, deps }: RouteDeps,
): void {
  const actor = () => ctx.currentActor() as string;
  const fail = (res: Response, message: string, error: unknown) => {
    ctx.log.error(
      message,
      error instanceof Error ? error : new Error(String(error)),
    );
    res.status(500).json({ error: message });
  };
  const audit = (
    action: string,
    id: number,
    name: string | undefined,
    success = true,
    details?: string,
  ) =>
    ctx.audit.record({
      action,
      resourceType: "automation",
      resourceId: String(id),
      resourceName: name,
      details,
      success,
    });

  /**
   * @openapi
   * /plugin-api/automations/webhook/{token}:
   *   post:
   *     summary: Trigger an automation from an external system
   *     description: Unauthenticated by design; the 32-byte token in the path is the credential and is compared against a stored hash in constant time.
   *     tags:
   *       - Automations
   *     parameters:
   *       - in: path
   *         name: token
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       202:
   *         description: The run was accepted.
   *       404:
   *         description: No automation matches that token.
   */
  router.post("/webhook/:token", async (req: Request, res: Response) => {
    const token = req.params.token;
    if (!isNonEmptyString(token) || token.length < 32) {
      return res.status(404).json({ error: "Not found" });
    }

    try {
      const wanted = hashToken(token);
      const match = (await repository.listAllEnabled()).find((row) => {
        const definition = parseDefinition(row.definition);
        if (definition?.trigger?.kind !== "webhook") return false;
        return timingSafeEqual(definition.trigger.tokenHash, wanted);
      });
      if (!match) return res.status(404).json({ error: "Not found" });

      const outcome = await engine.run({
        automationId: match.id,
        triggerType: "webhook",
        triggerContext: {
          body: req.body ?? {},
          receivedAt: new Date().toISOString(),
        },
      });
      res.status(202).json({ runId: outcome.runId, status: outcome.status });
    } catch (error) {
      fail(res, "Failed to run automation", error);
    }
  });

  /**
   * @openapi
   * /plugin-api/automations:
   *   get:
   *     summary: List the current user's automations
   *     description: Returns every automation the caller owns, with its parsed definition, linked notification channels and the plugins it needs that are not running.
   *     tags:
   *       - Automations
   *     responses:
   *       200:
   *         description: List of automations.
   *       403:
   *         description: Missing the automations.view permission.
   */
  router.get(
    "/",
    ctx.rbac.require("view") as never,
    async (_req: Request, res: Response) => {
      try {
        const rows = await repository.list(actor());
        res.json(rows.map((row) => serializeAutomation(row, deps)));
      } catch (error) {
        fail(res, "Failed to list automations", error);
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/automations/editor-options:
   *   get:
   *     summary: What the automation editor can offer
   *     description: The caller's hosts, snippets, fleets and notification channels, and which optional plugins are running, so the editor only offers triggers and steps it can run.
   *     tags:
   *       - Automations
   *     responses:
   *       200:
   *         description: Lookup lists and the running providers.
   *       403:
   *         description: Missing the automations.view permission.
   */
  router.get(
    "/editor-options",
    ctx.rbac.require("view") as never,
    async (_req: Request, res: Response) => {
      const userId = actor();
      const settle = async <T>(fn: () => Promise<T>, fallback: T) => {
        try {
          return await fn();
        } catch {
          return fallback;
        }
      };
      const snippets = deps.snippets();
      const fleets = deps.fleets();

      const [hosts, snippetList, fleetList, channels] = await Promise.all([
        settle(() => ctx.hosts.list(), []),
        settle(
          async () =>
            typeof snippets.list === "function" ? snippets.list() : [],
          [],
        ),
        settle(
          async () => (typeof fleets.list === "function" ? fleets.list() : []),
          [],
        ),
        settle(() => ctx.notify.channels(), []),
      ]);

      res.json({
        hosts: hosts
          .filter((host) => host.userId === userId)
          .map((host) => ({ id: host.id, name: host.name || host.ip })),
        snippets: snippetList
          .filter((snippet) => !snippet.isNote)
          .map((snippet) => ({ id: snippet.id, name: snippet.name })),
        fleets: fleetList.map((fleet) => ({ id: fleet.id, name: fleet.name })),
        channels: channels.map((channel) => ({
          id: channel.id,
          name: channel.name,
        })),
        providers: deps.providers(),
      });
    },
  );

  /**
   * @openapi
   * /plugin-api/automations/runs/history:
   *   get:
   *     summary: List automation runs
   *     tags:
   *       - Automations
   *     parameters:
   *       - in: query
   *         name: automationId
   *         schema:
   *           type: integer
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *       - in: query
   *         name: offset
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Recent runs, newest first.
   */
  router.get(
    "/runs/history",
    ctx.rbac.require("view") as never,
    async (req: Request, res: Response) => {
      try {
        res.json(
          await repository.listRuns(actor(), {
            automationId: parseId(req.query.automationId) ?? undefined,
            limit: Number(req.query.limit) || 50,
            offset: Number(req.query.offset) || 0,
          }),
        );
      } catch (error) {
        fail(res, "Failed to list runs", error);
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/automations/runs/{runId}/steps:
   *   get:
   *     summary: Step-by-step results for a run
   *     tags:
   *       - Automations
   *     parameters:
   *       - in: path
   *         name: runId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: The run's steps in order.
   *       404:
   *         description: Run not found.
   */
  router.get(
    "/runs/:runId/steps",
    ctx.rbac.require("view") as never,
    async (req: Request, res: Response) => {
      const runId = parseId(req.params.runId);
      if (runId === null) return res.status(400).json({ error: "Invalid id" });
      try {
        const run = await repository.findRunForUser(runId, actor());
        if (!run) return res.status(404).json({ error: "Run not found" });
        res.json(await repository.listRunSteps(runId));
      } catch (error) {
        fail(res, "Failed to list run steps", error);
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/automations/{id}:
   *   get:
   *     summary: Fetch a single automation
   *     tags:
   *       - Automations
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: The automation.
   *       404:
   *         description: Automation not found.
   */
  router.get(
    "/:id",
    ctx.rbac.require("view") as never,
    async (req: Request, res: Response) => {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ error: "Invalid id" });
      try {
        const row = await repository.findForUser(id, actor());
        if (!row)
          return res.status(404).json({ error: "Automation not found" });
        res.json(serializeAutomation(row, deps));
      } catch (error) {
        fail(res, "Failed to fetch automation", error);
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/automations:
   *   post:
   *     summary: Create an automation
   *     description: Validates the trigger and every step before storing the definition. A schedule trigger also registers its next due time, and a webhook trigger returns its token once.
   *     tags:
   *       - Automations
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               name:
   *                 type: string
   *               definition:
   *                 type: object
   *     responses:
   *       201:
   *         description: The created automation.
   *       400:
   *         description: Validation failed.
   */
  router.post(
    "/",
    ctx.rbac.require("create") as never,
    async (req: Request, res: Response) => {
      const userId = actor();
      const { name, description, enabled, definition, concurrencyPolicy } =
        req.body ?? {};

      if (!isNonEmptyString(name)) {
        return res.status(400).json({ error: "Name is required" });
      }
      const validated = validateDefinition(definition);
      if (!validated.ok || !validated.definition) {
        return res.status(400).json({ error: validated.error });
      }

      // A webhook trigger's token is shown once here and only stored hashed.
      let webhookToken: string | undefined;
      if (validated.definition.trigger.kind === "webhook") {
        webhookToken = crypto.randomBytes(32).toString("hex");
        validated.definition = {
          ...validated.definition,
          trigger: { kind: "webhook", tokenHash: hashToken(webhookToken) },
        };
      }

      try {
        const created = await repository.create({
          userId,
          name: name.trim(),
          description: description ?? null,
          enabled: enabled !== false,
          definition: JSON.stringify(validated.definition),
          concurrencyPolicy,
          channels: Array.isArray(req.body?.channels) ? req.body.channels : [],
        });
        await syncSchedule(repository, created.id, validated.definition);
        await audit("create_automation", created.id, created.name);
        res
          .status(201)
          .json({ ...serializeAutomation(created, deps), webhookToken });
      } catch (error) {
        fail(res, "Failed to create automation", error);
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/automations/{id}:
   *   put:
   *     summary: Update an automation
   *     tags:
   *       - Automations
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: The updated automation.
   *       400:
   *         description: Validation failed.
   *       404:
   *         description: Automation not found.
   */
  router.put(
    "/:id",
    ctx.rbac.require("edit") as never,
    async (req: Request, res: Response) => {
      const userId = actor();
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ error: "Invalid id" });

      try {
        const existing = await repository.findForUser(id, userId);
        if (!existing) {
          return res.status(404).json({ error: "Automation not found" });
        }

        const update: Parameters<AutomationRepository["update"]>[2] = {};
        if (req.body?.name !== undefined) {
          if (!isNonEmptyString(req.body.name)) {
            return res.status(400).json({ error: "Name cannot be empty" });
          }
          update.name = req.body.name.trim();
        }
        if (req.body?.description !== undefined) {
          update.description = req.body.description;
        }
        if (req.body?.enabled !== undefined)
          update.enabled = !!req.body.enabled;
        if (req.body?.concurrencyPolicy !== undefined) {
          update.concurrencyPolicy = req.body.concurrencyPolicy;
        }
        if (Array.isArray(req.body?.channels)) {
          update.channels = req.body.channels;
        }

        let parsedDefinition: AutomationDefinition | null = null;
        if (req.body?.definition !== undefined) {
          const validated = validateDefinition(req.body.definition);
          if (!validated.ok || !validated.definition) {
            return res.status(400).json({ error: validated.error });
          }
          // Keep the stored token hash: the raw token is only shown once.
          if (validated.definition.trigger.kind === "webhook") {
            const previous = parseDefinition(existing.definition);
            validated.definition = {
              ...validated.definition,
              trigger: {
                kind: "webhook",
                tokenHash:
                  previous?.trigger?.kind === "webhook"
                    ? previous.trigger.tokenHash
                    : "",
              },
            };
          }
          parsedDefinition = validated.definition;
          update.definition = JSON.stringify(validated.definition);
        }

        const updated = await repository.update(id, userId, update);
        if (!updated) {
          return res.status(404).json({ error: "Automation not found" });
        }
        if (parsedDefinition) {
          await syncSchedule(repository, id, parsedDefinition);
        }
        await audit("update_automation", id, updated.name);
        res.json(serializeAutomation(updated, deps));
      } catch (error) {
        fail(res, "Failed to update automation", error);
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/automations/{id}:
   *   delete:
   *     summary: Delete an automation
   *     tags:
   *       - Automations
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Deleted.
   *       404:
   *         description: Automation not found.
   */
  router.delete(
    "/:id",
    ctx.rbac.require("delete") as never,
    async (req: Request, res: Response) => {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ error: "Invalid id" });
      try {
        const deleted = await repository.delete(id, actor());
        if (!deleted) {
          return res.status(404).json({ error: "Automation not found" });
        }
        await audit("delete_automation", id, undefined);
        res.json({ success: true });
      } catch (error) {
        fail(res, "Failed to delete automation", error);
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/automations/{id}/run:
   *   post:
   *     summary: Run an automation now
   *     description: Runs immediately, as the automation's owner. Pass dryRun to record what each step would do without touching anything outside Termix. An automation that needs a plugin that is off is recorded as skipped.
   *     tags:
   *       - Automations
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               dryRun:
   *                 type: boolean
   *     responses:
   *       200:
   *         description: The run outcome.
   *       404:
   *         description: Automation not found.
   */
  router.post(
    "/:id/run",
    ctx.rbac.require("run") as never,
    async (req: Request, res: Response) => {
      const userId = actor();
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ error: "Invalid id" });

      try {
        const existing = await repository.findForUser(id, userId);
        if (!existing) {
          return res.status(404).json({ error: "Automation not found" });
        }
        const dryRun = req.body?.dryRun === true;
        const outcome = await engine.run({
          automationId: id,
          triggerType: "manual",
          triggerContext: { manual: true, requestedBy: userId },
          dryRun,
        });
        await audit(
          "run_automation",
          id,
          existing.name,
          outcome.status === "success",
          JSON.stringify({ status: outcome.status, dryRun }),
        );
        res.json(outcome);
      } catch (error) {
        fail(res, "Failed to run automation", error);
      }
    },
  );
}
