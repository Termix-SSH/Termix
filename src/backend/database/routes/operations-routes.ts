import express, { type Request, type Response } from "express";
import type {
  ResourceListResult,
  SignalResult,
} from "@termix-ssh/plugin-sdk/operations";
import { AuthManager } from "../../utils/auth-manager.js";
import { PermissionManager } from "../../utils/permission-manager.js";
import { databaseLogger } from "../../utils/logger.js";
import { createCurrentOperationRepository } from "../repositories/factory.js";
import type { OperationRunRecord } from "../repositories/operation-repository.js";
import { buildCatalog } from "../../operations/catalog.js";
import {
  cancelOperationRun,
  decideOperationApproval,
  OperationError,
  runOperation,
} from "../../operations/gate.js";
import { getAction } from "../../operations/registry.js";
import {
  flattenResourceRows,
  readAcrossHosts,
} from "../../operations/resources.js";
import type { ActorOrigin } from "../../plugins/actor.js";

const router = express.Router();
const authenticateJWT = AuthManager.getInstance().createAuthMiddleware();
const permissions = PermissionManager.getInstance();

/** Sees every run on the server, not only their own. */
export const VIEW_ALL_RUNS = "admin.operations.view";

type OperationsRequest = Request & {
  userId: string;
  apiKeyId?: string;
  apiKeyScopes?: string[] | null;
  actingAdminUserId?: string;
};

function originOf(req: OperationsRequest): ActorOrigin {
  return { kind: req.apiKeyId ? "api" : "ui" };
}

function sendError(res: Response, error: unknown, operation: string): void {
  if (error instanceof OperationError) {
    res.status(error.status).json({
      error: error.message,
      code: error.code,
      details: error.details,
    });
    return;
  }
  databaseLogger.error("Operations route failed", error, { operation });
  res.status(500).json({ error: "Request failed" });
}

function parseJson(text: string | null): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Never includes the sealed input. */
function publicRun(run: OperationRunRecord) {
  return {
    id: run.id,
    actionId: run.actionId,
    pluginId: run.pluginId,
    pluginVersion: run.pluginVersion,
    userId: run.userId,
    username: run.username,
    origin: parseJson(run.origin),
    hostId: run.hostId,
    hostName: run.hostName,
    batchId: run.batchId,
    dryRun: run.dryRun,
    risk: run.risk,
    status: run.status,
    summary: run.summary,
    changed: run.changed,
    input: parseJson(run.input),
    output: parseJson(run.output),
    undoAvailable: run.undoInput !== null,
    error: run.error,
    errorCode: run.errorCode,
    undoOf: run.undoOf,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}

async function canSeeRun(
  run: OperationRunRecord,
  userId: string,
): Promise<boolean> {
  if (run.userId === userId) return true;
  if (await permissions.hasPermission(userId, VIEW_ALL_RUNS)) return true;
  if (run.hostId === null) return false;
  const access = await permissions.canAccessHost(userId, run.hostId, "manage");
  return access.hasAccess;
}

function hostIdsFrom(value: unknown): number[] | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  const ids = value
    .split(",")
    .map(Number)
    .filter((id) => Number.isInteger(id));
  return ids.length > 0 ? ids : undefined;
}

function limitFrom(value: unknown): number | undefined {
  const limit = Number(value);
  return Number.isInteger(limit) && limit > 0 ? limit : undefined;
}

/**
 * @openapi
 * /operations/catalog:
 *   get:
 *     summary: List what this user can do
 *     description: Every action, event, resource and signal from running plugins that the caller has permission for, with titles in the requested language.
 *     tags:
 *       - Operations
 *     parameters:
 *       - in: query
 *         name: lang
 *         schema:
 *           type: string
 *       - in: query
 *         name: surface
 *         schema:
 *           type: string
 *           enum: [assistant, mcp, palette, automations, mobile, cli]
 *     responses:
 *       200:
 *         description: The catalog.
 */
router.get("/catalog", authenticateJWT, async (req, res) => {
  const { userId } = req as OperationsRequest;
  try {
    res.json(
      await buildCatalog({
        userId,
        lang: typeof req.query.lang === "string" ? req.query.lang : undefined,
        surface:
          typeof req.query.surface === "string"
            ? (req.query.surface as never)
            : undefined,
      }),
    );
  } catch (error) {
    sendError(res, error, "operations_catalog");
  }
});

/**
 * @openapi
 * /operations/catalog/{id}:
 *   get:
 *     summary: Describe one action
 *     tags:
 *       - Operations
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: The action.
 *       404:
 *         description: No such action, or the caller may not use it.
 */
