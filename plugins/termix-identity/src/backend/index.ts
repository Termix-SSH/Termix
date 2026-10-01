import type { Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { ca, identities, keys } from "./tables.js";
import { createStore } from "./store.js";
import { PUBLIC_PATHS } from "./resolver.js";
import { registerRoutes } from "./routes.js";

export async function activate(ctx: PluginContext) {
  const store = createStore(ctx, {
    identities: await ctx.db.define(identities),
    keys: await ctx.db.define(keys),
    ca: await ctx.db.define(ca),
  });

  registerRoutes(ctx, ctx.http.router<Router>({ public: PUBLIC_PATHS }), store);
}

export async function deactivate() {
  // Everything above was registered through ctx and is disposed by core.
}
