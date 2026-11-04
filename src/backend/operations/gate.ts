/**
 * The one path every action takes, from any surface.
 *
 * In order: plugin up, grant still held, input valid, role permission, host
 * access, key scope, destructive confirm, approval, limits, run row, audit.
 * Handlers run in-process, so this is an access check for callers, not a
 * sandbox around plugins.
 *
 * Handler failures stay here. They never reach the plugin error budget, or five
 * failed hosts in a rollout would switch the plugin off.
 */

import { randomUUID } from "node:crypto";
import {
  capText,
  matchesWhen,
  parseOperationInput,
  redactFields,
  riskRank,
  type OperationAction,
  type OperationRisk,
} from "@termix-ssh/plugin-sdk/operations";
import { MAX_EVENT_DEPTH } from "./constants.js";
import { getAction, type OperationRegistration } from "./registry.js";
import {
  canSelfApprove,
  evaluateApproval,
  type ApprovalDecision,
} from "./approvals.js";
import { withLimits } from "./limits.js";
import { emitOperationEvent } from "./events.js";
import { dropResourceCache } from "./resources.js";
import { loadOperationHost, type OperationHost } from "./hosts.js";
import { runAsActor, type ActorOrigin } from "../plugins/actor.js";
import { hasCapability } from "../plugins/permissions.js";
import { qualifyPermission } from "../plugins/manifest.js";
import { safeModeOn } from "../plugins/safe-mode.js";
import { PermissionManager } from "../utils/permission-manager.js";
import { logAudit } from "../utils/audit-logger.js";
import {
  decryptSystemSecret,
  encryptSystemSecret,
  isSystemEncrypted,
} from "../utils/system-secret-crypto.js";
import { pluginLogger } from "../utils/logger.js";
import {
  createCurrentOperationRepository,
  createCurrentUserRepository,
} from "../database/repositories/factory.js";
import type {
  OperationApprovalRecord,
  OperationRunRecord,
} from "../database/repositories/operation-repository.js";

const MAX_OUTPUT = 32_000;
const DEFAULT_TIMEOUT_MS = 300_000;
const READ_TIMEOUT_MS = 60_000;
const DEFAULT_APPROVAL_MINUTES = 24 * 60;
const DRAIN_WAIT_MS = 10_000;

export type OperationErrorCode =
  | "NOT_FOUND"
  | "UNAVAILABLE"
  | "INVALID_INPUT"
  | "FORBIDDEN"
  | "SCOPE"
  | "NEEDS_CONFIRM"
  | "DENIED"
  | "TOO_DEEP"
  | "STALE"
  | "CONFLICT"
  | "SAFE_MODE";

const STATUS: Record<OperationErrorCode, number> = {
  NOT_FOUND: 404,
  UNAVAILABLE: 503,
  INVALID_INPUT: 400,
  FORBIDDEN: 403,
  SCOPE: 403,
  NEEDS_CONFIRM: 409,
  DENIED: 403,
  TOO_DEEP: 409,
  STALE: 409,
  CONFLICT: 409,
  SAFE_MODE: 409,
};

/** Refused before anything ran. Carries a status so routes can pass it on. */
export class OperationError extends Error {
  readonly status: number;

  constructor(
    readonly code: OperationErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "OperationError";
    this.status = STATUS[code];
  }
}

/** A handler throws this when a host needs a person to sign in first. */
export class OperationNeedsInteraction extends Error {
  readonly code = "NEEDS_INTERACTION";
}

export interface OperationRequest {
  actionId: string;
  hostId?: number;
  resourceKey?: string;
  input?: unknown;
  dryRun?: boolean;
  /** A person agreed to a destructive action. */
  confirmed?: boolean;
  idempotencyKey?: string;
  batchId?: string;
  undoOf?: string;
  /** Background reads for tables and tiles. Writes no run row. */
  internal?: boolean;
  userId: string;
  origin: ActorOrigin;
  apiKeyScopes?: string[] | null;
  depth?: number;
}

export interface OperationOutcome {
  runId: string | null;
  status: string;
  summary?: string;
  changed?: boolean;
  data?: unknown;
  error?: string;
  errorCode?: string;
  approvalId?: string;
}

interface Prepared {
  registration: OperationRegistration;
  action: OperationAction;
  pluginVersion: string;
  input: Record<string, unknown>;
  host: OperationHost | null;
  effectiveRisk: OperationRisk;
}

