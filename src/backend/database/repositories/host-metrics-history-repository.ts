import { and, asc, eq, gte, lte } from "drizzle-orm";
import { hostMetricsHistory } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";

export type HostMetricsHistoryRecord = typeof hostMetricsHistory.$inferSelect;

export interface HostMetricsHistoryCreateInput {
  hostId: number;
  cpuPercent?: number | null;
  memPercent?: number | null;
  diskPercent?: number | null;
  netRxBytes?: number | null;
  netTxBytes?: number | null;
}

export class HostMetricsHistoryRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async create(input: HostMetricsHistoryCreateInput): Promise<void> {
    await this.context.drizzle.insert(hostMetricsHistory).values({
      hostId: input.hostId,
      cpuPercent: input.cpuPercent,
      memPercent: input.memPercent,
      diskPercent: input.diskPercent,
      netRxBytes: input.netRxBytes,
      netTxBytes: input.netTxBytes,
    });

    await this.afterWrite();
  }

  pruneOlderThan(hostId: number, retentionDays: number): void {
    this.context.sqlite
      ?.prepare(
        "DELETE FROM host_metrics_history WHERE host_id = ? AND ts < datetime('now', ?)",
      )
      .run(hostId, `-${retentionDays} days`);
  }

  async listRange(
    hostId: number,
    fromTs: string,
    toTs: string,
  ): Promise<HostMetricsHistoryRecord[]> {
    return this.context.drizzle
      .select()
      .from(hostMetricsHistory)
      .where(
        and(
          eq(hostMetricsHistory.hostId, hostId),
          gte(hostMetricsHistory.ts, fromTs),
          lte(hostMetricsHistory.ts, toTs),
        ),
      )
      .orderBy(asc(hostMetricsHistory.ts));
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