router.get("/catalog/:id", authenticateJWT, async (req, res) => {
  const { userId } = req as OperationsRequest;
  try {
    const catalog = await buildCatalog({
      userId,
      lang: typeof req.query.lang === "string" ? req.query.lang : undefined,
    });
    const action = catalog.actions.find((entry) => entry.id === req.params.id);
    if (!action) {
      res.status(404).json({ error: "Action not found" });
      return;
    }
    res.json(action);
  } catch (error) {
    sendError(res, error, "operations_catalog_action");
  }
});

/**
 * @openapi
 * /operations/runs:
 *   get:
 *     summary: List runs
 *     description: The caller's own runs, runs on hosts they manage, or every run with the view permission.
 *     tags:
 *       - Operations
 *     parameters:
 *       - in: query
 *         name: hostId
 *         schema:
 *           type: integer
 *       - in: query
 *         name: actionId
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *       - in: query
 *         name: batchId
 *         schema:
 *           type: string
 *       - in: query
 *         name: before
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Runs, newest first.
 */
router.get("/runs", authenticateJWT, async (req, res) => {
  const { userId } = req as OperationsRequest;
  try {
    const viewAll = await permissions.hasPermission(userId, VIEW_ALL_RUNS);
    const hostId = limitFrom(req.query.hostId);
    let managed = false;
    if (!viewAll && hostId !== undefined) {
      managed = (await permissions.canAccessHost(userId, hostId, "manage"))
        .hasAccess;
    }
    const runs = await createCurrentOperationRepository().listRuns(
      {
        userId: viewAll || managed ? undefined : userId,
        hostId,
        actionId:
          typeof req.query.actionId === "string"
            ? req.query.actionId
            : undefined,
        status:
          typeof req.query.status === "string" ? req.query.status : undefined,
        batchId:
          typeof req.query.batchId === "string" ? req.query.batchId : undefined,
        before:
          typeof req.query.before === "string" ? req.query.before : undefined,
      },
      limitFrom(req.query.limit),
    );
    res.json({ runs: runs.map(publicRun) });
  } catch (error) {
    sendError(res, error, "operations_runs");
  }
});

/**
 * @openapi
 * /operations/runs/{id}:
 *   get:
 *     summary: Get a run
 *     tags:
 *       - Operations
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: The run.
 *       404:
 *         description: Not found, or not visible to the caller.
 */
router.get("/runs/:id", authenticateJWT, async (req, res) => {
  const { userId } = req as OperationsRequest;
  try {
    const run = await createCurrentOperationRepository().findRun(
      String(req.params.id),
    );
    if (!run || !(await canSeeRun(run, userId))) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    res.json(publicRun(run));
  } catch (error) {
    sendError(res, error, "operations_run");
  }
});

/**
 * @openapi
 * /operations/runs/{id}/cancel:
 *   post:
 *     summary: Cancel a run
 *     description: Stops a running action, or withdraws one waiting for approval.
 *     tags:
 *       - Operations
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Whether anything was cancelled.
 *       404:
 *         description: Not found, or not visible to the caller.
 */
router.post("/runs/:id/cancel", authenticateJWT, async (req, res) => {
  const { userId } = req as OperationsRequest;
  try {
    const run = await createCurrentOperationRepository().findRun(
      String(req.params.id),
    );
    if (!run || !(await canSeeRun(run, userId))) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    res.json({ cancelled: await cancelOperationRun(run) });
  } catch (error) {
    sendError(res, error, "operations_cancel");
  }
});

/**
 * @openapi
 * /operations/runs/{id}/undo:
 *   post:
 *     summary: Undo a run
 *     description: Runs the action's undo with the input the run recorded. It goes through the same checks as any run.
 *     tags:
 *       - Operations
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: The new run.
 *       404:
 *         description: Not found, or nothing to undo.
 */
router.post("/runs/:id/undo", authenticateJWT, async (req, res) => {
  const authReq = req as OperationsRequest;
  try {
    const run = await createCurrentOperationRepository().findRun(
      String(req.params.id),
    );
    const undo = run ? getAction(run.actionId)?.action.undo : undefined;
    if (
      !run ||
      !undo ||
      !run.undoInput ||
      !(await canSeeRun(run, authReq.userId))
    ) {
      res.status(404).json({ error: "Nothing to undo" });
      return;
    }
    res.json(
      await runOperation({
        actionId: undo,
        hostId: run.hostId ?? undefined,
        input: parseJson(run.undoInput),
        confirmed: req.body?.confirmed === true,
        undoOf: run.id,
        userId: authReq.userId,
        origin: originOf(authReq),
        apiKeyScopes: authReq.apiKeyScopes,
      }),
    );
  } catch (error) {
    sendError(res, error, "operations_undo");
  }
});