/** The sealed copy an approval is bound to. */
interface ApprovalSnapshot {
  runId: string;
  actionId: string;
  actionVersion: number;
  pluginVersion: string;
  hostId: number | null;
  hostUpdatedAt: string | null;
  resourceKey: string | null;
  input: Record<string, unknown>;
}

const active = new Map<
  string,
  { pluginId: string; controller: AbortController; done: Promise<unknown> }
>();
const draining = new Set<string>();

function now(): string {
  return new Date().toISOString();
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function loadedPlugin(pluginId: string) {
  const { getPluginRuntime } = await import("../plugins/index.js");
  return getPluginRuntime().loader.get(pluginId);
}

async function usernameOf(userId: string): Promise<string> {
  try {
    const user = await createCurrentUserRepository().findById(userId);
    return user?.username ?? userId;
  } catch {
    return userId;
  }
}

/** Every check that does not depend on who approved it. */
async function prepare(request: OperationRequest): Promise<Prepared> {
  if (safeModeOn()) {
    throw new OperationError("SAFE_MODE", "Actions are off in safe mode");
  }
  if ((request.depth ?? 0) > MAX_EVENT_DEPTH) {
    throw new OperationError("TOO_DEEP", "Too many actions led to this one");
  }

  const registration = getAction(request.actionId);
  if (!registration) {
    throw new OperationError(
      "NOT_FOUND",
      `No action "${request.actionId}" is available`,
    );
  }
  const { action, pluginId } = registration;
  const plugin = await loadedPlugin(pluginId);
  if (plugin?.state !== "active" || draining.has(pluginId)) {
    throw new OperationError("UNAVAILABLE", `${pluginId} is not running`);
  }
  // Rechecked at use, so revoking the grant stops it on the next call.
  if (
    !(await hasCapability(
      pluginId,
      "operations:provide",
      plugin.manifest.capabilities,
    ))
  ) {
    throw new OperationError("UNAVAILABLE", `${pluginId} may not run actions`);
  }

  const parsed = parseOperationInput(action.inputs, request.input);
  if (parsed.errors.length > 0) {
    throw new OperationError(
      "INVALID_INPUT",
      parsed.errors.join("; "),
      parsed.errors,
    );
  }

  const permissions = PermissionManager.getInstance();
  const permission = qualifyPermission(pluginId, action.permission);
  if (!(await permissions.hasPermission(request.userId, permission))) {
    throw new OperationError(
      "FORBIDDEN",
      `This needs the ${permission} permission`,
    );
  }

  let host: OperationHost | null = null;
  if (action.scope !== "server") {
    if (request.hostId === undefined) {
      throw new OperationError("INVALID_INPUT", "This action needs a host");
    }
    if (action.scope === "resource" && !request.resourceKey) {
      throw new OperationError("INVALID_INPUT", "This action needs a target");
    }
    const access = await permissions.canAccessHost(
      request.userId,
      request.hostId,
      action.hostAccess ?? "edit",
    );
    if (!access.hasAccess) {
      throw new OperationError(
        "FORBIDDEN",
        `You need ${action.hostAccess ?? "edit"} access to this host`,
      );
    }
    host = await loadOperationHost(request.hostId, plugin.manifest);
    if (!host) throw new OperationError("NOT_FOUND", "Host not found");
    if (!matchesWhen(action.when, host)) {
      throw new OperationError(
        "UNAVAILABLE",
        "This action does not apply to this host",
      );
    }
  }

  // A claim by the plugin, so only signed official plugins are taken at
  // their word when rules decide what needs a person.
  const official =
    plugin.source === "bundled" || plugin.signedTier === "official";
  const effectiveRisk: OperationRisk =
    !official && action.risk === "read" ? "change" : action.risk;

  return {
    registration,
    action,
    pluginVersion: plugin.manifest.version,
    input: parsed.values,
    host,
    effectiveRisk,
  };
}

function checkKeyScope(request: OperationRequest, action: OperationAction) {
  const scopes = request.apiKeyScopes;
  if (scopes === undefined || scopes === null) return;
  if (scopes.includes("operations:run")) return;
  if (scopes.includes("operations:read") && action.risk === "read") return;
  throw new OperationError("SCOPE", "This API key may not run this action");
}

function originText(origin: ActorOrigin): string {
  return JSON.stringify(origin);
}

function auditRun(
  request: OperationRequest,
  username: string,
  action: OperationAction,
  host: OperationHost | null,
  success: boolean,
  errorMessage?: string,
  verb = "operation_run",
): void {
  void logAudit({
    userId: request.userId,
    username,
    action: verb,
    resourceType: "operation",
    resourceId: action.id,
    resourceName: host?.name ?? undefined,
    details: originText(request.origin),
    success,
    errorMessage,
  }).catch(() => {});
}

async function execute(
  prepared: Prepared,
  request: OperationRequest,
  runId: string | null,
  username: string,
): Promise<OperationOutcome> {
  const { action, registration, input, host } = prepared;
  const repository = createCurrentOperationRepository();
  const controller = new AbortController();
  const dryRun = request.dryRun === true;
  const timeoutMs =
    action.timeoutMs ??
    (action.risk === "read" ? READ_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);
  const lines: string[] = [];
  const context = {
    hostId: request.hostId,
    resourceKey: request.resourceKey,
    runId,
    dryRun,
    signal: controller.signal,
    log: (line: string) => {
      if (lines.length < 200) lines.push(line);
    },
  };

  const work = async () => {
    if (dryRun && action.dryRun !== "native") {
      const summary = registration.handler.describe
        ? await registration.handler.describe(input, context)
        : `Would run ${action.id}`;
      return { summary, changed: false };
    }
    return registration.handler.run(input, context);
  };

  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () =>
      reject(new Error("The action was stopped or timed out")),
    );
  });
  aborted.catch(() => {});

  // Settles when the handler really stops, which can be after the run gives
  // up on it. A plugin going down waits on this, not on the run.
  let handlerStopped: () => void = () => {};
  const stopped = new Promise<void>((resolve) => {
    handlerStopped = resolve;
  });

  const startWork = () => {
    // Cancelled while waiting for a slot, so it never starts.
    if (controller.signal.aborted) {
      handlerStopped();
      return aborted;
    }
    const handling = Promise.resolve().then(work);
    void handling.finally(handlerStopped).catch(() => {});
    return Promise.race([handling, aborted]);
  };

  const running = withLimits(
    { hostId: request.hostId, exclusive: action.exclusive },
    () =>
      runAsActor(request.userId, "service", startWork, undefined, {
        origin: request.origin,
        apiKeyScopes: request.apiKeyScopes,
        runId: runId ?? undefined,
        depth: (request.depth ?? 0) + 1,
      }),
  );
  if (runId) {
    active.set(runId, {
      pluginId: registration.pluginId,
      controller,
      done: stopped,
    });
  }

  let outcome: OperationOutcome;
  try {
    const result = await running;
    const data = redactFields(action.outputs, result.data);
    outcome = {
      runId,
      status: "success",
      summary: result.summary,
      changed: result.changed,
      data,
    };
    if (runId) {
      await repository.updateRunFrom(runId, "running", {
        status: "success",
        summary: capText(result.summary ?? "", 2000),
        changed: result.changed ?? null,
        output:
          data === undefined ? null : capText(JSON.stringify(data), MAX_OUTPUT),
        undoInput: result.undoInput ? JSON.stringify(result.undoInput) : null,
        sealedInput: null,
        finishedAt: now(),
      });
    }
  } catch (error) {
    const needsPerson =
      (error as { code?: unknown } | null)?.code === "NEEDS_INTERACTION";
    const stopping = draining.has(registration.pluginId);
    const status = needsPerson
      ? "needs_interaction"
      : stopping
        ? "interrupted"
        : "failed";
    const message = stopping
      ? "The plugin stopped during this run. Check the host."
      : capText(errorText(error), 2000);
    outcome = { runId, status, error: message };
    if (needsPerson) outcome.errorCode = "NEEDS_INTERACTION";
    if (runId) {
      await repository.updateRunFrom(runId, "running", {
        status,
        error: message,
        errorCode: outcome.errorCode ?? null,
        sealedInput: null,
        finishedAt: now(),
      });
    }
  } finally {
    clearTimeout(timer);
    if (runId && !draining.has(registration.pluginId)) active.delete(runId);
  }

  if (action.risk !== "read" && !dryRun) {
    if (request.hostId !== undefined && outcome.status === "success") {
      dropResourceCache(request.hostId);
    }
    auditRun(
      request,
      username,
      action,
      host,
      outcome.status === "success",
      outcome.error,
    );
    void emitOperationEvent({
      eventId:
        outcome.status === "success"
          ? "operation.succeeded"
          : "operation.failed",
      pluginId: registration.pluginId,
      hostId: request.hostId,
      severity: outcome.status === "success" ? "info" : "warning",
      payload: {
        actionId: action.id,
        summary: outcome.summary,
        error: outcome.error,
        origin: request.origin,
      },
      runId: runId ?? undefined,
      depth: (request.depth ?? 0) + 1,
    });
  }
  return outcome;
}

