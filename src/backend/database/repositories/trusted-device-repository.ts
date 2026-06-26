import { and, eq } from "drizzle-orm";
import { trustedDevices } from "../db/schema.js";
import type { DatabaseContext } from "../runtime/adapter.js";

export type TrustedDeviceRecord = typeof trustedDevices.$inferSelect;
export type NewTrustedDeviceRecord = typeof trustedDevices.$inferInsert;

export class TrustedDeviceRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async findByUserAndFingerprint(
    userId: string,
    deviceFingerprint: string,
  ): Promise<TrustedDeviceRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(trustedDevices)
      .where(
        and(
          eq(trustedDevices.userId, userId),
          eq(trustedDevices.deviceFingerprint, deviceFingerprint),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  async touch(
    userId: string,
    deviceFingerprint: string,
    lastUsedAt = new Date().toISOString(),
  ): Promise<void> {
    await this.context.drizzle
      .update(trustedDevices)
      .set({ lastUsedAt })
      .where(
        and(
          eq(trustedDevices.userId, userId),
          eq(trustedDevices.deviceFingerprint, deviceFingerprint),
        ),
      );
    await this.afterWrite();
  }

  async upsert(device: NewTrustedDeviceRecord): Promise<void> {
    const existing = await this.findByUserAndFingerprint(
      device.userId,
      device.deviceFingerprint,
    );

    if (existing) {
      await this.context.drizzle
        .update(trustedDevices)
        .set({
          expiresAt: device.expiresAt,
          lastUsedAt: device.lastUsedAt,
        })
        .where(
          and(
            eq(trustedDevices.userId, device.userId),
            eq(trustedDevices.deviceFingerprint, device.deviceFingerprint),
          ),
        );
    } else {
      await this.context.drizzle.insert(trustedDevices).values(device);
    }

    await this.afterWrite();
  }

  async deleteByUserAndFingerprint(
    userId: string,
    deviceFingerprint: string,
  ): Promise<void> {
    await this.context.drizzle
      .delete(trustedDevices)
      .where(
        and(
          eq(trustedDevices.userId, userId),
          eq(trustedDevices.deviceFingerprint, deviceFingerprint),
        ),
      );
    await this.afterWrite();
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.context.drizzle
      .delete(trustedDevices)
      .where(eq(trustedDevices.userId, userId));
    await this.afterWrite();
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
