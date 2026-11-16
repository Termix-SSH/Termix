/**
 * Who may cancel or undo a run, shared by the /operations routes and the
 * ctx.operations.runs calls a plugin makes from its own request.
 */

import { createCurrentOperationRepository } from "../database/repositories/factory.js";
import type { OperationRunRecord } from "../database/repositories/operation-repository.js";
import { PermissionManager } from "../utils/permission-manager.js";
import type { ActorOrigin } from "../plugins/actor.js";
import { getAction } from "./registry.js";
import {
  cancelOperationRun,
  runOperation,
  type OperationOutcome,
} from "./gate.js";

/** Sees every run on the server, not only their own. */
export const VIEW_ALL_RUNS = "admin.operations.view";

export async function canSeeRun(
  run: OperationRunRecord,
  userId: string,
): Promise<boolean> {
  const permissions = PermissionManager.getInstance();
  if (run.userId === userId) return true;
  if (await permissions.hasPermission(userId, VIEW_ALL_RUNS)) return true;
  if (run.hostId === null) return false;
  const access = await permissions.canAccessHost(userId, run.hostId, "manage");
  return access.hasAccess;
}

/** Null when the run does not exist or the user can't see it. */
export async function cancelRunAs(
  runId: string,
  userId: string,
): Promise<boolean | null> {
  const run = await createCurrentOperationRepository().findRun(runId);
  if (!run || !(await canSeeRun(run, userId))) return null;
  return cancelOperationRun(run);
}

/** Null when there is nothing this user can undo. */
export async function undoRunAs(options: {
  runId: string;
  userId: string;
  origin: ActorOrigin;
  confirmed?: boolean;
  apiKeyScopes?: string[] | null;
}): Promise<OperationOutcome | null> {
  const run = await createCurrentOperationRepository().findRun(options.runId);
  const undo = run ? getAction(run.actionId)?.action.undo : undefined;
  if (
    !run ||
    !undo ||
    !run.undoInput ||
    !(await canSeeRun(run, options.userId))
  ) {
    return null;
  }
  return runOperation({
    actionId: undo,
    hostId: run.hostId ?? undefined,
    input: parseJson(run.undoInput),
    confirmed: options.confirmed === true,
    undoOf: run.id,
    userId: options.userId,
    origin: options.origin,
    apiKeyScopes: options.apiKeyScopes,
  });
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
