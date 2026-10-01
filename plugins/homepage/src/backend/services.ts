import type { PluginContext } from "@termix/plugin-sdk/backend";
import type { HomepageRepository } from "./repository.js";

/** The "homepage.items" service, version 1. Runs as the caller's user. */
export interface HomepageItemsV1 {
  list: () => Promise<
    Array<{ id: number; typeId: string; title: string | null }>
  >;
}

export function createHomepageItemsService(
  ctx: PluginContext,
  repo: HomepageRepository,
): HomepageItemsV1 {
  return {
    list: async () => {
      const userId = ctx.currentActor();
      if (!userId) return [];
      const rows = await repo.listItemsByUser(userId);
      return rows.map((row) => ({
        id: row.id,
        typeId: row.typeId,
        title: row.title,
      }));
    },
  };
}
