/**
 * Checks the audit log's hash chain. Each row stores the hash of the one
 * before, so an edited, removed or inserted row breaks the chain from there
 * on. A head saved somewhere else (exported, or sent to a SIEM) also catches
 * a rewrite of the whole chain.
 */

import { createCurrentAuditLogRepository } from "../database/repositories/factory.js";
import type { AuditLogRecord } from "../database/repositories/audit-log-repository.js";
import {
  AUDIT_CHAIN_GENESIS,
  auditRowHash,
  type AuditChainPoint,
} from "./audit-chain-hash.js";
import { databaseLogger } from "./logger.js";

const BATCH = 1000;
const CHECK_EVERY_MS = 60 * 60 * 1000;
const FIRST_CHECK_MS = 2 * 60 * 1000;
const BROKEN_KEY = "audit_chain_broken_at";

export type AuditChainProblem =
  "row_changed" | "row_missing" | "hash_removed" | "head_mismatch";

export interface AuditChainResult {
  ok: boolean;
  /** Chained rows checked. */
  checked: number;
  /** Rows written before the chain existed. */
  unchained: number;
  head: AuditChainPoint | null;
  /** First row id where the chain stops holding. */
  brokenAt?: number;
  problem?: AuditChainProblem;
  checkedAt: string;
}

let lastResult: AuditChainResult | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function rowHash(prevHash: string, row: AuditLogRecord): string {
  return auditRowHash(prevHash, {
    ...row,
    success: Boolean(row.success),
    timestamp: String(row.timestamp),
  });
}

/** Walks every row in id order from the prune anchor up to the stored head. */
export async function verifyAuditChain(): Promise<AuditChainResult> {
  const repository = createCurrentAuditLogRepository();
  const { head, anchor } = await repository.readChainPoints();
  const checkedAt = new Date().toISOString();
  let expected = anchor?.hash ?? AUDIT_CHAIN_GENESIS;
  let last: AuditChainPoint | null = anchor
    ? { id: anchor.id, hash: anchor.hash }
    : null;
  let checked = 0;
  let unchained = 0;
  let chainStarted = false;
  let afterId = 0;
  const limit = head?.id ?? Number.MAX_SAFE_INTEGER;

  const fail = (
    brokenAt: number,
    problem: AuditChainProblem,
  ): AuditChainResult => ({
    ok: false,
    checked,
    unchained,
    head,
    brokenAt,
    problem,
    checkedAt,
  });

  for (;;) {
    const rows = await repository.listChainBatch(afterId, BATCH);
    if (rows.length === 0) break;
    for (const row of rows) {
      afterId = row.id;
      if (row.id > limit) break;
      if (!row.hash) {
        // Old rows sit before the chain; a missing hash inside it is a change.
        if (chainStarted) return fail(row.id, "hash_removed");
        unchained += 1;
        continue;
      }
      chainStarted = true;
      if (row.prevHash !== expected) return fail(row.id, "row_missing");
      if (rowHash(expected, row) !== row.hash) {
        return fail(row.id, "row_changed");
      }
      expected = row.hash;
      last = { id: row.id, hash: row.hash };
      checked += 1;
    }
    if (rows.length < BATCH || afterId > limit) break;
  }

  if (!head && chainStarted) return fail(afterId, "head_mismatch");
  if (head && (last?.id !== head.id || last?.hash !== head.hash)) {
    return fail(last ? last.id + 1 : head.id, "head_mismatch");
  }
  return { ok: true, checked, unchained, head, checkedAt };
}

export interface SavedHeadResult {
  /** The saved row is still there with the same hash. */
  found: boolean;
  /** And the chain from it to now holds. */
  ok: boolean;
  /** The saved row was pruned since, so it can't be compared any more. */
  pruned: boolean;
  chain: AuditChainResult;
}

/** Compares a head someone kept elsewhere with what the server holds now. */
export async function checkSavedHead(
  saved: AuditChainPoint,
): Promise<SavedHeadResult> {
  const repository = createCurrentAuditLogRepository();
  const chain = await verifyAuditChain();
  const { anchor } = await repository.readChainPoints();
  const row = await repository.findById(saved.id);
  if (!row) {
    const pruned = !!anchor && saved.id <= anchor.id;
    const found =
      pruned && anchor.id === saved.id && anchor.hash === saved.hash;
    return { found, ok: chain.ok && pruned, pruned, chain };
  }
  const found = row.hash === saved.hash;
  return { found, ok: found && chain.ok, pruned: false, chain };
}

export function lastAuditChainResult(): AuditChainResult | null {
  return lastResult;
}

const PROBLEM_TEXT: Record<AuditChainProblem, string> = {
  row_changed: "an entry was changed",
  row_missing: "an entry was removed or added",
  hash_removed: "an entry lost its hash",
  head_mismatch: "the newest entries were removed",
};

/**
 * Runs the check, and on a new break writes an audit line and alerts every
 * admin once. The same break is not reported again.
 */
export async function runAuditChainCheck(): Promise<AuditChainResult> {
  let result = await verifyAuditChain();
  // A prune between reading the head and the rows can look like a break.
  if (!result.ok) result = await verifyAuditChain();
  lastResult = result;
  if (result.ok) return result;

  const { createCurrentSettingsRepository } =
    await import("../database/repositories/factory.js");
  const settingsRepository = createCurrentSettingsRepository();
  const key = `${result.brokenAt}:${result.problem}`;
  if ((await settingsRepository.get(BROKEN_KEY)) === key) return result;
  await settingsRepository.set(BROKEN_KEY, key);

  const problem = PROBLEM_TEXT[result.problem ?? "row_changed"];
  databaseLogger.warn(
    `Audit log check failed at entry ${result.brokenAt}: ${problem}`,
    { operation: "audit_chain_broken", brokenAt: result.brokenAt },
  );
  const { logAudit } = await import("./audit-logger.js");
  await logAudit({
    userId: null,
    username: "system",
    action: "audit_chain_broken",
    resourceType: "audit_log",
    resourceId: String(result.brokenAt),
    details: JSON.stringify({ problem: result.problem }),
    success: false,
  });
  const { sendCoreAlert } = await import("../notify/core-notify.js");
  await sendCoreAlert({
    title: "The audit log was changed",
    body: `The audit log check failed at entry ${result.brokenAt}: ${problem}. Compare it with a head you saved or your SIEM copy.`,
    severity: "critical",
    category: "termix.audit-chain",
    dedupeKey: `audit-chain:${key}`,
    audience: "admins",
  });
  return result;
}

export function startAuditChainChecks(): void {
  if (timer) return;
  const run = () =>
    void runAuditChainCheck().catch((error) => {
      databaseLogger.warn("Audit log check could not run", {
        operation: "audit_chain_check",
        error: error instanceof Error ? error.message : String(error),
      });
    });
  setTimeout(run, FIRST_CHECK_MS).unref?.();
  timer = setInterval(run, CHECK_EVERY_MS);
  timer.unref?.();
}

/** Test seam. */
export function stopAuditChainChecks(): void {
  if (timer) clearInterval(timer);
  timer = null;
  lastResult = null;
}
