import { registerLegacySshAuthProviders } from "../../auth/legacy-providers.js";
import { registerBuiltinSshAuthProviders } from "./builtin-providers.js";

let registered = false;

/**
 * Registers core's providers once. Called lazily by the pipeline so tests and
 * scripts get the same set as a running server without a start-up hook.
 */
export function ensureCoreSshAuthProviders(): void {
  if (registered) return;
  registered = true;
  registerBuiltinSshAuthProviders();
  registerLegacySshAuthProviders();
}

/** Test helper, pairs with resetSshAuthRegistryForTests. */
export function resetCoreSshAuthProvidersForTests(): void {
  registered = false;
}
