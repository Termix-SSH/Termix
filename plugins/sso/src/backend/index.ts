import type { Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { providers } from "./tables.js";
import { createProviderStore } from "./providers.js";
import { createSsoLogin, METHOD_ID } from "./login.js";
import { PUBLIC_PATHS, registerSsoRoutes } from "./routes.js";

export async function activate(ctx: PluginContext) {
  const table = await ctx.db.define(providers);
  const store = createProviderStore(ctx, table);
  const login = createSsoLogin(ctx, store);

  // One button per enabled provider.
  ctx.auth.registerLoginMethod({
    id: METHOD_ID,
    labelKey: "loginWithSso",
    icon: "key-round",
    kind: "redirect",
    external: true,
    describe: async () =>
      (await store.listInstances()).map((instance) => ({
        ...instance,
        enabled: true,
      })),
    start: login.start,
    callback: login.callback,
  });

  registerSsoRoutes(
    ctx.http.router<Router>({ public: PUBLIC_PATHS }),
    ctx,
    store,
    login,
  );
}

export async function deactivate() {
  // Everything above was registered through ctx and is disposed by core.
}