/**
 * @openapi
 * /operations/approvals:
 *   get:
 *     summary: List waiting approvals
 *     description: Requests the caller could decide, with the exact input that would run.
 *     tags:
 *       - Operations
 *     responses:
 *       200:
 *         description: Waiting approvals.
 */
router.get("/approvals", authenticateJWT, async (req, res) => {
  const { userId } = req as OperationsRequest;
  try {
    const repository = createCurrentOperationRepository();
    const approvals = [];
    for (const approval of await repository.listPendingApprovals()) {
      const run = await repository.findRun(approval.runId);
      if (run && (await canSeeRun(run, userId))) {
        approvals.push({ ...approval, run: publicRun(run) });
      }
    }
    res.json({ approvals });
  } catch (error) {
    sendError(res, error, "operations_approvals");
  }
});

/**
 * @openapi
 * /operations/approvals/{id}:
 *   post:
 *     summary: Approve or reject a request
 *     description: One shot. What runs is the sealed request, never anything sent here.
 *     tags:
 *       - Operations
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [approve]
 *             properties:
 *               approve:
 *                 type: boolean
 *               comment:
 *                 type: string
 *     responses:
 *       200:
 *         description: The run's outcome.
 *       403:
 *         description: The caller may not decide this.
 *       409:
 *         description: Already decided, expired, or the host changed.
 */
router.post("/approvals/:id", authenticateJWT, async (req, res) => {
  const authReq = req as OperationsRequest;
  if (typeof req.body?.approve !== "boolean") {
    res.status(400).json({ error: "approve must be true or false" });
    return;
  }
  // A key could be handed to a script, so a person decides from a session.
  if (authReq.apiKeyScopes) {
    res.status(403).json({ error: "This API key may not approve" });
    return;
  }
  try {
    res.json(
      await decideOperationApproval({
        approvalId: String(req.params.id),
        approverId: authReq.userId,
        approve: req.body.approve,
        comment:
          typeof req.body.comment === "string" ? req.body.comment : undefined,
        impersonated: !!authReq.actingAdminUserId,
      }),
    );
  } catch (error) {
    sendError(res, error, "operations_approve");
  }
});

/**
 * @openapi
 * /operations/events:
 *   get:
 *     summary: List declared events
 *     tags:
 *       - Operations
 *     responses:
 *       200:
 *         description: Declared events from running plugins, plus core's run events.
 */
router.get("/events", authenticateJWT, async (req, res) => {
  const { userId } = req as OperationsRequest;
  try {
    const catalog = await buildCatalog({
      userId,
      lang: typeof req.query.lang === "string" ? req.query.lang : undefined,
    });
    res.json({ events: catalog.events });
  } catch (error) {
    sendError(res, error, "operations_events");
  }
});

/**
 * @openapi
 * /operations/timeline:
 *   get:
 *     summary: Recent events
 *     description: Events the caller may see, newest first. Events tied to a host need access to it.
 *     tags:
 *       - Operations
 *     parameters:
 *       - in: query
 *         name: hostId
 *         schema:
 *           type: integer
 *       - in: query
 *         name: before
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Events.
 */
router.get("/timeline", authenticateJWT, async (req, res) => {
  const { userId } = req as OperationsRequest;
  try {
    const rows = await createCurrentOperationRepository().listEvents(
      {
        hostId: limitFrom(req.query.hostId),
        before:
          typeof req.query.before === "string" ? req.query.before : undefined,
      },
      limitFrom(req.query.limit),
    );
    const viewAll = await permissions.hasPermission(userId, VIEW_ALL_RUNS);
    const access = new Map<number, boolean>();
    const events = [];
    for (const row of rows) {
      if (row.hostId === null) {
        if (viewAll) events.push(row);
        continue;
      }
      let allowed = access.get(row.hostId);
      if (allowed === undefined) {
        allowed = (
          await permissions.canAccessHost(userId, row.hostId, "connect")
        ).hasAccess;
        access.set(row.hostId, allowed);
      }
      if (allowed) events.push(row);
    }
    res.json({
      events: events.map((event) => ({
        ...event,
        payload: parseJson(event.payload),
      })),
    });
  } catch (error) {
    sendError(res, error, "operations_timeline");
  }
});

