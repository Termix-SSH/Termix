import { and, asc, eq, sql } from "drizzle-orm";
import { c2sTunnelPresets } from "../db/schema.js";
import type { DatabaseContext } from "../runtime/adapter.js";

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
    const [created] = await this.context.drizzle
      .insert(c2sTunnelPresets)
      .values({
        userId,
        name: input.name,
        config: input.config,
        platform: input.platform ?? null,
        computerName: input.computerName ?? null,
      })
      .returning();

    await this.afterWrite();
    return created;
  }

  async updateForUser(
    userId: string,
    id: number,
    updates: C2sTunnelPresetUpdateInput,
  ): Promise<C2sTunnelPresetRecord | null> {
    const [updated] = await this.context.drizzle
      .update(c2sTunnelPresets)
      .set({
        ...updates,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(
        and(eq(c2sTunnelPresets.id, id), eq(c2sTunnelPresets.userId, userId)),
      )
      .returning();

    if (updated) {
      await this.afterWrite();
    }

    return updated ?? null;
  }

  async deleteForUser(userId: string, id: number): Promise<boolean> {
    const rows = await this.context.drizzle
      .delete(c2sTunnelPresets)
      .where(
        and(eq(c2sTunnelPresets.id, id), eq(c2sTunnelPresets.userId, userId)),
      )
      .returning({ id: c2sTunnelPresets.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length > 0;
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
