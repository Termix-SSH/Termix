import { and, eq } from "drizzle-orm";
import { opksshTokens } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";

export type OpksshTokenRecord = typeof opksshTokens.$inferSelect;

export interface OpksshTokenUpsertInput {
  userId: string;
  hostId: number;
  sshCert: string;
  privateKey: string;
  email?: string | null;
  sub?: string | null;
  issuer?: string | null;
  audience?: string | null;
  expiresAt: string;
  createdAt?: string;
}

export class OpksshTokenRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async upsert(input: OpksshTokenUpsertInput): Promise<void> {
    const createdAt = input.createdAt ?? new Date().toISOString();

    await this.context.drizzle
      .insert(opksshTokens)
      .values({
        userId: input.userId,
        hostId: input.hostId,
        sshCert: input.sshCert,
        privateKey: input.privateKey,
        email: input.email,
        sub: input.sub,
        issuer: input.issuer,
        audience: input.audience,
        expiresAt: input.expiresAt,
      })
      .onConflictDoUpdate({
        target: [opksshTokens.userId, opksshTokens.hostId],
        set: {
          sshCert: input.sshCert,
          privateKey: input.privateKey,
          email: input.email,
          sub: input.sub,
          issuer: input.issuer,
          audience: input.audience,
          expiresAt: input.expiresAt,
          createdAt,
        },
      });

    await this.afterWrite();
  }

  async findByUserAndHost(
    userId: string,
    hostId: number,
  ): Promise<OpksshTokenRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(opksshTokens)
      .where(
        and(eq(opksshTokens.userId, userId), eq(opksshTokens.hostId, hostId)),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  async updateLastUsed(
    userId: string,
    hostId: number,
    lastUsed = new Date().toISOString(),
  ): Promise<boolean> {
    const rows = await this.context.drizzle
      .update(opksshTokens)
      .set({ lastUsed })
      .where(
        and(eq(opksshTokens.userId, userId), eq(opksshTokens.hostId, hostId)),
      )
      .returning({ id: opksshTokens.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length > 0;
  }

  async deleteByUserAndHost(userId: string, hostId: number): Promise<boolean> {
    const rows = await this.context.drizzle
      .delete(opksshTokens)
      .where(
        and(eq(opksshTokens.userId, userId), eq(opksshTokens.hostId, hostId)),
      )
      .returning({ id: opksshTokens.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length > 0;
  }

  async deleteByUserId(userId: string): Promise<number> {
    const rows = await this.context.drizzle
      .delete(opksshTokens)
      .where(eq(opksshTokens.userId, userId))
      .returning({ id: opksshTokens.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length;
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