function outcomeOf(
  run: OperationRunRecord,
  approvalId?: string,
): OperationOutcome {
  return {
    runId: run.id,
    status: run.status,
    summary: run.summary ?? undefined,
    changed: run.changed ?? undefined,
    error: run.error ?? undefined,
    errorCode: run.errorCode ?? undefined,
    approvalId,
  };
}

async function requestApproval(
  prepared: Prepared,
  request: OperationRequest,
  decision: ApprovalDecision,
  run: { id: string; username: string; createdAt: string },
): Promise<OperationOutcome> {
  const { action, host, input } = prepared;
  const repository = createCurrentOperationRepository();
  const snapshot: ApprovalSnapshot = {
    runId: run.id,
    actionId: action.id,
    actionVersion: action.version ?? 1,
    pluginVersion: prepared.pluginVersion,
    hostId: request.hostId ?? null,
    hostUpdatedAt: host?.updatedAt ?? null,
    resourceKey: request.resourceKey ?? null,
    input,
  };
  await repository.updateRunFrom(run.id, "created", {
    status: "pending_approval",
    summary: decision.reason ?? null,
    sealedInput: await encryptSystemSecret(JSON.stringify(snapshot)),
  });
  const minutes = decision.expiresInMinutes ?? DEFAULT_APPROVAL_MINUTES;
  const approvalId = randomUUID();
  await repository.insertApproval({
    id: approvalId,
    runId: run.id,
    requestedBy: request.userId,
    reason: decision.reason ?? null,
    allowSelf: decision.allowSelf === true || canSelfApprove(request.origin),
    status: "pending",
    createdAt: run.createdAt,
    expiresAt: new Date(Date.now() + minutes * 60_000).toISOString(),
  });
  void emitOperationEvent({
    eventId: "operation.approval-requested",
    pluginId: prepared.registration.pluginId,
    hostId: request.hostId,
    severity: "warning",
    payload: { actionId: action.id, approvalId },
    runId: run.id,
  });
  return { runId: run.id, status: "pending_approval", approvalId };
}

