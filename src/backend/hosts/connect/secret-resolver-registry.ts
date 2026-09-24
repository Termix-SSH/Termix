/**
 * Which plugin resolves a "<scheme>://..." secret reference in a host's
 * secret fields ("op://vault/item/field" for 1Password Connect, and so on).
 *
 * Core registers nothing here: every scheme comes from a plugin through
 * ctx.credentials.registerSecretResolver. A reference whose scheme has no
 * resolver fails the connect with a message naming the plugin that would
 * provide it, the same shape as SshAuthProviderMissingError.
 */

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

export class SecretResolverMissingError extends Error {
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
): () => void {
  const existing = resolvers.get(scheme);
  if (existing && existing.pluginId !== owner.pluginId) {
    throw new Error(
      `Secret scheme "${scheme}" is already resolved by ${existing.pluginId}`,
    );
  }
  const registration = { ...owner, resolve };
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

/** Test seam. */
export function resetSecretResolverRegistryForTests(): void {
  resolvers.clear();
  ownerSource = () => [];
}
