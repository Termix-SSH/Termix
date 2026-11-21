/**
 * Which plugin resolves a "<scheme>://..." secret reference in a host's
 * secret fields ("op://vault/item/field" for 1Password Connect, and so on).
 *
 * Core registers nothing here: every scheme comes from a plugin through
 * ctx.credentials.registerSecretResolver. A reference whose scheme has no
 * resolver fails the connect with a message naming the plugin that would
 * provide it, the same shape as SshAuthProviderMissingError.
 */

import { waitForPluginStartup } from "./plugin-startup.js";

export interface SecretResolverOwner {
  pluginId: string;
  pluginName: string;
}

export type SecretResolveFn = (
  userId: string,
  reference: string,
) => Promise<string>;

interface SecretResolverRegistration extends SecretResolverOwner {
  resolve: SecretResolveFn;
  /** A tab of the owner where a person unlocks what the resolver reads. */
  unlockTab?: string;
}

const resolvers = new Map<string, SecretResolverRegistration>();

/**
 * Which plugin declares which secret scheme, from every manifest on disk
 * including disabled ones. Set by the plugin runtime, mirroring
 * setSshAuthTypeOwnerSource.
 */
let ownerSource: () => Array<
  SecretResolverOwner & { scheme: string }
> = () => [];

export function setSecretResolverOwnerSource(
  source: () => Array<SecretResolverOwner & { scheme: string }>,
): void {
  ownerSource = source;
}

function findSchemeOwner(scheme: string): SecretResolverOwner | null {
  const owner = ownerSource().find((entry) => entry.scheme === scheme);
  return owner
    ? { pluginId: owner.pluginId, pluginName: owner.pluginName }
    : null;
}

class SecretResolverMissingError extends Error {
  readonly code = "SECRET_RESOLVER_MISSING";
  constructor(
    readonly scheme: string,
    readonly owner: SecretResolverOwner | null,
  ) {
    super(
      owner
        ? `This host uses a "${scheme}://" secret reference, which needs the ${owner.pluginName} plugin`
        : `This host uses a "${scheme}://" secret reference, which no enabled plugin resolves`,
    );
    this.name = "SecretResolverMissingError";
  }
}

export function registerSecretResolver(
  scheme: string,
  owner: SecretResolverOwner,
  resolve: SecretResolveFn,
  options: { unlockTab?: string } = {},
): () => void {
  const existing = resolvers.get(scheme);
  if (existing && existing.pluginId !== owner.pluginId) {
    throw new Error(
      `Secret scheme "${scheme}" is already resolved by ${existing.pluginId}`,
    );
  }
  const registration: SecretResolverRegistration = {
    ...owner,
    resolve,
    ...(options.unlockTab ? { unlockTab: options.unlockTab } : {}),
  };
  resolvers.set(scheme, registration);
  return () => {
    if (resolvers.get(scheme) === registration) {
      resolvers.delete(scheme);
    }
  };
}

export function getSecretResolver(
  scheme: string,
): SecretResolverRegistration | undefined {
  return resolvers.get(scheme);
}

export function requireSecretResolver(
  scheme: string,
): SecretResolverRegistration {
  const resolver = resolvers.get(scheme);
  if (!resolver) {
    throw new SecretResolverMissingError(scheme, findSchemeOwner(scheme));
  }
  return resolver;
}

/** Like requireSecretResolver, after waiting for an owner still starting. */
export async function awaitSecretResolver(
  scheme: string,
): Promise<SecretResolverRegistration> {
  if (!resolvers.has(scheme)) {
    const owner = findSchemeOwner(scheme);
    if (owner) await waitForPluginStartup(owner.pluginId);
  }
  return requireSecretResolver(scheme);
}

/** Test seam. */
export function resetSecretResolverRegistryForTests(): void {
  resolvers.clear();
  ownerSource = () => [];
}