/** Runs an action, or parks it for approval. Throws OperationError if refused. */
export async function runOperation(
  request: OperationRequest,
): Promise<OperationOutcome> {
  const registration = getAction(request.actionId);
  if (registration) checkKeyScope(request, registration.action);

  const repository = createCurrentOperationRepository();
  if (request.idempotencyKey) {
    const earlier = await repository.findByIdempotencyKey(
      request.userId,
      request.idempotencyKey,
    );
    if (earlier) return outcomeOf(earlier);
  }

  const prepared = await prepare(request);
  const { action } = prepared;
  const dryRun = request.dryRun === true;
  const isRead = action.risk === "read";

  if (action.risk === "destructive" && !dryRun && !request.confirmed) {
    throw new OperationError("NEEDS_CONFIRM", "This action needs a confirm");
  }

  let decision: ApprovalDecision = { decision: "allow" };
  if (!dryRun && !request.internal) {
    decision = await evaluateApproval({
      actionId: action.id,
      pluginId: prepared.registration.pluginId,
      risk: action.risk,
      effectiveRisk: prepared.effectiveRisk,
      origin: request.origin,
      userId: request.userId,
      hostId: request.hostId,
      hostTags: prepared.host?.tags,
      batchId: request.batchId,
    });
  }
  const username = await usernameOf(request.userId);
  if (decision.decision === "deny") {
    auditRun(
      request,
      username,
      action,
      prepared.host,
      false,
      decision.reason,
      "operation_denied",
    );
    throw new OperationError(
      "DENIED",
      decision.reason ?? "A rule refused this action",
    );
  }

  // Internal reads poll constantly and would flood history and the save loop.
  if (request.internal && isRead) {
    return execute(prepared, request, null, username);
  }

  const run = {
    id: randomUUID(),
    actionId: action.id,
    actionVersion: action.version ?? 1,
    pluginId: prepared.registration.pluginId,
    pluginVersion: prepared.pluginVersion,
    userId: request.userId,
    username,
    origin: originText(request.origin),
    hostId: request.hostId ?? null,
    hostName: prepared.host?.name ?? null,
    batchId: request.batchId ?? null,
    dryRun,
    risk: action.risk,
    status: decision.decision === "approve" ? "created" : "running",
    input: JSON.stringify(redactFields(action.inputs, prepared.input)),
    undoOf: request.undoOf ?? null,
    idempotencyKey: request.idempotencyKey ?? null,
    createdAt: now(),
    startedAt: decision.decision === "approve" ? null : now(),
  };
  await repository.insertRun(run);

  if (decision.decision === "approve") {
    return requestApproval(prepared, request, decision, run);
  }
  return execute(prepared, request, run.id, username);
}