/**
 * @openapi
 * /operations/signals:
 *   get:
 *     summary: Read status tiles
 *     description: Answers from memory right away and refreshes stale hosts behind it, so a page should poll. Reads hosts the caller can reach.
 *     tags:
 *       - Operations
 *     parameters:
 *       - in: query
 *         name: hostIds
 *         description: Comma separated. Leave out for every host.
 *         schema:
 *           type: string
 *       - in: query
 *         name: ids
 *         description: Comma separated signal ids. Leave out for all.
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: One entry per signal with per host results.
 */
router.get("/signals", authenticateJWT, async (req, res) => {
  const authReq = req as OperationsRequest;
  try {
    const catalog = await buildCatalog({ userId: authReq.userId });
    const wanted =
      typeof req.query.ids === "string" && req.query.ids
        ? new Set(req.query.ids.split(","))
        : null;
    const hostIds = hostIdsFrom(req.query.hostIds);
    const signals = [];
    for (const signal of catalog.signals) {
      if (wanted && !wanted.has(signal.id)) continue;
      if (signal.scope === "server") {
        const outcome = await runOperation({
          actionId: signal.read,
          internal: true,
          userId: authReq.userId,
          origin: originOf(authReq),
        }).catch(() => null);
        signals.push({
          id: signal.id,
          hosts: [],
          result: outcome?.data as SignalResult | undefined,
        });
        continue;
      }
      signals.push({
        id: signal.id,
        hosts: await readAcrossHosts<SignalResult>({
          userId: authReq.userId,
          actionId: signal.read,
          hostIds,
          freshMs: signal.refreshSec ? signal.refreshSec * 1000 : undefined,
          origin: originOf(authReq),
        }),
      });
    }
    res.json({ signals });
  } catch (error) {
    sendError(res, error, "operations_signals");
  }
});

/**
 * @openapi
 * /operations/resources/{id}:
 *   get:
 *     summary: Read one kind of thing across hosts
 *     description: Rows from cache plus each host's state (ok, loading, offline, error, no-access). Answers right away and refreshes stale hosts behind it, so a page should poll until no host is loading.
 *     tags:
 *       - Operations
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: hostIds
 *         description: Comma separated. Leave out for every host.
 *         schema:
 *           type: string
 *       - in: query
 *         name: refresh
 *         schema:
 *           type: boolean
 *     responses:
 *       200:
 *         description: Rows and per host state.
 *       404:
 *         description: No such resource, or the caller may not read it.
 */
router.get("/resources/:id", authenticateJWT, async (req, res) => {
  const authReq = req as OperationsRequest;
  try {
    const catalog = await buildCatalog({ userId: authReq.userId });
    const resource = catalog.resources.find(
      (entry) => entry.id === req.params.id,
    );
    if (!resource) {
      res.status(404).json({ error: "Resource not found" });
      return;
    }
    const reads = await readAcrossHosts<ResourceListResult>({
      userId: authReq.userId,
      actionId: resource.list,
      hostIds: hostIdsFrom(req.query.hostIds),
      refresh: req.query.refresh === "true",
      origin: originOf(authReq),
    });
    res.json(flattenResourceRows(reads, resource.key));
  } catch (error) {
    sendError(res, error, "operations_resources");
  }
});

/**
 * @openapi
 * /operations/{id}/run:
 *   post:
 *     summary: Run an action
 *     description: Goes through permission, host access, input and approval checks. A change returns as soon as it starts unless wait is true, then poll the run. A read always answers inline.
 *     tags:
 *       - Operations
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               hostId:
 *                 type: integer
 *               resourceKey:
 *                 type: string
 *               input:
 *                 type: object
 *               dryRun:
 *                 type: boolean
 *               confirmed:
 *                 type: boolean
 *               idempotencyKey:
 *                 type: string
 *               wait:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: The outcome, or a run waiting for approval.
 *       400:
 *         description: Invalid input.
 *       403:
 *         description: Not allowed.
 *       409:
 *         description: Needs a confirm, or safe mode is on.
 */
router.post("/:id/run", authenticateJWT, async (req, res) => {
  const authReq = req as OperationsRequest;
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    res.json(
      await runOperation({
        actionId: String(req.params.id),
        hostId: typeof body.hostId === "number" ? body.hostId : undefined,
        resourceKey:
          typeof body.resourceKey === "string" ? body.resourceKey : undefined,
        input: body.input,
        dryRun: body.dryRun === true,
        confirmed: body.confirmed === true,
        idempotencyKey:
          typeof body.idempotencyKey === "string"
            ? body.idempotencyKey.slice(0, 128)
            : undefined,
        userId: authReq.userId,
        origin: originOf(authReq),
        apiKeyScopes: authReq.apiKeyScopes,
      }),
    );
  } catch (error) {
    sendError(res, error, "operations_run_action");
  }
});

export default router;
