import crypto from "node:crypto";
import express from "express";
import type { Request, Response } from "express";
import type { AuthenticatedRequest } from "../../../types/index.js";
import type {
  AutomationDefinition,
  Step,
  Trigger,
} from "../../../types/automations.js";
import { AUTOMATION_DEFINITION_VERSION } from "../../../types/automations.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { databaseLogger } from "../../utils/logger.js";
import {
  getAuditUsername,
  getRequestMeta,
  logAudit,
} from "../../utils/audit-logger.js";
import { createCurrentAutomationRepository } from "../repositories/factory.js";
import type { AutomationRow } from "../repositories/automation-repository.js";
import { AutomationEngine } from "../../automations/engine.js";
import { computeNextDueAt, isValidCron } from "../../automations/cron.js";

const router = express.Router();

const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const requireDataAccess = authManager.createDataAccessMiddleware();

const TRIGGER_KINDS = new Set([
  "metric_threshold",
  "host_status",
  "health_check",
  "schedule",
  "docker_event",
  "internal_event",
  "webhook",
]);

const STEP_TYPES = new Set([
  "notify",
  "http",
  "run_snippet",
  "run_command",
  "docker",
  "tunnel",
  "wol",
  "wait",
  "set_var",
  "if",
  "run_automation",
  "stop",
]);

const OPERATORS = new Set([
  ">",
  "<",
  ">=",
  "<=",
  "==",
  "!=",
  "contains",
  "not_contains",
  "changed",
]);

function parseId(raw: unknown): number | null {
  const id = typeof raw === "string" ? parseInt(raw, 10) : NaN;
  return Number.isInteger(id) && id > 0 ? id : null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validates a definition before it is stored. The engine treats the stored
 * blob as trusted, so everything it relies on is checked once here.
 */
function validateDefinition(value: unknown): {
  ok: boolean;
  error?: string;
  definition?: AutomationDefinition;
} {
  if (typeof value !== "object" || value === null) {
    return { ok: false, error: "Definition must be an object" };
  }

  const candidate = value as Partial<AutomationDefinition>;
  const trigger = candidate.trigger as Trigger | undefined;

  if (!trigger || !TRIGGER_KINDS.has(trigger.kind)) {
    return { ok: false, error: "Unknown or missing trigger kind" };
  }

  if (trigger.kind === "metric_threshold") {
    if (!OPERATORS.has(trigger.operator)) {
      return { ok: false, error: "Unknown comparison operator" };
    }
    if (typeof trigger.value !== "number" || !Number.isFinite(trigger.value)) {
      return { ok: false, error: "Threshold value must be a number" };
    }
    if (!trigger.metric?.path) {
      return { ok: false, error: "Trigger is missing a metric" };
    }
  }

  if (trigger.kind === "schedule") {
    const hasInterval =
      typeof trigger.intervalSeconds === "number" &&
      trigger.intervalSeconds > 0;
    const hasCron = isNonEmptyString(trigger.cron);
    if (!hasInterval && !hasCron) {
      return { ok: false, error: "Schedule needs an interval or a cron" };
    }
    if (hasCron && !isValidCron(trigger.cron as string)) {
      return { ok: false, error: "Cron expression is not valid" };
    }
    if (hasInterval && (trigger.intervalSeconds as number) < 60) {
      return { ok: false, error: "Interval must be at least 60 seconds" };
    }
  }

  const steps = candidate.steps;
  if (!Array.isArray(steps)) {
    return { ok: false, error: "Definition must include a steps array" };
  }

  const seen = new Set<string>();
  const stepError = validateSteps(steps as Step[], seen);
  if (stepError) return { ok: false, error: stepError };

  return {
    ok: true,
    definition: {
      version: candidate.version ?? AUTOMATION_DEFINITION_VERSION,
      trigger,
      steps: steps as Step[],
    },
  };
}

function validateSteps(steps: Step[], seen: Set<string>): string | null {
  for (const step of steps) {
    if (!step || typeof step !== "object") return "Step must be an object";
    if (!isNonEmptyString(step.id)) return "Every step needs an id";
    if (seen.has(step.id)) return `Duplicate step id: ${step.id}`;
    seen.add(step.id);
    if (!STEP_TYPES.has(step.type)) {
      return `Unknown step type: ${step.type}`;
    }

    if (step.type === "if") {
      if (!step.condition || !OPERATORS.has(step.condition.operator)) {
        return "Condition needs a valid operator";
      }
      const thenError = validateSteps(step.then ?? [], seen);
      if (thenError) return thenError;
      const elseError = validateSteps(step.else ?? [], seen);
      if (elseError) return elseError;
    }

    if (step.type === "http" && !isNonEmptyString(step.url)) {
      return "HTTP steps need a URL";
    }
    if (step.type === "run_command" && !isNonEmptyString(step.command)) {
      return "Command steps need a command";
    }
    if (step.type === "wait" && typeof step.seconds !== "number") {
      return "Wait steps need a number of seconds";
    }
    if (step.type === "set_var" && !isNonEmptyString(step.name)) {
      return "Variable steps need a name";
    }
  }
  return null;
}

/** Never leak a webhook token hash to the client. */
function serialize(row: AutomationRow) {
  let definition: AutomationDefinition | null = null;
  try {
    definition = JSON.parse(row.definition) as AutomationDefinition;
  } catch {
    definition = null;
  }

  if (definition?.trigger?.kind === "webhook") {
    definition = {
      ...definition,
      trigger: { ...definition.trigger, tokenHash: "" },
    };
  }

  return { ...row, definition };
}

async function syncSchedule(
  automationId: number,
  definition: AutomationDefinition,
): Promise<void> {
  const repository = createCurrentAutomationRepository();
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
    }),
  });
}

