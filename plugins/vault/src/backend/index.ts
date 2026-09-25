import type { Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { profiles as profilesTable, tokens as tokensTable } from "./tables.js";
import { createProfileStore, SYNC_ENTITY } from "./profile-store.js";
import { createTokenStore } from "./token-store.js";
import { createAuthSessions } from "./auth-session.js";
import { createVaultProvider } from "./provider.js";
import { PUBLIC_PATHS, registerRoutes } from "./routes.js";

export async function activate(ctx: PluginContext) {
  const profilesDb = await ctx.db.define(profilesTable);
  const tokensDb = await ctx.db.define(tokensTable);
  const profiles = createProfileStore(ctx, profilesDb, tokensDb);
  const tokens = createTokenStore(ctx, tokensDb);

  const sessions = createAuthSessions(ctx, tokens);
  ctx.disposables.add(() => sessions.closeAll());

  ctx.auth.registerSshAuthProvider(
    createVaultProvider(ctx, profiles, tokens, sessions),
  );

  // Same wire name as 2.8, where core synced it. Hosts point at a profile
  // through the profileId host setting, not a column, so nothing references it.
  ctx.sync.registerEntity({
    type: SYNC_ENTITY,
    table: profilesDb,
    order: 20,
  });

  registerRoutes(
    ctx,
    ctx.http.router<Router>({ public: PUBLIC_PATHS }),
    profiles,
    sessions,
  );
}

export async function deactivate() {
  // Everything above was registered through ctx and is disposed by core.
}
