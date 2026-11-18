/**
 * The revocation lists this server holds, in memory. revocations.ts fetches
 * and stores them; trust.ts and the loader read them from here.
 */

import type { ChainTier, RevocationBody } from "./trust-chain.js";

const lists: Partial<Record<ChainTier, RevocationBody>> = {};

/** Start of every reason a revocation gives, so it can be told apart. */
export const REVOKED_PREFIX = "Revoked by Termix";

export function setRevocationList(
  tier: ChainTier,
  list: RevocationBody | null,
): void {
  if (list) lists[tier] = list;
  else delete lists[tier];
}

export function getRevocationList(tier: ChainTier): RevocationBody | null {
  return lists[tier] ?? null;
}

/**
 * Revoked key ids, online or root, that count for a tier. The official list
 * counts everywhere; the community list never reaches official keys.
 */
export function revokedKeyIds(tier: ChainTier): Set<string> {
  const ids = new Set<string>();
  const tiers: ChainTier[] =
    tier === "community" ? ["official", "community"] : ["official"];
  for (const name of tiers) {
    for (const key of lists[name]?.keys ?? []) ids.add(key.keyId);
  }
  return ids;
}

export interface RevocationSubject {
  id: string;
  version: string;
  signedTier?: string;
  signedBy?: string;
  signedRoot?: string;
}

function because(reason: string | undefined): string {
  const text = reason?.replace(/\s+/g, " ").trim().slice(0, 200);
  return text ? `: ${text}` : "";
}

/**
 * Why a plugin must not run, or null. The official list covers every
 * plugin; the community list only plugins the community chain signed.
 */
export function revocationReason(plugin: RevocationSubject): string | null {
  const tiers: ChainTier[] =
    plugin.signedTier === "community"
      ? ["official", "community"]
      : ["official"];
  for (const tier of tiers) {
    const list = lists[tier];
    if (!list) continue;
    const key = list.keys.find(
      (entry) =>
        entry.keyId === plugin.signedBy || entry.keyId === plugin.signedRoot,
    );
    if (key)
      return `${REVOKED_PREFIX}: its signing key was revoked${because(key.reason)}`;
    const whole = list.plugins.find((entry) => entry.id === plugin.id);
    if (whole)
      return `${REVOKED_PREFIX}: this plugin was revoked${because(whole.reason)}`;
    const version = list.versions.find(
      (entry) => entry.id === plugin.id && entry.version === plugin.version,
    );
    if (version) {
      return `${REVOKED_PREFIX}: version ${plugin.version} was revoked${because(version.reason)}`;
    }
  }
  return null;
}

/** Test seam. */
export function clearRevocationLists(): void {
  for (const tier of Object.keys(lists) as ChainTier[]) delete lists[tier];
}
