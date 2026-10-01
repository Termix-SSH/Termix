import fs from "node:fs/promises";
import path from "node:path";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import type { SessionRecordingRepository } from "./repository.js";

const DEFAULT_RETENTION_DAYS = 30;
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function getRetentionDays(ctx: PluginContext): Promise<number> {
  const configured = await ctx.settings.get<number>("retentionDays");
  if (typeof configured === "number" && configured >= 1 && configured <= 3650) {
    return configured;
  }
  return DEFAULT_RETENTION_DAYS;
}

async function pruneOldRecordings(
  ctx: PluginContext,
  repository: SessionRecordingRepository,
  dataDir: () => Promise<string>,
): Promise<void> {
  try {
    const retentionDays = await getRetentionDays(ctx);
    const cutoff = new Date(
      Date.now() - retentionDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const old = await repository.listPathsOlderThan(cutoff);
    if (old.length === 0) return;

    const base = `${path.resolve(await dataDir())}${path.sep}`;
    for (const row of old) {
      if (row.recordingPath) {
        const resolved = path.resolve(row.recordingPath);
        if (resolved.startsWith(base)) {
          await fs.unlink(resolved).catch(() => {});
        }
      }
      await repository.deleteById(row.id);
    }

    ctx.log.info(`Pruned ${old.length} old session recording(s)`);
  } catch (error) {
    ctx.log.warn(
      `Failed to prune old session recordings: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/** Runs the retention sweep at startup and every 24 hours. */
export function startRetentionSweep(
  ctx: PluginContext,
  repository: SessionRecordingRepository,
  dataDir: () => Promise<string>,
): void {
  void pruneOldRecordings(ctx, repository, dataDir);
  const timer = setInterval(
    () => void pruneOldRecordings(ctx, repository, dataDir),
    PRUNE_INTERVAL_MS,
  );
  timer.unref?.();
  ctx.disposables.add(() => clearInterval(timer));
}
