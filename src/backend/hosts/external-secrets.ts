import { requireSecretResolver } from "./connect/secret-resolver-registry.js";

/**
 * Expands "<scheme>://..." references ("op://vault/item/field" for 1Password
 * Connect, and so on) in a resolved host's secret fields into the actual
 * secrets, resolved by whichever plugin registered that scheme through
 * ctx.credentials.registerSecretResolver.
 *
 * Runs once per host resolution, at the single point where every subsystem
 * gets its plaintext credentials - so terminal, SFTP, Docker, metrics and
 * tunnels all see real secrets without knowing references exist.
 *
 * Host resolution is hot (status polls, fleets), so resolved values are
 * cached briefly in memory; a rotated secret shows up within CACHE_TTL_MS.
 */

const SECRET_FIELDS = [
  "password",
  "key",
  "keyPassword",
  "sudoPassword",
  "socks5Password",
  "rdpPassword",
  "vncPassword",
  "telnetPassword",
] as const;

const REFERENCE_PATTERN = /^([a-z][a-z0-9+.-]*):\/\//i;

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { value: string; expiresAt: number }>();

/** Test seam. */
export function clearExternalSecretCache(): void {
  cache.clear();
}

export function isSecretReference(value: unknown): value is string {
  return typeof value === "string" && REFERENCE_PATTERN.test(value.trim());
}

function referenceScheme(reference: string): string {
  const match = REFERENCE_PATTERN.exec(reference.trim());
  return (match?.[1] ?? "").toLowerCase();
}

export type SecretResolver = (
  userId: string,
  reference: string,
) => Promise<string>;

async function defaultResolver(
  userId: string,
  reference: string,
): Promise<string> {
  const scheme = referenceScheme(reference);
  const resolver = requireSecretResolver(scheme);
  return resolver.resolve(userId, reference);
}

export async function resolveSecretReference(
  userId: string,
  reference: string,
  deps: {
    resolver?: SecretResolver;
    now?: () => number;
  } = {},
): Promise<string> {
  const now = deps.now ?? Date.now;
  const cacheKey = `${userId}:${reference.trim()}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now()) return cached.value;

  const value = await (deps.resolver ?? defaultResolver)(userId, reference);
  cache.set(cacheKey, { value, expiresAt: now() + CACHE_TTL_MS });
  return value;
}

/** Replaces every reference in the host's secret fields, in place. */
export async function resolveExternalSecretRefs(
  host: Record<string, unknown>,
  userId: string,
  deps?: Parameters<typeof resolveSecretReference>[2],
): Promise<void> {
  for (const field of SECRET_FIELDS) {
    const value = host[field];
    if (!isSecretReference(value)) continue;
    host[field] = await resolveSecretReference(userId, value, deps);
  }
}
