import { and, eq } from "drizzle-orm";
import { dismissedAlerts } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";

export type DismissedAlertRecord = typeof dismissedAlerts.$inferSelect;

export class DismissedAlertRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async listByUserId(userId: string): Promise<DismissedAlertRecord[]> {
    return this.context.drizzle
      .select()
      .from(dismissedAlerts)
      .where(eq(dismissedAlerts.userId, userId));
  }

  async listAlertIdsByUserId(userId: string): Promise<string[]> {
    const rows = await this.context.drizzle
      .select({ alertId: dismissedAlerts.alertId })
      .from(dismissedAlerts)
      .where(eq(dismissedAlerts.userId, userId));

    return rows.map((row) => row.alertId);
  }

  async findForUser(
    userId: string,
    alertId: string,
  ): Promise<DismissedAlertRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(dismissedAlerts)
      .where(
        and(
          eq(dismissedAlerts.userId, userId),
          eq(dismissedAlerts.alertId, alertId),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  async create(userId: string, alertId: string): Promise<void> {
    await this.context.drizzle.insert(dismissedAlerts).values({
      userId,
      alertId,
    });
    await this.afterWrite();
  }

  async createForImport(
    userId: string,
    alertId: string,
    dismissedAt = new Date().toISOString(),
  ): Promise<boolean> {
    const existing = await this.findForUser(userId, alertId);
    if (existing) {
      return false;
    }

    await this.context.drizzle.insert(dismissedAlerts).values({
      userId,
      alertId,
      dismissedAt,
    });
    await this.afterWrite();
    return true;
  }

  async deleteForUser(userId: string, alertId: string): Promise<boolean> {
    const rows = await this.context.drizzle
      .delete(dismissedAlerts)
      .where(
        and(
          eq(dismissedAlerts.userId, userId),
          eq(dismissedAlerts.alertId, alertId),
        ),
      )
      .returning({ id: dismissedAlerts.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length > 0;
  }

  async deleteByUserId(userId: string): Promise<number> {
    const rows = await this.context.drizzle
      .delete(dismissedAlerts)
      .where(eq(dismissedAlerts.userId, userId))
      .returning({ id: dismissedAlerts.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length;
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
