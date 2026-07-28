import { and, eq } from "drizzle-orm";
import { vaultTokens } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { rowsAffected } from "./mutation-result.js";
import { upsert } from "./returning.js";

export type VaultTokenRecord = typeof vaultTokens.$inferSelect;

export interface VaultTokenUpsertInput {
  userId: string;
  profileId: number;
  sshCert: string;
  privateKey: string;
  expiresAt: string;
  createdAt?: string;
}

export class VaultTokenRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async upsert(input: VaultTokenUpsertInput): Promise<void> {
    const createdAt = input.createdAt ?? new Date().toISOString();

    await upsert(
      this.context,
      vaultTokens,
      {
        userId: input.userId,
        profileId: input.profileId,
        sshCert: input.sshCert,
        privateKey: input.privateKey,
        expiresAt: input.expiresAt,
      },
      {
        target: [vaultTokens.userId, vaultTokens.profileId],
        set: {
          sshCert: input.sshCert,
          privateKey: input.privateKey,
          expiresAt: input.expiresAt,
          createdAt,
        },
      },
    );

    await this.afterWrite();
  }

  async findByUserAndProfile(
    userId: string,
    profileId: number,
  ): Promise<VaultTokenRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(vaultTokens)
      .where(
        and(
          eq(vaultTokens.userId, userId),
          eq(vaultTokens.profileId, profileId),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  async updateLastUsed(
    userId: string,
    profileId: number,
    lastUsed = new Date().toISOString(),
  ): Promise<boolean> {
    const result = await this.context.drizzle
      .update(vaultTokens)
      .set({ lastUsed })
      .where(
        and(
          eq(vaultTokens.userId, userId),
          eq(vaultTokens.profileId, profileId),
        ),
      );

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }

    return rowsAffected(result) > 0;
  }

  async deleteByUserAndProfile(
    userId: string,
    profileId: number,
  ): Promise<boolean> {
    const result = await this.context.drizzle
      .delete(vaultTokens)
      .where(
        and(
          eq(vaultTokens.userId, userId),
          eq(vaultTokens.profileId, profileId),
        ),
      );

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }

    return rowsAffected(result) > 0;
  }

  async deleteByUserId(userId: string): Promise<number> {
    const result = await this.context.drizzle
      .delete(vaultTokens)
      .where(eq(vaultTokens.userId, userId));

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }

    return rowsAffected(result);
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
