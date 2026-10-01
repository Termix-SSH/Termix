import type { Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { tokens as tokensTable } from "./tables.js";
import { createTokenStore } from "./token-store.js";
import { createAuthSessions } from "./auth-session.js";
import { binarySpec } from "./binary.js";
import { createOpksshProvider } from "./provider.js";
import { PUBLIC_PATHS, registerRoutes } from "./routes.js";

export async function activate(ctx: PluginContext) {
  const table = await ctx.db.define(tokensTable);
  const tokens = createTokenStore(ctx, table);

  // Fetched once per activation, in the background: the Docker image ships a
  // copy, anywhere else the first boot downloads it. A sign-in waits for it.
  let binary: Promise<string> | null = null;
  const binaryPath = () => {
    if (!binary) {
      binary = ctx.process.ensureBinary(binarySpec()).catch((error) => {
        binary = null;
        throw error;
      });
    }
    return binary;
  };
  binaryPath().catch((error) =>
    ctx.log.warn(
      `OPKSSH binary is not available yet: ${error instanceof Error ? error.message : String(error)}`,
    ),
  );

  const sessions = createAuthSessions(ctx, { tokens, binaryPath });
  ctx.disposables.add(() => sessions.closeAll());

  ctx.auth.registerSshAuthProvider(createOpksshProvider(ctx, tokens, sessions));

  registerRoutes(
    ctx.http.router<Router>({ public: PUBLIC_PATHS }),
    ctx,
    sessions,
    tokens,
  );
}

export async function deactivate() {
  // Everything above was registered through ctx and is disposed by core.
}
