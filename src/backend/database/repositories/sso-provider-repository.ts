import { asc, eq } from "drizzle-orm";
import { ssoProviders, users } from "../db/schema.js";
import type { DatabaseContext } from "../runtime/adapter.js";

export type SsoProviderRecord = typeof ssoProviders.$inferSelect;
export type NewSsoProviderRecord = typeof ssoProviders.$inferInsert;
export type SsoProviderUpdate = Partial<
  Pick<
    NewSsoProviderRecord,
    "name" | "type" | "enabled" | "displayOrder" | "config" | "updatedAt"
  >
>;

export type PublicSsoProviderRecord = Pick<
  SsoProviderRecord,
  "id" | "name" | "type" | "displayOrder"
>;

export class SsoProviderRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async listEnabledPublic(): Promise<PublicSsoProviderRecord[]> {
    return this.context.drizzle
      .select({
        id: ssoProviders.id,
        name: ssoProviders.name,
        type: ssoProviders.type,
        displayOrder: ssoProviders.displayOrder,
      })
      .from(ssoProviders)
      .where(eq(ssoProviders.enabled, true))
      .orderBy(asc(ssoProviders.displayOrder), asc(ssoProviders.id));
  }

  async listAll(): Promise<SsoProviderRecord[]> {
    return this.context.drizzle
      .select()
      .from(ssoProviders)
      .orderBy(asc(ssoProviders.displayOrder), asc(ssoProviders.id));
  }

  async findById(id: number): Promise<SsoProviderRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(ssoProviders)
      .where(eq(ssoProviders.id, id))
      .limit(1);

    return rows[0] ?? null;
  }

  async findFirstEnabledOidcLike(): Promise<SsoProviderRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(ssoProviders)
      .where(eq(ssoProviders.enabled, true))
      .orderBy(asc(ssoProviders.displayOrder), asc(ssoProviders.id));

    return (
      rows.find(
        (row) =>
          row.type === "oidc" || row.type === "github" || row.type === "google",
      ) ?? null
    );
  }

  async create(provider: NewSsoProviderRecord): Promise<SsoProviderRecord> {
    const rows = await this.context.drizzle
      .insert(ssoProviders)
      .values(provider)
      .returning();

    await this.afterWrite();
    return rows[0];
  }

  async update(
    id: number,
    update: SsoProviderUpdate,
  ): Promise<SsoProviderRecord | null> {
    const rows = await this.context.drizzle
      .update(ssoProviders)
      .set(update)
      .where(eq(ssoProviders.id, id))
      .returning();

    await this.afterWrite();
    return rows[0] ?? null;
  }

  async delete(id: number): Promise<boolean> {
    const rows = await this.context.drizzle
      .delete(ssoProviders)
      .where(eq(ssoProviders.id, id))
      .returning({ id: ssoProviders.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length > 0;
  }

  async countUsersByProviderId(providerId: number): Promise<number> {
    const rows = await this.context.drizzle
      .select({ id: users.id })
      .from(users)
      .where(eq(users.ssoProviderId, providerId));

    return rows.length;
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