function originOf(run: OperationRunRecord): ActorOrigin {
  try {
    return JSON.parse(run.origin) as ActorOrigin;
  } catch {
    return { kind: "api" };
  }
}

async function failStale(run: OperationRunRecord, why: string): Promise<void> {
  await createCurrentOperationRepository().updateRunFrom(
    run.id,
    "pending_approval",
    {
      status: "rejected",
      error: why,
      sealedInput: null,
      finishedAt: now(),
    },
  );
}

/**
 * Records a person's decision. One shot: the row moves from pending once, so a
 * second click or a replay does nothing. What runs is the sealed copy, never
 * what the caller sends now.
 */
export async function decideOperationApproval(options: {
  approvalId: string;
  approverId: string;
  approve: boolean;
  comment?: string;
  impersonated?: boolean;
}): Promise<OperationOutcome> {
  const { approvalId, approverId, approve, comment } = options;
  const repository = createCurrentOperationRepository();
  const approval = await repository.findApproval(approvalId);
  if (!approval) throw new OperationError("NOT_FOUND", "Approval not found");
  if (approval.status !== "pending") {
    throw new OperationError("CONFLICT", "This was already decided");
  }
  const run = await repository.findRun(approval.runId);
  if (!run) throw new OperationError("NOT_FOUND", "Run not found");

  if (options.impersonated) {
    throw new OperationError("FORBIDDEN", "You cannot approve as another user");
  }
  if (approval.requestedBy === approverId && !approval.allowSelf) {
    throw new OperationError(
      "FORBIDDEN",
      "Someone else has to approve your request",
    );
  }

  if (new Date(approval.expiresAt).getTime() < Date.now()) {
    await repository.decideApproval(approvalId, "expired", null, null, now());
    await failStale(run, "The approval expired");
    throw new OperationError("STALE", "This approval expired");
  }

  // Approving needs the same rights as running it.
  const registration = getAction(run.actionId);
  if (registration) {
    const permissions = PermissionManager.getInstance();
    const needed = qualifyPermission(
      registration.pluginId,
      registration.action.permission,
    );
    const allowed =
      (await permissions.hasPermission(approverId, needed)) &&
      (run.hostId === null ||
        (
          await permissions.canAccessHost(
            approverId,
            run.hostId,
            registration.action.hostAccess ?? "edit",
          )
        ).hasAccess);
    if (!allowed) {
      throw new OperationError(
        "FORBIDDEN",
        "You need the same access as this action to approve it",
      );
    }
  }

  const won = await repository.decideApproval(
    approvalId,
    approve ? "approved" : "rejected",
    approverId,
    comment?.slice(0, 500) ?? null,
    now(),
  );
  if (!won) throw new OperationError("CONFLICT", "This was already decided");

  const username = await usernameOf(approverId);
  void logAudit({
    userId: approverId,
    username,
    action: approve ? "operation_approved" : "operation_rejected",
    resourceType: "operation",
    resourceId: run.actionId,
    details: run.id,
    success: true,
  }).catch(() => {});

  if (!approve) {
    await repository.updateRunFrom(run.id, "pending_approval", {
      status: "rejected",
      sealedInput: null,
      finishedAt: now(),
    });
    return { runId: run.id, status: "rejected" };
  }
  return runApproved(run, approval);
}

