import type { PluginContext } from "@termix/plugin-sdk/backend";
import type { SecretSourceRepository } from "./repository.js";
import type { TokenStore } from "./token-store.js";
import { parseAllowlist } from "./egress.js";
import {
  parseSecretReference,
  resolveConnectReference,
} from "./onepassword-connect.js";

/** The user's own source first, else a shared one. */
async function pickSecretSource(
  repository: SecretSourceRepository,
  userId: string,
) {
  const sources = await repository.listVisibleToUser(userId);
  return (
    sources.find((source) => source.userId === userId) ?? sources[0] ?? null
  );
}

/**
 * The "op" scheme resolver: turns "op://vault/item/field" into the actual
 * secret, using whichever source the acting user can see (their own first,
 * else a shared one).
 */
export function registerOnePasswordResolver(
  ctx: PluginContext,
  repository: SecretSourceRepository,
  tokenStore: TokenStore,
): void {
  ctx.credentials.registerSecretResolver("op", async (userId, reference) => {
    const ref = parseSecretReference(reference);
    if (!ref) throw new Error(`Invalid secret reference: ${reference}`);

    const source = await pickSecretSource(repository, userId);
    if (!source) {
      throw new Error(
        "This host uses a secret reference but no secret source is configured",
      );
    }

    const token = await tokenStore.getForOwner(source.id, source.userId);
    if (!token) {
      throw new Error(
        "The secret source owner's data is locked; they need to sign in first",
      );
    }

    return resolveConnectReference(
      ctx.fetch,
      {
        baseUrl: source.baseUrl,
        token,
        allowedPrivateHosts: parseAllowlist(
          await ctx.settings.get<string>("privateEndpoints"),
        ),
      },
      ref,
    );
  });
}
