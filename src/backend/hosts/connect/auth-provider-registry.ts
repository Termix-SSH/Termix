/**
 * Every SSH auth type the server knows how to connect with.
 *
 * Core registers password, key, credential, agent and none. The rest come from
 * plugins through ctx.auth.registerSshAuthProvider, or for 2.9.0 from
 * src/backend/auth/legacy-providers.ts. A type with no provider fails the
 * connect with a message naming the plugin that would provide it.
 */

import type {
  KeyboardInteractiveInterceptor,
  SshAuthProvider,
} from "./types.js";

const providers = new Map<string, SshAuthProvider>();
const interceptors = new Map<string, KeyboardInteractiveInterceptor>();

export interface SshAuthTypeOwner {
  pluginId: string;
  pluginName: string;
}

/**
 * Which plugin declares which auth type, from every manifest on disk
 * including disabled ones. Set by the plugin runtime.
 */
let ownerSource: () => Array<SshAuthTypeOwner & { type: string }> = () => [];

export function setSshAuthTypeOwnerSource(
  source: () => Array<SshAuthTypeOwner & { type: string }>,
): void {
  ownerSource = source;
}

export function listSshAuthTypeOwners(): Array<
  SshAuthTypeOwner & { type: string }
> {
  return ownerSource();
}

export function findSshAuthTypeOwner(type: string): SshAuthTypeOwner | null {
  const owner = ownerSource().find((entry) => entry.type === type);
  return owner
    ? { pluginId: owner.pluginId, pluginName: owner.pluginName }
    : null;
}

export class SshAuthProviderMissingError extends Error {
  readonly code = "SSH_AUTH_PROVIDER_MISSING";
  constructor(
    readonly authType: string,
    readonly owner: SshAuthTypeOwner | null,
  ) {
    super(
      owner
        ? `This host uses ${authType}, which needs the ${owner.pluginName} plugin`
        : `This host uses ${authType}, which no enabled plugin provides`,
    );
    this.name = "SshAuthProviderMissingError";
  }
}

export function registerSshAuthProvider(provider: SshAuthProvider): () => void {
  const existing = providers.get(provider.type);
  if (existing && existing.pluginId !== provider.pluginId) {
    throw new Error(
      `SSH auth type "${provider.type}" is already provided by ${existing.pluginId}`,
    );
  }
  providers.set(provider.type, provider);
  return () => {
    if (providers.get(provider.type) === provider) {
      providers.delete(provider.type);
    }
  };
}

export function getSshAuthProvider(type: string): SshAuthProvider | undefined {
  return providers.get(type);
}

/** Throws SshAuthProviderMissingError when nothing provides the type. */
export function requireSshAuthProvider(type: string): SshAuthProvider {
  const provider = providers.get(type);
  if (!provider) {
    throw new SshAuthProviderMissingError(type, findSshAuthTypeOwner(type));
  }
  return provider;
}

export function listSshAuthProviders(): SshAuthProvider[] {
  return [...providers.values()];
}

/** Types a stored credential may use. */
export function listCredentialTypes(): string[] {
  return listSshAuthProviders()
    .filter((provider) => provider.credentialType)
    .map((provider) => provider.type);
}

export function registerKeyboardInteractiveInterceptor(
  interceptor: KeyboardInteractiveInterceptor,
): () => void {
  interceptors.set(interceptor.id, interceptor);
  return () => {
    if (interceptors.get(interceptor.id) === interceptor) {
      interceptors.delete(interceptor.id);
    }
  };
}

export function listKeyboardInteractiveInterceptors(): KeyboardInteractiveInterceptor[] {
  return [...interceptors.values()];
}

/** Test helper. */
export function resetSshAuthRegistryForTests(): void {
  providers.clear();
  interceptors.clear();
  ownerSource = () => [];
}