async function readSnapshot(
  run: OperationRunRecord,
): Promise<ApprovalSnapshot | null> {
  if (!run.sealedInput || !isSystemEncrypted(run.sealedInput)) return null;
  try {
    const snapshot = JSON.parse(
      await decryptSystemSecret(run.sealedInput),
    ) as ApprovalSnapshot;
    return snapshot.runId === run.id ? snapshot : null;
  } catch {
    return null;
  }
}

async function runApproved(
  run: OperationRunRecord,
  approval: OperationApprovalRecord,
): Promise<OperationOutcome> {
  const snapshot = await readSnapshot(run);
  if (!snapshot || !run.userId) {
    await failStale(run, "The approved request could not be read");
    throw new OperationError("STALE", "The approved request could not be read");
  }

  const request: OperationRequest = {
    actionId: snapshot.actionId,
    hostId: snapshot.hostId ?? undefined,
    resourceKey: snapshot.resourceKey ?? undefined,
    input: snapshot.input,
    confirmed: true,
    batchId: run.batchId ?? undefined,
    userId: run.userId,
    origin: originOf(run),
  };

  // The requester's own rights, as of now. They may have changed.
  let prepared: Prepared;
  try {
    prepared = await prepare(request);
  } catch (error) {
    await failStale(run, errorText(error));
    throw error;
  }

  const changedSince =
    prepared.pluginVersion !== snapshot.pluginVersion ||
    (prepared.action.version ?? 1) !== snapshot.actionVersion ||
    (prepared.host?.updatedAt ?? null) !== snapshot.hostUpdatedAt;
  if (changedSince) {
    await failStale(run, "The host or plugin changed after this was requested");
    throw new OperationError(
      "STALE",
      "The host or plugin changed after this was requested",
    );
  }

  const repository = createCurrentOperationRepository();
  const claimed = await repository.updateRunFrom(run.id, "pending_approval", {
    status: "running",
    startedAt: now(),
  });
  if (!claimed) throw new OperationError("CONFLICT", "This already ran");

  const outcome = await execute(prepared, request, run.id, run.username);
  return { ...outcome, approvalId: approval.id };
}

export async function cancelOperationRun(
  run: OperationRunRecord,
): Promise<boolean> {
  const repository = createCurrentOperationRepository();
  if (run.status === "pending_approval") {
    const approval = await repository.findApprovalForRun(run.id);
    if (approval) {
      await repository.decideApproval(
        approval.id,
        "rejected",
        null,
        "cancelled",
        now(),
      );
    }
    return repository.updateRunFrom(run.id, "pending_approval", {
      status: "cancelled",
      sealedInput: null,
      finishedAt: now(),
    });
  }
  const running = active.get(run.id);
  if (!running) return false;
  running.controller.abort();
  return true;
}

/**
 * Called when a plugin stops, before its SSH connections are torn down. New
 * runs are refused and running ones told to stop. Anything still going after
 * the wait has an unknown outcome and is never retried.
 */
export async function drainPlugin(pluginId: string): Promise<void> {
  draining.add(pluginId);
  try {
    const runs = [...active.entries()].filter(
      ([, entry]) => entry.pluginId === pluginId,
    );
    if (runs.length === 0) return;
    for (const [, entry] of runs) entry.controller.abort();
    await Promise.race([
      Promise.all(runs.map(([, entry]) => entry.done)),
      new Promise((resolve) => setTimeout(resolve, DRAIN_WAIT_MS)),
    ]);
    const repository = createCurrentOperationRepository();
    for (const [runId] of runs) {
      await repository.updateRunFrom(runId, "running", {
        status: "interrupted",
        error: "The plugin stopped during this run. Check the host.",
        sealedInput: null,
        finishedAt: now(),
      });
      active.delete(runId);
    }
  } catch (error) {
    pluginLogger.warn("Could not finish stopping runs", {
      operation: "operation_drain",
      pluginId,
      error: errorText(error),
    });
  } finally {
    draining.delete(pluginId);
  }
}

export function riskAtLeast(
  risk: OperationRisk,
  floor: OperationRisk,
): boolean {
  return riskRank(risk) >= riskRank(floor);
}

/** Test seam. */
export function clearOperationGate(): void {
  active.clear();
  draining.clear();
}