/**
 * @openapi
 * /automations:
 *   get:
 *     summary: List the current user's automations
 *     description: Returns every automation the caller owns, with its parsed definition and linked notification channels.
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
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    try {
      const rows = await createCurrentAutomationRepository().list(userId);
      res.json(rows.map(serialize));
    } catch (error) {
      databaseLogger.error("Failed to list automations", error, {
        operation: "automation_list_error",
        userId,
      });
      res.status(500).json({ error: "Failed to list automations" });
    }
  },
);

/**
 * @openapi
 * /automations/{id}:
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
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "Invalid id" });

    try {
      const row = await createCurrentAutomationRepository().findForUser(
        id,
        userId,
      );
      if (!row) return res.status(404).json({ error: "Automation not found" });
      res.json(serialize(row));
    } catch (error) {
      databaseLogger.error("Failed to fetch automation", error, {
        operation: "automation_get_error",
        userId,
      });
      res.status(500).json({ error: "Failed to fetch automation" });
    }
  },
);

/**
 * @openapi
 * /automations:
 *   post:
 *     summary: Create an automation
 *     description: Validates the trigger and every step before storing the definition. A schedule trigger also registers its next due time.
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
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
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
        trigger: {
          kind: "webhook",
          tokenHash: hashToken(webhookToken),
        },
      };
    }

    try {
      const repository = createCurrentAutomationRepository();
      const created = await repository.create({
        userId,
        name: name.trim(),
        description: description ?? null,
        enabled: enabled !== false,
        definition: JSON.stringify(validated.definition),
        concurrencyPolicy,
        channels: Array.isArray(req.body?.channels) ? req.body.channels : [],
      });

      await syncSchedule(created.id, validated.definition);

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: await getAuditUsername(userId),
        action: "create_automation",
        resourceType: "automation",
        resourceId: String(created.id),
        resourceName: created.name,
        ipAddress,
        userAgent,
        success: true,
      });

      res.status(201).json({ ...serialize(created), webhookToken });
    } catch (error) {
      databaseLogger.error("Failed to create automation", error, {
        operation: "automation_create_error",
        userId,
      });
      res.status(500).json({ error: "Failed to create automation" });
    }
  },
);

/**
 * @openapi
 * /automations/{id}:
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
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "Invalid id" });

    const repository = createCurrentAutomationRepository();
    const existing = await repository.findForUser(id, userId);
    if (!existing) {
      return res.status(404).json({ error: "Automation not found" });
    }

    const update: Record<string, unknown> = {};
    if (req.body?.name !== undefined) {
      if (!isNonEmptyString(req.body.name)) {
        return res.status(400).json({ error: "Name cannot be empty" });
      }
      update.name = req.body.name.trim();
    }
    if (req.body?.description !== undefined) {
      update.description = req.body.description;
    }
    if (req.body?.enabled !== undefined) update.enabled = !!req.body.enabled;
    if (req.body?.concurrencyPolicy !== undefined) {
      update.concurrencyPolicy = req.body.concurrencyPolicy;
    }
    if (Array.isArray(req.body?.channels)) update.channels = req.body.channels;

    let parsedDefinition: AutomationDefinition | null = null;
    if (req.body?.definition !== undefined) {
      const validated = validateDefinition(req.body.definition);
      if (!validated.ok || !validated.definition) {
        return res.status(400).json({ error: validated.error });
      }

      // Keep the stored token hash: the raw token is only ever shown once.
      if (validated.definition.trigger.kind === "webhook") {
        const previous = JSON.parse(
          existing.definition,
        ) as AutomationDefinition;
        const previousHash =
          previous.trigger?.kind === "webhook"
            ? previous.trigger.tokenHash
            : "";
        validated.definition = {
          ...validated.definition,
          trigger: { kind: "webhook", tokenHash: previousHash },
        };
      }

      parsedDefinition = validated.definition;
      update.definition = JSON.stringify(validated.definition);
    }

    try {
      const updated = await repository.update(id, userId, update);
      if (!updated) {
        return res.status(404).json({ error: "Automation not found" });
      }

      if (parsedDefinition) await syncSchedule(id, parsedDefinition);

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: await getAuditUsername(userId),
        action: "update_automation",
        resourceType: "automation",
        resourceId: String(id),
        resourceName: updated.name,
        ipAddress,
        userAgent,
        success: true,
      });

      res.json(serialize(updated));
    } catch (error) {
      databaseLogger.error("Failed to update automation", error, {
        operation: "automation_update_error",
        userId,
      });
      res.status(500).json({ error: "Failed to update automation" });
    }
  },
);

/**
 * @openapi
 * /automations/{id}:
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
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "Invalid id" });

    try {
      const deleted = await createCurrentAutomationRepository().delete(
        id,
        userId,
      );
      if (!deleted) {
        return res.status(404).json({ error: "Automation not found" });
      }

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: await getAuditUsername(userId),
        action: "delete_automation",
        resourceType: "automation",
        resourceId: String(id),
        ipAddress,
        userAgent,
        success: true,
      });

      res.json({ success: true });
    } catch (error) {
      databaseLogger.error("Failed to delete automation", error, {
        operation: "automation_delete_error",
        userId,
      });
      res.status(500).json({ error: "Failed to delete automation" });
    }
  },
);

/**
 * @openapi
 * /automations/{id}/run:
 *   post:
 *     summary: Run an automation now
 *     description: Runs immediately, as the automation's owner. Pass dryRun to record what each step would do without touching anything outside Termix.
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
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "Invalid id" });

    const existing = await createCurrentAutomationRepository().findForUser(
      id,
      userId,
    );
    if (!existing) {
      return res.status(404).json({ error: "Automation not found" });
    }

    try {
      const outcome = await AutomationEngine.getInstance().run({
        automationId: id,
        triggerType: "manual",
        triggerContext: { manual: true, requestedBy: userId },
        dryRun: req.body?.dryRun === true,
      });

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: await getAuditUsername(userId),
        action: "run_automation",
        resourceType: "automation",
        resourceId: String(id),
        resourceName: existing.name,
        details: JSON.stringify({
          status: outcome.status,
          dryRun: req.body?.dryRun === true,
        }),
        ipAddress,
        userAgent,
        success: outcome.status === "success",
      });

      res.json(outcome);
    } catch (error) {
      databaseLogger.error("Failed to run automation", error, {
        operation: "automation_run_error",
        userId,
      });
      res.status(500).json({ error: "Failed to run automation" });
    }
  },
);

/**
 * @openapi
 * /automations/runs:
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
 *     responses:
 *       200:
 *         description: Recent runs, newest first.
 */
