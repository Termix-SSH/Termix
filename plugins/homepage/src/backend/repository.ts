import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { PluginDatabase } from "@termix/plugin-sdk/backend";

export interface HomepageItemRecord {
  id: number;
  userId: string;
  typeId: string;
  title: string | null;
  config: string;
  folderId: number | null;
  syncId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HomepageLayoutRecord {
  id: number;
  userId: string;
  layout: string;
  updatedAt: string;
}

export interface ServiceLinkRecord {
  id: number;
  userId: string;
  label: string;
  url: string;
  order: number;
  syncId: string | null;
  createdAt: string;
  updatedAt: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// Tables come from ctx.db.define, which the SDK hands back untyped, and the
// drizzle handle is the server's own. Typed at this module's edge instead.
type Table = any;
type Drizzle = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export type HomepageRepository = ReturnType<typeof createHomepageRepository>;

export function createHomepageRepository(
  db: PluginDatabase,
  tables: { items: Table; layouts: Table; serviceLinks: Table },
) {
  const client = () => db.client<Drizzle>();

  async function findItemById(
    userId: string,
    id: number,
  ): Promise<HomepageItemRecord | null> {
    const drizzle = await client();
    const rows = await drizzle
      .select()
      .from(tables.items)
      .where(and(eq(tables.items.id, id), eq(tables.items.userId, userId)))
      .limit(1);
    return (rows[0] as HomepageItemRecord) ?? null;
  }

  async function findItemBySyncId(syncId: string): Promise<HomepageItemRecord> {
    const drizzle = await client();
    const rows = await drizzle
      .select()
      .from(tables.items)
      .where(eq(tables.items.syncId, syncId))
      .limit(1);
    return rows[0] as HomepageItemRecord;
  }

  async function findServiceLinkById(
    userId: string,
    id: number,
  ): Promise<ServiceLinkRecord | null> {
    const drizzle = await client();
    const rows = await drizzle
      .select()
      .from(tables.serviceLinks)
      .where(
        and(
          eq(tables.serviceLinks.id, id),
          eq(tables.serviceLinks.userId, userId),
        ),
      )
      .limit(1);
    return (rows[0] as ServiceLinkRecord) ?? null;
  }

  async function findServiceLinkBySyncId(
    syncId: string,
  ): Promise<ServiceLinkRecord> {
    const drizzle = await client();
    const rows = await drizzle
      .select()
      .from(tables.serviceLinks)
      .where(eq(tables.serviceLinks.syncId, syncId))
      .limit(1);
    return rows[0] as ServiceLinkRecord;
  }

  return {
    findItemById,

    async listItemsByUser(userId: string): Promise<HomepageItemRecord[]> {
      const drizzle = await client();
      return drizzle
        .select()
        .from(tables.items)
        .where(eq(tables.items.userId, userId));
    },

    async createItem(
      userId: string,
      input: { typeId: string; title: string | null; config: string },
    ): Promise<HomepageItemRecord> {
      const syncId = randomUUID();
      const now = new Date().toISOString();
      const drizzle = await client();
      await drizzle.insert(tables.items).values({
        userId,
        typeId: input.typeId,
        title: input.title,
        config: input.config,
        syncId,
        createdAt: now,
        updatedAt: now,
      });
      await db.persist();
      return findItemBySyncId(syncId);
    },

    async updateItem(
      userId: string,
      id: number,
      updates: { title?: string | null; config?: string },
    ): Promise<HomepageItemRecord | null> {
      const existing = await findItemById(userId, id);
      if (!existing) return null;
      const drizzle = await client();
      await drizzle
        .update(tables.items)
        .set({ ...updates, updatedAt: new Date().toISOString() })
        .where(and(eq(tables.items.id, id), eq(tables.items.userId, userId)));
      await db.persist();
      return findItemById(userId, id);
    },

    async deleteItem(
      userId: string,
      id: number,
    ): Promise<HomepageItemRecord | null> {
      const existing = await findItemById(userId, id);
      if (!existing) return null;
      const drizzle = await client();
      await drizzle
        .delete(tables.items)
        .where(and(eq(tables.items.id, id), eq(tables.items.userId, userId)));
      await db.persist();
      return existing;
    },

    async findLayoutByUser(
      userId: string,
    ): Promise<HomepageLayoutRecord | null> {
      const drizzle = await client();
      const rows = await drizzle
        .select()
        .from(tables.layouts)
        .where(eq(tables.layouts.userId, userId))
        .limit(1);
      return (rows[0] as HomepageLayoutRecord) ?? null;
    },

    async upsertLayout(
      userId: string,
      layout: string,
      now: string,
    ): Promise<HomepageLayoutRecord> {
      const drizzle = await client();
      const existing = await drizzle
        .select()
        .from(tables.layouts)
        .where(eq(tables.layouts.userId, userId))
        .limit(1);

      if (existing[0]) {
        await drizzle
          .update(tables.layouts)
          .set({ layout, updatedAt: now })
          .where(eq(tables.layouts.userId, userId));
      } else {
        await drizzle.insert(tables.layouts).values({
          userId,
          layout,
          updatedAt: now,
        });
      }
      await db.persist();
      const rows = await drizzle
        .select()
        .from(tables.layouts)
        .where(eq(tables.layouts.userId, userId))
        .limit(1);
      return rows[0] as HomepageLayoutRecord;
    },

    findServiceLinkById,

    async listServiceLinksByUser(userId: string): Promise<ServiceLinkRecord[]> {
      const drizzle = await client();
      return drizzle
        .select()
        .from(tables.serviceLinks)
        .where(eq(tables.serviceLinks.userId, userId))
        .orderBy(asc(tables.serviceLinks.order), asc(tables.serviceLinks.id));
    },

    async createServiceLink(
      userId: string,
      input: { label: string; url: string },
    ): Promise<ServiceLinkRecord> {
      const drizzle = await client();
      const existing = await drizzle
        .select({ order: tables.serviceLinks.order })
        .from(tables.serviceLinks)
        .where(eq(tables.serviceLinks.userId, userId))
        .orderBy(asc(tables.serviceLinks.order));
      const nextOrder =
        existing.length > 0 ? existing[existing.length - 1].order + 1 : 0;

      const syncId = randomUUID();
      const now = new Date().toISOString();
      await drizzle.insert(tables.serviceLinks).values({
        userId,
        label: input.label,
        url: input.url,
        order: nextOrder,
        syncId,
        createdAt: now,
        updatedAt: now,
      });
      await db.persist();
      return findServiceLinkBySyncId(syncId);
    },

    async updateServiceLink(
      userId: string,
      id: number,
      updates: { label?: string; url?: string },
    ): Promise<ServiceLinkRecord | null> {
      const existing = await findServiceLinkById(userId, id);
      if (!existing) return null;
      const drizzle = await client();
      await drizzle
        .update(tables.serviceLinks)
        .set({ ...updates, updatedAt: new Date().toISOString() })
        .where(
          and(
            eq(tables.serviceLinks.id, id),
            eq(tables.serviceLinks.userId, userId),
          ),
        );
      await db.persist();
      return findServiceLinkById(userId, id);
    },

    async deleteServiceLink(
      userId: string,
      id: number,
    ): Promise<ServiceLinkRecord | null> {
      const existing = await findServiceLinkById(userId, id);
      if (!existing) return null;
      const drizzle = await client();
      await drizzle
        .delete(tables.serviceLinks)
        .where(
          and(
            eq(tables.serviceLinks.id, id),
            eq(tables.serviceLinks.userId, userId),
          ),
        );
      await db.persist();
      return existing;
    },
  };
}
