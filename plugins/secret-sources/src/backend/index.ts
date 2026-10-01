import type { Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { sources } from "./tables.js";
import { createSecretSourceRepository } from "./repository.js";
import { createTokenStore } from "./token-store.js";
import { registerSecretSourceRoutes } from "./routes.js";
import { registerOnePasswordResolver } from "./resolver.js";

export async function activate(ctx: PluginContext) {
  const table = await ctx.db.define(sources);
  const repository = createSecretSourceRepository(ctx.db, table);
  const tokenStore = createTokenStore(ctx);

  registerSecretSourceRoutes(
    ctx.http.router<Router>(),
    ctx,
    repository,
    tokenStore,
  );
  registerOnePasswordResolver(ctx, repository, tokenStore);

  ctx.log.info("Secret sources routes mounted at /plugin-api/secret-sources");
}

export async function deactivate() {
  // Everything above was registered through ctx and is disposed by core.
}
