import type { Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { providers } from "./tables.js";
import { createProviderStore } from "./providers.js";
import { createSsoLogin, METHOD_ID } from "./login.js";
import { PUBLIC_PATHS, registerSsoRoutes } from "./routes.js";

/**
 * Whether the login page starts the first provider without a click. The
 * OIDC_SILENT_LOGIN_DEFAULT environment variable pins it either way.
 */
export async function silentLoginDefault(ctx: PluginContext): Promise<boolean> {
  const pinned = process.env.OIDC_SILENT_LOGIN_DEFAULT;
  if (pinned !== undefined) return pinned.trim().toLowerCase() === "true";
  return (await ctx.settings.get("silentLoginDefault")) === true;
}

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
    describe: async () => {
      const autoStart = await silentLoginDefault(ctx);
      return (await store.listInstances()).map((instance, index) => ({
        ...instance,
        enabled: true,
        ...(autoStart && index === 0 ? { autoStart: true } : {}),
      }));
    },
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
