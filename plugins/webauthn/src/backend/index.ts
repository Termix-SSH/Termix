import type { Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { credentials } from "./tables.js";
import { createCredentialRepository } from "./repository.js";
import { createPasskeyService } from "./passkeys.js";
import { PUBLIC_PATHS, registerPasskeyRoutes } from "./routes.js";

export async function activate(ctx: PluginContext) {
  const table = await ctx.db.define(credentials);
  const repository = createCredentialRepository(ctx.db, table);
  const passkeys = createPasskeyService(ctx, repository);

  // No describe: a passkey only helps a user who already registered one, so
  // it never counts for the password lockout guard.
  ctx.auth.registerLoginMethod({
    id: "passkey",
    labelKey: "signIn",
    icon: "fingerprint",
    kind: "form",
    verify: (request) => passkeys.verifyLogin(request.body ?? {}),
  });

  registerPasskeyRoutes(
    ctx.http.router<Router>({ public: PUBLIC_PATHS }),
    ctx,
    repository,
    passkeys,
  );
}

export async function deactivate() {
  // Everything above was registered through ctx and is disposed by core.
}
