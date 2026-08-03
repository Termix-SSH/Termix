import { and, asc, eq, sql } from "drizzle-orm";
import { c2sTunnelPresets } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { rowsAffected } from "./mutation-result.js";
import { insertReturning, updateReturning } from "./returning.js";

export type C2sTunnelPresetRecord = typeof c2sTunnelPresets.$inferSelect;

export interface C2sTunnelPresetCreateInput {
  name: string;
  config: string;
  platform?: string | null;
  computerName?: string | null;
}

export type C2sTunnelPresetUpdateInput = Partial<C2sTunnelPresetCreateInput>;

export class C2sTunnelPresetRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async listByUserId(userId: string): Promise<C2sTunnelPresetRecord[]> {
    return this.context.drizzle
      .select()
      .from(c2sTunnelPresets)
      .where(eq(c2sTunnelPresets.userId, userId))
      .orderBy(asc(c2sTunnelPresets.name));
  }

  async findByIdForUser(
    userId: string,
    id: number,
  ): Promise<C2sTunnelPresetRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(c2sTunnelPresets)
      .where(
        and(eq(c2sTunnelPresets.id, id), eq(c2sTunnelPresets.userId, userId)),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  async hasNameForUser(
    userId: string,
    name: string,
    excludingId?: number,
  ): Promise<boolean> {
    const rows = await this.context.drizzle
      .select({ id: c2sTunnelPresets.id })
      .from(c2sTunnelPresets)
      .where(
        and(
          eq(c2sTunnelPresets.userId, userId),
          eq(c2sTunnelPresets.name, name),
        ),
      );

    return rows.some((row) => row.id !== excludingId);
  }

  async createForUser(
    userId: string,
    input: C2sTunnelPresetCreateInput,
  ): Promise<C2sTunnelPresetRecord> {
    const [created] = await insertReturning(this.context, c2sTunnelPresets, {
      userId,
      name: input.name,
      config: input.config,
      platform: input.platform ?? null,
      computerName: input.computerName ?? null,
    });

    await this.afterWrite();
    return created;
  }

  async updateForUser(
    userId: string,
    id: number,
    updates: C2sTunnelPresetUpdateInput,
  ): Promise<C2sTunnelPresetRecord | null> {
    const [updated] = await updateReturning(
      this.context,
      c2sTunnelPresets,
      {
        ...updates,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      },
      and(eq(c2sTunnelPresets.id, id), eq(c2sTunnelPresets.userId, userId)),
    );

    if (updated) {
      await this.afterWrite();
    }

    return updated ?? null;
  }

  async deleteForUser(userId: string, id: number): Promise<boolean> {
    const result = await this.context.drizzle
      .delete(c2sTunnelPresets)
      .where(
        and(eq(c2sTunnelPresets.id, id), eq(c2sTunnelPresets.userId, userId)),
      );

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }

    return rowsAffected(result) > 0;
  }

  async deleteByUserId(userId: string): Promise<number> {
    const result = await this.context.drizzle
      .delete(c2sTunnelPresets)
      .where(eq(c2sTunnelPresets.userId, userId));

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }

    return rowsAffected(result);
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
