import type { Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { providers } from "./tables.js";
import { createProviderStore } from "./providers.js";
import { createLdapLogin, METHOD_ID } from "./ldap.js";
import { registerLdapRoutes } from "./routes.js";

export async function activate(ctx: PluginContext) {
  const table = await ctx.db.define(providers);
  const store = createProviderStore(ctx, table);

  // One form per enabled directory.
  ctx.auth.registerLoginMethod({
    id: METHOD_ID,
    labelKey: "loginWithLdap",
    icon: "server",
    kind: "form",
    external: true,
    describe: async () =>
      (await store.listRows()).map((row) => ({
        id: String(row.id),
        label: row.name,
        enabled: !!row.enabled,
        type: "ldap",
      })),
    verify: createLdapLogin(ctx, store),
  });

  registerLdapRoutes(ctx.http.router<Router>(), ctx, store);
}

export async function deactivate() {
  // Everything above was registered through ctx and is disposed by core.
}
