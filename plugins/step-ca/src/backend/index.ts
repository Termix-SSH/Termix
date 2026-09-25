import type { Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { certs as certsTable } from "./tables.js";
import { createCertStore } from "./cert-store.js";
import { createRuntime } from "./runtime.js";
import { createAuthSessions } from "./auth-session.js";
import { createStepCaProvider } from "./provider.js";
import { PUBLIC_PATHS, registerRoutes } from "./routes.js";

export async function activate(ctx: PluginContext) {
  const table = await ctx.db.define(certsTable);
  const certs = createCertStore(ctx, table);

  const runtime = createRuntime(ctx);
  const sessions = createAuthSessions(ctx, { certs, runtime });
  ctx.disposables.add(async () => {
    sessions.closeAll();
    await runtime.close();
  });

  ctx.auth.registerSshAuthProvider(createStepCaProvider(ctx, certs, sessions));

  registerRoutes(ctx.http.router<Router>({ public: PUBLIC_PATHS }), sessions);
}

export async function deactivate() {
  // Everything above was registered through ctx and is disposed by core.
}