router.get(
  "/runs/history",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    try {
      const runs = await createCurrentAutomationRepository().listRuns(userId, {
        automationId: parseId(req.query.automationId) ?? undefined,
        limit: Number(req.query.limit) || 50,
        offset: Number(req.query.offset) || 0,
      });
      res.json(runs);
    } catch (error) {
      databaseLogger.error("Failed to list automation runs", error, {
        operation: "automation_runs_error",
        userId,
      });
      res.status(500).json({ error: "Failed to list runs" });
    }
  },
);

/**
 * @openapi
 * /automations/runs/{runId}/steps:
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
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const runId = parseId(req.params.runId);
    if (runId === null) return res.status(400).json({ error: "Invalid id" });

    try {
      const repository = createCurrentAutomationRepository();
      const run = await repository.findRunForUser(runId, userId);
      if (!run) return res.status(404).json({ error: "Run not found" });

      res.json(await repository.listRunSteps(runId));
    } catch (error) {
      databaseLogger.error("Failed to list run steps", error, {
        operation: "automation_run_steps_error",
        userId,
      });
      res.status(500).json({ error: "Failed to list run steps" });
    }
  },
);

/**
 * @openapi
 * /automations/webhook/{token}:
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
    const repository = createCurrentAutomationRepository();
    const candidates = await repository.listAllEnabled();
    const wanted = hashToken(token);

    const match = candidates.find((row) => {
      try {
        const definition = JSON.parse(row.definition) as AutomationDefinition;
        if (definition.trigger?.kind !== "webhook") return false;
        return timingSafeEqual(definition.trigger.tokenHash, wanted);
      } catch {
        return false;
      }
    });

    if (!match) return res.status(404).json({ error: "Not found" });

    const outcome = await AutomationEngine.getInstance().run({
      automationId: match.id,
      triggerType: "webhook",
      triggerContext: {
        body: req.body ?? {},
        receivedAt: new Date().toISOString(),
      },
    });

    res.status(202).json({ runId: outcome.runId, status: outcome.status });
  } catch (error) {
    databaseLogger.error("Webhook automation failed", error, {
      operation: "automation_webhook_error",
    });
    res.status(500).json({ error: "Failed to run automation" });
  }
});

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a || "", "utf8");
  const right = Buffer.from(b || "", "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export default router;
