import { and, eq } from "drizzle-orm";
import type { AuthOverrideProtocol } from "../../../types/auth-protocols.js";
import { sharedHostAuthOverrides } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { deleteReturning, upsert } from "./returning.js";

export type SharedHostAuthOverrideRecord =
  typeof sharedHostAuthOverrides.$inferSelect;

export class SharedHostAuthOverrideRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async findForHostUser(
    hostId: number,
    userId: string,
    protocol: AuthOverrideProtocol,
  ): Promise<SharedHostAuthOverrideRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(sharedHostAuthOverrides)
      .where(
        and(
          eq(sharedHostAuthOverrides.hostId, hostId),
          eq(sharedHostAuthOverrides.userId, userId),
          eq(sharedHostAuthOverrides.protocol, protocol),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  async findCredentialId(
    hostId: number,
    userId: string,
    protocol: AuthOverrideProtocol,
  ): Promise<number | null> {
    return (
      (await this.findForHostUser(hostId, userId, protocol))?.credentialId ??
      null
    );
  }

  async setCredential(
    hostId: number,
    userId: string,
    protocol: AuthOverrideProtocol,
    credentialId: number,
  ): Promise<void> {
    await upsert(
      this.context,
      sharedHostAuthOverrides,
      {
        hostId,
        userId,
        protocol,
        credentialId,
      },
      {
        target: [
          sharedHostAuthOverrides.hostId,
          sharedHostAuthOverrides.userId,
          sharedHostAuthOverrides.protocol,
        ],
        set: {
          credentialId,
          updatedAt: new Date().toISOString(),
        },
      },
    );

    await this.afterWrite();
  }

  async clearCredential(
    hostId: number,
    userId: string,
    protocol: AuthOverrideProtocol,
  ): Promise<boolean> {
    const rows = await deleteReturning(
      this.context,
      sharedHostAuthOverrides,
      and(
        eq(sharedHostAuthOverrides.hostId, hostId),
        eq(sharedHostAuthOverrides.userId, userId),
        eq(sharedHostAuthOverrides.protocol, protocol),
      ),
    );

    if (rows.length > 0) {
      await this.afterWrite();
    }
    return rows.length > 0;
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
