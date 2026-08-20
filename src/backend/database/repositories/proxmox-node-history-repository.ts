import { and, asc, eq, gte, lt, lte } from "drizzle-orm";
import { proxmoxNodeHistory } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { sqlTimestampDaysAgo } from "./sql-timestamp.js";

export type ProxmoxNodeHistoryRecord = typeof proxmoxNodeHistory.$inferSelect;

export interface ProxmoxNodeHistoryCreateInput {
  hostId: number;
  cpuPercent?: number | null;
  memPercent?: number | null;
  diskPercent?: number | null;
  netRxBytes?: number | null;
  netTxBytes?: number | null;
}

export class ProxmoxNodeHistoryRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async create(input: ProxmoxNodeHistoryCreateInput): Promise<void> {
    await this.context.drizzle.insert(proxmoxNodeHistory).values({
      hostId: input.hostId,
      cpuPercent: input.cpuPercent,
      memPercent: input.memPercent,
      diskPercent: input.diskPercent,
      netRxBytes: input.netRxBytes,
      netTxBytes: input.netTxBytes,
    });

    await this.afterWrite();
  }

  async pruneOlderThan(hostId: number, retentionDays: number): Promise<void> {
    await this.context.drizzle
      .delete(proxmoxNodeHistory)
      .where(
        and(
          eq(proxmoxNodeHistory.hostId, hostId),
          lt(proxmoxNodeHistory.ts, sqlTimestampDaysAgo(retentionDays)),
        ),
      );
  }

  async listRange(
    hostId: number,
    fromTs: string,
    toTs: string,
  ): Promise<ProxmoxNodeHistoryRecord[]> {
    return this.context.drizzle
      .select()
      .from(proxmoxNodeHistory)
      .where(
        and(
          eq(proxmoxNodeHistory.hostId, hostId),
          gte(proxmoxNodeHistory.ts, fromTs),
          lte(proxmoxNodeHistory.ts, toTs),
        ),
      )
      .orderBy(asc(proxmoxNodeHistory.ts));
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
