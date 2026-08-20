import { and, eq, ne } from "drizzle-orm";
import { randomUUID } from "crypto";
import { userWorkspaces } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { rowsAffected } from "./mutation-result.js";
import { insertReturning, updateReturning } from "./returning.js";

export type WorkspaceRecord = typeof userWorkspaces.$inferSelect;

export interface WorkspaceCreateInput {
  name: string;
  color?: string | null;
  icon?: string | null;
  payload: string;
}

export interface WorkspaceUpdateInput {
  name?: string;
  color?: string | null;
  icon?: string | null;
}

export class WorkspaceRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async listByUser(userId: string): Promise<WorkspaceRecord[]> {
    return this.context.drizzle
      .select()
      .from(userWorkspaces)
      .where(eq(userWorkspaces.userId, userId));
  }

  async findById(userId: string, id: number): Promise<WorkspaceRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(userWorkspaces)
      .where(and(eq(userWorkspaces.id, id), eq(userWorkspaces.userId, userId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findLastSession(userId: string): Promise<WorkspaceRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(userWorkspaces)
      .where(
        and(
          eq(userWorkspaces.userId, userId),
          eq(userWorkspaces.kind, "last_session"),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findDefault(userId: string): Promise<WorkspaceRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(userWorkspaces)
      .where(
        and(
          eq(userWorkspaces.userId, userId),
          eq(userWorkspaces.isDefault, true),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async upsertLastSession(
    userId: string,
    payload: string,
    now = new Date().toISOString(),
  ): Promise<WorkspaceRecord> {
    const existing = await this.findLastSession(userId);

    if (!existing) {
      const [created] = await insertReturning(this.context, userWorkspaces, {
        userId,
        name: "Last Session",
        color: null,
        icon: null,
        kind: "last_session",
        isDefault: false,
        payload,
        syncId: randomUUID(),
        createdAt: now,
        updatedAt: now,
      });
      await this.afterWrite();
      return created;
    }

    const [updated] = await updateReturning(
      this.context,
      userWorkspaces,
      { payload, updatedAt: now },
      and(
        eq(userWorkspaces.id, existing.id),
        eq(userWorkspaces.userId, userId),
      ),
    );
    await this.afterWrite();
    return updated;
  }

  async create(
    userId: string,
    input: WorkspaceCreateInput,
    now = new Date().toISOString(),
  ): Promise<WorkspaceRecord> {
    const [created] = await insertReturning(this.context, userWorkspaces, {
      userId,
      name: input.name,
      color: input.color ?? null,
      icon: input.icon ?? null,
      kind: "manual",
      isDefault: false,
      payload: input.payload,
      syncId: randomUUID(),
      createdAt: now,
      updatedAt: now,
    });
    await this.afterWrite();
    return created;
  }

  async update(
    userId: string,
    id: number,
    input: WorkspaceUpdateInput,
    now = new Date().toISOString(),
  ): Promise<WorkspaceRecord | null> {
    const existing = await this.findById(userId, id);
    if (!existing || existing.kind !== "manual") return null;

    const [updated] = await updateReturning(
      this.context,
      userWorkspaces,
      {
        name: input.name ?? existing.name,
        color: input.color === undefined ? existing.color : input.color,
        icon: input.icon === undefined ? existing.icon : input.icon,
        updatedAt: now,
      },
      and(eq(userWorkspaces.id, id), eq(userWorkspaces.userId, userId)),
    );
    await this.afterWrite();
    return updated ?? null;
  }

  async updateContent(
    userId: string,
    id: number,
    payload: string,
    now = new Date().toISOString(),
  ): Promise<WorkspaceRecord | null> {
    const existing = await this.findById(userId, id);
    if (!existing || existing.kind !== "manual") return null;

    const [updated] = await updateReturning(
      this.context,
      userWorkspaces,
      { payload, updatedAt: now },
      and(eq(userWorkspaces.id, id), eq(userWorkspaces.userId, userId)),
    );
    await this.afterWrite();
    return updated ?? null;
  }

  async setDefault(
    userId: string,
    id: number,
    now = new Date().toISOString(),
  ): Promise<WorkspaceRecord | null> {
    const existing = await this.findById(userId, id);
    if (!existing || existing.kind !== "manual") return null;

    await this.context.drizzle
      .update(userWorkspaces)
      .set({ isDefault: false, updatedAt: now })
      .where(
        and(
          eq(userWorkspaces.userId, userId),
          eq(userWorkspaces.isDefault, true),
          ne(userWorkspaces.id, id),
        ),
      );

    const [updated] = await updateReturning(
      this.context,
      userWorkspaces,
      { isDefault: true, updatedAt: now },
      and(eq(userWorkspaces.id, id), eq(userWorkspaces.userId, userId)),
    );
    await this.afterWrite();
    return updated ?? null;
  }

  async unsetDefault(
    userId: string,
    id: number,
    now = new Date().toISOString(),
  ): Promise<WorkspaceRecord | null> {
    const existing = await this.findById(userId, id);
    if (!existing || existing.kind !== "manual") return null;

    const [updated] = await updateReturning(
      this.context,
      userWorkspaces,
      { isDefault: false, updatedAt: now },
      and(eq(userWorkspaces.id, id), eq(userWorkspaces.userId, userId)),
    );
    await this.afterWrite();
    return updated ?? null;
  }

  async touchLastUsed(
    userId: string,
    id: number,
    now = new Date().toISOString(),
  ): Promise<void> {
    const result = await this.context.drizzle
      .update(userWorkspaces)
      .set({ lastUsedAt: now })
      .where(and(eq(userWorkspaces.id, id), eq(userWorkspaces.userId, userId)));

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }
  }

  async delete(userId: string, id: number): Promise<boolean> {
    const existing = await this.findById(userId, id);
    if (!existing || existing.kind !== "manual") return false;

    const result = await this.context.drizzle
      .delete(userWorkspaces)
      .where(and(eq(userWorkspaces.id, id), eq(userWorkspaces.userId, userId)));

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
      return true;
    }
    return false;
  }

  async deleteByUserId(userId: string): Promise<number> {
    const owned = await this.listByUser(userId);
    const result = await this.context.drizzle
      .delete(userWorkspaces)
      .where(eq(userWorkspaces.userId, userId));

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }
    return owned.length;
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
