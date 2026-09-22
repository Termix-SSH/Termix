import { and, eq } from "drizzle-orm";
import { notificationChannels } from "../db/schema.js";
import { DataCrypto } from "../../utils/data-crypto.js";
import type { DatabaseContext } from "./database-context.js";
import { rowsAffected } from "./mutation-result.js";
import { insertReturning, updateReturning } from "./returning.js";

type NotificationChannelRecord = typeof notificationChannels.$inferSelect;

export interface NotificationChannelRow {
  id: number;
  user_id: string;
  name: string;
  type: string;
  config: string;
  enabled: number;
  created_at: string;
}

export class NotificationChannelRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  /**
   * Channel configs carry ntfy tokens and webhook auth headers, so they are
   * field-encrypted like any other secret. The key is derived from the row id,
   * which does not exist until after the insert, so a new channel is written
   * once and then re-encrypted in place with its real id.
   */
  private userDataKey(userId: string): Buffer | null {
    try {
      return DataCrypto.getUserDataKey(userId);
    } catch {
      // Crypto is not initialized (tests, early boot); leave the value as is.
      return null;
    }
  }

  private encryptConfig(
    config: string,
    userId: string,
    recordId: number | string,
  ): string {
    const userDataKey = this.userDataKey(userId);
    if (!userDataKey) return config;
    return DataCrypto.encryptRecord(
      "notification_channels",
      { id: recordId, config },
      userId,
      userDataKey,
    ).config;
  }

  private decryptConfig(
    config: string,
    userId: string,
    recordId: number | string,
  ): string {
    const userDataKey = this.userDataKey(userId);
    if (!userDataKey) return config;
    try {
      return DataCrypto.decryptRecord(
        "notification_channels",
        { id: recordId, config },
        userId,
        userDataKey,
      ).config;
    } catch {
      // Rows written before channel configs were encrypted are still plaintext.
      return config;
    }
  }

  async listNotificationChannels(
    userId: string,
  ): Promise<NotificationChannelRow[]> {
    const rows = await this.context.drizzle
      .select()
      .from(notificationChannels)
      .where(eq(notificationChannels.userId, userId))
      .orderBy(notificationChannels.id);

    return rows.map((row) => {
      const mapped = mapChannelRow(row);
      mapped.config = this.decryptConfig(mapped.config, userId, mapped.id);
      return mapped;
    });
  }

  async findNotificationChannelForUser(
    id: number,
    userId: string,
  ): Promise<NotificationChannelRow | null> {
    const rows = await this.context.drizzle
      .select()
      .from(notificationChannels)
      .where(
        and(
          eq(notificationChannels.id, id),
          eq(notificationChannels.userId, userId),
        ),
      )
      .limit(1);

    if (!rows[0]) return null;
    const mapped = mapChannelRow(rows[0]);
    mapped.config = this.decryptConfig(mapped.config, userId, mapped.id);
    return mapped;
  }

  async createNotificationChannel(input: {
    userId: string;
    name: string;
    type: string;
    config: string;
    enabled: boolean;
  }): Promise<NotificationChannelRow> {
    const [created] = await insertReturning(
      this.context,
      notificationChannels,
      {
        userId: input.userId,
        name: input.name,
        type: input.type,
        config: input.config,
        enabled: input.enabled,
      },
    );

    const encrypted = this.encryptConfig(
      input.config,
      input.userId,
      created.id,
    );
    if (encrypted !== input.config) {
      await this.context.drizzle
        .update(notificationChannels)
        .set({ config: encrypted })
        .where(eq(notificationChannels.id, created.id));
    }

    await this.afterWrite();
    const mapped = mapChannelRow(created);
    mapped.config = input.config;
    return mapped;
  }

  async updateNotificationChannel(
    id: number,
    userId: string,
    input: {
      name?: string;
      type?: string;
      config?: string;
      enabled?: boolean;
    },
  ): Promise<NotificationChannelRow | null> {
    if (Object.keys(input).length === 0) {
      return this.findNotificationChannelForUser(id, userId);
    }

    const values =
      input.config !== undefined
        ? { ...input, config: this.encryptConfig(input.config, userId, id) }
        : input;

    const [updated] = await updateReturning(
      this.context,
      notificationChannels,
      values,
      and(
        eq(notificationChannels.id, id),
        eq(notificationChannels.userId, userId),
      ),
    );

    if (!updated) return null;
    await this.afterWrite();
    const mapped = mapChannelRow(updated);
    mapped.config = this.decryptConfig(mapped.config, userId, mapped.id);
    return mapped;
  }

  async deleteNotificationChannel(
    id: number,
    userId: string,
  ): Promise<boolean> {
    const result = await this.context.drizzle
      .delete(notificationChannels)
      .where(
        and(
          eq(notificationChannels.id, id),
          eq(notificationChannels.userId, userId),
        ),
      );

    if (rowsAffected(result) === 0) return false;
    await this.afterWrite();
    return true;
  }

  async deleteByUserId(userId: string): Promise<{ channelsDeleted: number }> {
    const result = await this.context.drizzle
      .delete(notificationChannels)
      .where(eq(notificationChannels.userId, userId));

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }

    return { channelsDeleted: rowsAffected(result) };
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}

function mapChannelRow(row: NotificationChannelRecord): NotificationChannelRow {
  return {
    id: row.id,
    user_id: row.userId,
    name: row.name,
    type: row.type,
    config: row.config,
    enabled: row.enabled ? 1 : 0,
    created_at: row.createdAt,
  };
}
