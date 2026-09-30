/**
 * Runs materialize passes one at a time, so two default changes can never
 * write the same host at once. A server-wide change can touch every host, so
 * it runs as a job the admin panel polls instead of holding the request open.
 */

import { randomUUID } from "crypto";
import { databaseLogger } from "../../utils/logger.js";
import type { HostDefaultsScope } from "../../database/repositories/host-defaults-repository.js";
import {
  materializeHosts,
  type HostDefaultsTarget,
  type MaterializeResult,
} from "./materialize.js";

let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.catch(() => {}).then(task);
  queue = run;
  return run;
}

export interface RecomputeJob {
  id: string;
  status: "running" | "done" | "failed";
  changedHosts: number;
  error?: string;
  finishedAt?: number;
}

const jobs = new Map<string, RecomputeJob>();
const JOB_TTL_MS = 60 * 60 * 1000;

function pruneJobs(): void {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    if (job.finishedAt && job.finishedAt < cutoff) jobs.delete(id);
  }
}

/** Which hosts a level's defaults reach. A folder's owner is resolved by the caller. */
export function targetForScope(
  scope: HostDefaultsScope,
  folderOwnerId?: string,
): HostDefaultsTarget {
  if (scope.level === "admin") return { all: true };
  if (scope.level === "user") return { userIds: [String(scope.userId)] };
  return { userIds: folderOwnerId ? [folderOwnerId] : [] };
}

export function recompute(
  target: HostDefaultsTarget,
  keys?: Set<string>,
): Promise<MaterializeResult> {
  return enqueue(() => materializeHosts(target, { keys }));
}

/** Starts a pass in the background and returns its job. */
export function startRecomputeJob(
  target: HostDefaultsTarget,
  keys?: Set<string>,
): RecomputeJob {
  pruneJobs();
  const job: RecomputeJob = {
    id: randomUUID(),
    status: "running",
    changedHosts: 0,
  };
  jobs.set(job.id, job);
  recompute(target, keys)
    .then((result) => {
      job.status = "done";
      job.changedHosts = result.changedHostIds.length;
    })
    .catch((error) => {
      job.status = "failed";
      job.error = error instanceof Error ? error.message : String(error);
      databaseLogger.error("Host defaults recompute failed", error, {
        operation: "host_defaults_recompute",
      });
    })
    .finally(() => {
      job.finishedAt = Date.now();
    });
  return job;
}

export function getRecomputeJob(id: string): RecomputeJob | undefined {
  return jobs.get(id);
}

/**
 * Classifies and brings every host up to date. Run after boot and when a
 * plugin starts, so a host or namespace nobody has classified yet catches up.
 */
export function recomputeEverything(reason: string): void {
  recompute({ all: true })
    .then((result) => {
      if (result.changedHostIds.length > 0) {
        databaseLogger.info("Applied host defaults", {
          operation: "host_defaults_recompute",
          reason,
          changedHosts: result.changedHostIds.length,
        });
      }
    })
    .catch((error) => {
      databaseLogger.warn("Could not apply host defaults", {
        operation: "host_defaults_recompute",
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
    });
}
