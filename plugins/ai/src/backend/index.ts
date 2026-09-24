import type { Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { hostImportNormalizer } from "./host-import.js";
import { createAiRepository } from "./repository.js";
import { registerAiRoutes } from "./routes.js";

export async function activate(ctx: PluginContext) {
  const repository = await createAiRepository(ctx);

  registerAiRoutes(ctx.http.router<Router>(), repository, ctx);

  ctx.registry.provide("ai.hostImportNormalizer", hostImportNormalizer);
  ctx.disposables.add(
    () =>
      void ctx.registry.revoke("ai.hostImportNormalizer", hostImportNormalizer),
  );

  // Offered by reference, not copied: this hands over a resolver, so the key
  // stays ours. Rotating or deleting the provider takes effect on the next
  // read by any borrower, and deactivate withdraws the offer. Keys are per
  // user, so a borrowed read returns the acting user's own key.
  ctx.secrets.offer("api-key", (userId: string) =>
    ctx.asUser(userId, async () => {
      const providers = await repository.listProviders(userId);
      const preferred = providers.find((provider) => provider.apiKeyPrefix);
      if (!preferred) return null;
      const withSecret = await repository.findProviderWithSecret(
        preferred.id,
        userId,
      );
      return withSecret?.apiKey ?? null;
    }),
  );

  ctx.log.info("AI assistant routes mounted at /plugin-api/ai");
}

export async function deactivate() {}
