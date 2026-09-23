import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { userExternalIdentities, userSecondFactors } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { rowsAffected } from "./mutation-result.js";

export type UserExternalIdentityRecord =
  typeof userExternalIdentities.$inferSelect;
export type UserSecondFactorRecord = typeof userSecondFactors.$inferSelect;

/** Subjects are indexed, so they stay within the portable key length. */
export const MAX_EXTERNAL_SUBJECT_LENGTH = 255;

/**
 * Keeps a subject within the index length. Longer ones are hashed, which is
 * stable, so the same provider answer always finds the same row.
 */
export function normalizeExternalSubject(subject: string): string {
  if (subject.length <= MAX_EXTERNAL_SUBJECT_LENGTH) return subject;
  return `sha256:${crypto.createHash("sha256").update(subject).digest("hex")}`;
}

/** External sign-in identities and second-factor enrolments. */
export class UserAuthRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async findIdentity(
    providerId: string,
    rawSubject: string,
  ): Promise<UserExternalIdentityRecord | null> {
    const subject = normalizeExternalSubject(rawSubject);
    const rows = await this.context.drizzle
      .select()
      .from(userExternalIdentities)
      .where(
        and(
          eq(userExternalIdentities.providerId, providerId),
          eq(userExternalIdentities.subject, subject),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async listIdentitiesForUser(
    userId: string,
  ): Promise<UserExternalIdentityRecord[]> {
    return this.context.drizzle
      .select()
      .from(userExternalIdentities)
      .where(eq(userExternalIdentities.userId, userId));
  }

  async listAllIdentities(): Promise<UserExternalIdentityRecord[]> {
    return this.context.drizzle.select().from(userExternalIdentities);
  }

  /** Links or moves an identity to a user. Idempotent. */
  async linkIdentity(input: {
    userId: string;
    providerId: string;
    subject: string;
    email?: string | null;
  }): Promise<void> {
    const subject = normalizeExternalSubject(input.subject);
    const existing = await this.findIdentity(input.providerId, subject);
    if (existing) {
      if (existing.userId === input.userId) return;
      await this.context.drizzle
        .update(userExternalIdentities)
        .set({ userId: input.userId, email: input.email ?? existing.email })
        .where(eq(userExternalIdentities.id, existing.id));
    } else {
      await this.context.drizzle.insert(userExternalIdentities).values({
        userId: input.userId,
        providerId: input.providerId,
        subject,
        email: input.email ?? null,
        createdAt: new Date().toISOString(),
      });
    }
    await this.onWrite?.();
  }

  async unlinkIdentitiesForUser(userId: string): Promise<number> {
    const result = await this.context.drizzle
      .delete(userExternalIdentities)
      .where(eq(userExternalIdentities.userId, userId));
    const affected = rowsAffected(result);
    if (affected > 0) await this.onWrite?.();
    return affected;
  }

  async moveIdentities(fromUserId: string, toUserId: string): Promise<void> {
    await this.context.drizzle
      .update(userExternalIdentities)
      .set({ userId: toUserId })
      .where(eq(userExternalIdentities.userId, fromUserId));
    await this.onWrite?.();
  }

  async listSecondFactors(userId: string): Promise<UserSecondFactorRecord[]> {
    return this.context.drizzle
      .select()
      .from(userSecondFactors)
      .where(eq(userSecondFactors.userId, userId));
  }

  async listAllSecondFactors(): Promise<UserSecondFactorRecord[]> {
    return this.context.drizzle.select().from(userSecondFactors);
  }

  async recordSecondFactor(
    userId: string,
    pluginId: string,
    factorId: string,
  ): Promise<void> {
    const rows = await this.context.drizzle
      .select()
      .from(userSecondFactors)
      .where(
        and(
          eq(userSecondFactors.userId, userId),
          eq(userSecondFactors.pluginId, pluginId),
          eq(userSecondFactors.factorId, factorId),
        ),
      )
      .limit(1);
    if (rows[0]) return;
    await this.context.drizzle.insert(userSecondFactors).values({
      userId,
      pluginId,
      factorId,
      enrolledAt: new Date().toISOString(),
    });
    await this.onWrite?.();
  }

  async removeSecondFactor(
    userId: string,
    pluginId: string,
    factorId: string,
  ): Promise<boolean> {
    const result = await this.context.drizzle
      .delete(userSecondFactors)
      .where(
        and(
          eq(userSecondFactors.userId, userId),
          eq(userSecondFactors.pluginId, pluginId),
          eq(userSecondFactors.factorId, factorId),
        ),
      );
    const affected = rowsAffected(result) > 0;
    if (affected) await this.onWrite?.();
    return affected;
  }

  async clearSecondFactors(userId: string): Promise<number> {
    const result = await this.context.drizzle
      .delete(userSecondFactors)
      .where(eq(userSecondFactors.userId, userId));
    const affected = rowsAffected(result);
    if (affected > 0) await this.onWrite?.();
    return affected;
  }
}
