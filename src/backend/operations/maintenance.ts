/** Startup sweep and periodic cleanup for runs, approvals and events. */

import { RETENTION_DAYS } from "./constants.js";
import { pluginLogger } from "../utils/logger.js";
import { createCurrentOperationRepository } from "../database/repositories/factory.js";

const SWEEP_MS = 10 * 60_000;

let timer: ReturnType<typeof setInterval> | null = null;

/** Parks expired approvals and trims history. Returns rows removed. */
export async function sweepOperations(at = new Date()): Promise<number> {
  const repository = createCurrentOperationRepository();
  const iso = at.toISOString();
  for (const approval of await repository.listExpiredApprovals(iso)) {
    await repository.decideApproval(approval.id, "expired", null, null, iso);
    await repository.updateRunFrom(approval.runId, "pending_approval", {
      status: "expired",
      sealedInput: null,
      finishedAt: iso,
    });
  }
  const cutoff = new Date(at.getTime() - RETENTION_DAYS * 86_400_000);
  return repository.prune(cutoff.toISOString());
}

/** Anything still running at boot lost its process, so its outcome is unknown. */
export async function startOperationsMaintenance(): Promise<void> {
  await createCurrentOperationRepository().markRunningInterrupted(
    new Date().toISOString(),
  );
  await sweepOperations();
  timer ??= setInterval(() => {
    sweepOperations().catch((error) => {
      pluginLogger.warn("Operations cleanup failed", {
        operation: "operations_sweep",
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, SWEEP_MS);
  timer.unref?.();
}

export function stopOperationsMaintenance(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
