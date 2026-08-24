import { createCurrentSecretSourceRepository } from "../database/repositories/factory.js";
import type { SecretSourceRecord } from "../database/repositories/secret-source-repository.js";
import {
  isSecretReference,
  parseSecretReference,
  resolveConnectReference,
} from "../utils/onepassword-connect.js";
import { readSecretSourcePrivateAllowlist } from "../utils/secret-source-egress.js";

/**
 * Expands "op://vault/item/field" references in a resolved host's secret
 * fields into the actual secrets, fetched from the user's secret source.
 *
 * Runs once per host resolution, at the single point where every subsystem
 * gets its plaintext credentials - so terminal, SFTP, Docker, metrics and
 * tunnels all see real secrets without knowing references exist.
 *
 * Host resolution is hot (status polls, fleets), so resolved values are
 * cached briefly in memory; a rotated secret shows up within CACHE_TTL_MS.
 */

export const SECRET_FIELDS = [
  "password",
  "key",
  "keyPassword",
  "sudoPassword",
  "socks5Password",
  "rdpPassword",
  "vncPassword",
  "telnetPassword",
] as const;

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { value: string; expiresAt: number }>();

/** Test seam. */
export function clearExternalSecretCache(): void {
  cache.clear();
}

export type SecretResolver = (
  source: SecretSourceRecord,
  reference: string,
) => Promise<string>;

async function defaultResolver(
  source: SecretSourceRecord,
  reference: string,
): Promise<string> {
  const ref = parseSecretReference(reference);
  if (!ref) throw new Error(`Invalid secret reference: ${reference}`);
  const repository = createCurrentSecretSourceRepository();
  return resolveConnectReference(
    {
      baseUrl: source.baseUrl,
      token: repository.decryptToken(source),
      allowedPrivateHosts: await readSecretSourcePrivateAllowlist(),
    },
    ref,
  );
}

/** The user's own source first, else a shared one. */
export async function pickSecretSource(
  userId: string,
): Promise<SecretSourceRecord | null> {
  const sources =
    await createCurrentSecretSourceRepository().listVisibleToUser(userId);
  return (
    sources.find((source) => source.userId === userId) ?? sources[0] ?? null
  );
}

export async function resolveSecretReference(
  userId: string,
  reference: string,
  deps: {
    resolver?: SecretResolver;
    pickSource?: (userId: string) => Promise<SecretSourceRecord | null>;
    now?: () => number;
  } = {},
): Promise<string> {
  const now = deps.now ?? Date.now;
  const source = await (deps.pickSource ?? pickSecretSource)(userId);
  if (!source) {
    throw new Error(
      "This host uses a secret reference but no secret source is configured",
    );
  }
  const cacheKey = `${source.id}:${reference.trim()}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now()) return cached.value;

  const value = await (deps.resolver ?? defaultResolver)(source, reference);
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
