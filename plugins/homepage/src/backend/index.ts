import type { Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import {
  homepageItems,
  homepageLayouts,
  dashboardServiceLinks,
} from "./tables.js";
import { createHomepageRepository } from "./repository.js";
import { registerHomepageRoutes } from "./routes.js";
import { registerOutboundRoutes } from "./outbound-routes.js";
import { createHomepageItemsService } from "./services.js";

export type { HomepageItemsV1 } from "./services.js";

export async function activate(ctx: PluginContext) {
  const items = await ctx.db.define(homepageItems);
  const layouts = await ctx.db.define(homepageLayouts);
  const serviceLinks = await ctx.db.define(dashboardServiceLinks);
  const repo = createHomepageRepository(ctx.db, {
    items,
    layouts,
    serviceLinks,
  });

  const router = ctx.http.router<Router>();
  registerHomepageRoutes(router, repo, ctx);
  registerOutboundRoutes(router, ctx);

  ctx.sync.registerEntity({
    type: "homepageItems",
    table: items,
    order: 80,
    // A tile inside a folder points at the folder's row.
    references: [
      {
        field: "folderId",
        syncField: "folderSyncId",
        entityType: "homepageItems",
      },
    ],
  });
  ctx.sync.registerEntity({
    type: "dashboardServiceLinks",
    table: serviceLinks,
    order: 70,
  });

  ctx.services.provide("homepage.items", createHomepageItemsService(ctx, repo));

  ctx.log.info("Homepage routes mounted at /plugin-api/homepage");
}

export async function deactivate() {
  // Everything above was registered through ctx and is disposed by core.
}
