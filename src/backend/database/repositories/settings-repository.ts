import { eq, like } from "drizzle-orm";
import { settings } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";

export class SettingsRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async get(key: string): Promise<string | null> {
    const rows = await this.context.drizzle
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, key))
      .limit(1);

    return rows[0]?.value ?? null;
  }

  async listAll(): Promise<Array<{ key: string; value: string }>> {
    return this.context.drizzle
      .select({ key: settings.key, value: settings.value })
      .from(settings);
  }

  async getBoolean(key: string, fallback = false): Promise<boolean> {
    const value = await this.get(key);
    if (value === null) return fallback;
    return value === "true" || value === "1";
  }

  async set(key: string, value: string): Promise<void> {
    const existing = await this.get(key);
    if (existing === null) {
      await this.context.drizzle.insert(settings).values({ key, value });
      await this.afterWrite();
      return;
    }

    await this.context.drizzle
      .update(settings)
      .set({ value })
      .where(eq(settings.key, key));
    await this.afterWrite();
  }

  async upsert(key: string, value: string): Promise<void> {
    await this.set(key, value);
  }

  async delete(key: string): Promise<void> {
    await this.context.drizzle.delete(settings).where(eq(settings.key, key));
    await this.afterWrite();
  }

  async deleteLike(pattern: string): Promise<number> {
    const rows = await this.context.drizzle
      .delete(settings)
      .where(like(settings.key, pattern))
      .returning({ key: settings.key });
    await this.afterWrite();
    return rows.length;
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
