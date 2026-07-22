import { desc, eq, or } from "drizzle-orm";
import { randomUUID } from "crypto";
import { vaultProfiles } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";

export type VaultProfileRecord = typeof vaultProfiles.$inferSelect;

export interface VaultProfileCreateInput {
  userId: string;
  name: string;
  description?: string | null;
  folder?: string | null;
  tags?: string | null;
  vaultAddr: string;
  vaultNamespace?: string | null;
  oidcMount?: string | null;
  oidcRole?: string | null;
  sshMount?: string | null;
  sshRole: string;
  validPrincipals?: string | null;
  keyType?: string | null;
  shared?: boolean;
}

export type VaultProfileUpdateInput = Partial<
  Omit<VaultProfileCreateInput, "userId">
> & {
  updatedAt?: string;
};

export class VaultProfileRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async listVisibleToUser(userId: string): Promise<VaultProfileRecord[]> {
    return this.context.drizzle
      .select()
      .from(vaultProfiles)
      .where(
        or(eq(vaultProfiles.userId, userId), eq(vaultProfiles.shared, true)),
      )
      .orderBy(desc(vaultProfiles.updatedAt));
  }

  async create(input: VaultProfileCreateInput): Promise<VaultProfileRecord> {
    const [created] = await this.context.drizzle
      .insert(vaultProfiles)
      .values({
        syncId: randomUUID(),
        userId: input.userId,
        name: input.name,
        description: input.description,
        folder: input.folder,
        tags: input.tags,
        vaultAddr: input.vaultAddr,
        vaultNamespace: input.vaultNamespace,
        oidcMount: input.oidcMount,
        oidcRole: input.oidcRole,
        sshMount: input.sshMount,
        sshRole: input.sshRole,
        validPrincipals: input.validPrincipals,
        keyType: input.keyType,
        shared: input.shared ?? false,
      })
      .returning();

    await this.afterWrite();
    return created;
  }

  async findById(id: number): Promise<VaultProfileRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(vaultProfiles)
      .where(eq(vaultProfiles.id, id))
      .limit(1);

    return rows[0] ?? null;
  }

  async updateById(
    id: number,
    input: VaultProfileUpdateInput,
  ): Promise<VaultProfileRecord | null> {
    const [updated] = await this.context.drizzle
      .update(vaultProfiles)
      .set({
        ...input,
        updatedAt: input.updatedAt ?? new Date().toISOString(),
      })
      .where(eq(vaultProfiles.id, id))
      .returning();

    if (updated) {
      await this.afterWrite();
    }

    return updated ?? null;
  }

  async deleteById(id: number): Promise<{ syncId: string | null } | null> {
    const rows = await this.context.drizzle
      .delete(vaultProfiles)
      .where(eq(vaultProfiles.id, id))
      .returning({ syncId: vaultProfiles.syncId });

    if (rows.length === 0) return null;
    await this.afterWrite();
    return rows[0];
  }

  async deleteByUserId(userId: string): Promise<number> {
    const rows = await this.context.drizzle
      .delete(vaultProfiles)
      .where(eq(vaultProfiles.userId, userId))
      .returning({ id: vaultProfiles.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length;
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
