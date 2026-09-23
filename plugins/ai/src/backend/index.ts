import type { PluginContext } from "@termix/plugin-sdk/backend";
import { setPluginSsh } from "./ssh.js";
import { startAiService, stopAiService } from "./routes.js";
import { createCurrentAiRepository } from "../../../../src/backend/database/repositories/factory.js";

export async function activate(ctx: PluginContext) {
  setPluginSsh(ctx.ssh);
  ctx.disposables.add(() => setPluginSsh(null));
  startAiService(ctx.http.router());

  // Offered by reference, not copied: this hands over a resolver, so the key
  // stays ours. Rotating or deleting the provider takes effect on the next
  // read by any borrower, and deactivate() below withdraws the offer entirely.
  // The resolve is per-user because the keys are stored per-user and encrypted
  // under that user's data key, so a borrowed read returns the acting user's
  // own default key, never someone else's.
  ctx.secrets.offer("api-key", async (userId: string) => {
    const repository = createCurrentAiRepository();
    const providers = await repository.listProviders(userId);
    const preferred = providers.find((provider) => provider.apiKeyPrefix);
    if (!preferred) return null;

    const withSecret = await repository.findProviderWithSecret(
      preferred.id,
      userId,
    );
    return withSecret?.apiKey ?? null;
  });

  ctx.log.info("AI assistant routes mounted at /plugin-api/ai");
}

export async function deactivate() {
  stopAiService();
}
