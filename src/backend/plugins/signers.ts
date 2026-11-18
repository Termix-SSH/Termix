/**
 * Remembers which key signed each installed plugin and tells admins when a
 * new version comes signed by a different one. A planned key change looks
 * the same as a stolen key being used, so it is always worth a look.
 */

import type { LoadedPlugin } from "./loader.js";
import { pluginLogger } from "../utils/logger.js";
import { COMMUNITY_PLUGIN_KEYS, TRUSTED_PLUGIN_KEYS } from "./trust.js";

const SIGNERS_KEY = "plugin_signers";

const PRE_CHAIN = new Set(
  [...TRUSTED_PLUGIN_KEYS, ...COMMUNITY_PLUGIN_KEYS].map((key) => key.id),
);

export interface Signer {
  key: string;
  tier: string;
}

export interface SignerChange {
  id: string;
  name: string;
  version: string;
  from: Signer;
  to: Signer;
}

async function settings() {
  const { createCurrentSettingsRepository } =
    await import("../database/repositories/factory.js");
  return createCurrentSettingsRepository();
}

function parse(raw: string | null | undefined): Record<string, Signer> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Compares against what was stored, stores the new signers, returns changes. */
export async function recordSigners(
  plugins: readonly LoadedPlugin[],
): Promise<SignerChange[]> {
  const store = await settings();
  const known = parse(await store.get(SIGNERS_KEY));
  const changes: SignerChange[] = [];
  let dirty = false;
  for (const plugin of plugins) {
    if (!plugin.signedBy || !plugin.signedTier) continue;
    const next: Signer = { key: plugin.signedBy, tier: plugin.signedTier };
    const before = known[plugin.id];
    if (before && before.key === next.key && before.tier === next.tier)
      continue;
    // The planned move from the pre-chain key to the chain is not news.
    const moveOver =
      before && PRE_CHAIN.has(before.key) && before.tier === next.tier;
    if (before && !moveOver) {
      changes.push({
        id: plugin.id,
        name: plugin.manifest.name ?? plugin.id,
        version: plugin.manifest.version,
        from: before,
        to: next,
      });
    }
    known[plugin.id] = next;
    dirty = true;
  }
  if (dirty) await store.set(SIGNERS_KEY, JSON.stringify(known));
  return changes;
}

/** One alert per new key, naming every plugin it now signs. */
export async function noteSignerChanges(
  plugins: readonly LoadedPlugin[],
): Promise<void> {
  try {
    const changes = await recordSigners(plugins);
    if (changes.length === 0) return;
    const { sendCoreAlert } = await import("../notify/core-notify.js");
    const byKey = new Map<string, SignerChange[]>();
    for (const change of changes) {
      const key = `${change.to.tier}:${change.to.key}`;
      byKey.set(key, [...(byKey.get(key) ?? []), change]);
    }
    for (const [key, group] of byKey) {
      const tierChanged = group.some(
        (change) => change.from.tier !== change.to.tier,
      );
      const names = group
        .map((change) => `${change.name} ${change.version}`)
        .join(", ");
      pluginLogger.warn(`Plugin signing key changed to ${key}: ${names}`, {
        operation: "plugin_trust",
      });
      await sendCoreAlert({
        title: "A plugin's signing key changed",
        body: tierChanged
          ? `${names} is now signed by a key from another source (${group[0].to.tier}, key ${group[0].to.key}). If you did not expect this, turn it off in Plugins and check where it came from.`
          : `${names} is now signed by a new ${group[0].to.tier} key (${group[0].to.key}). Termix moves to new keys from time to time. If you did not expect it, check the Termix signing keys page.`,
        severity: tierChanged ? "warning" : "info",
        category: "termix.plugin-signer",
        dedupeKey: `plugin-signer:${key}:${group.map((change) => change.id).join(",")}`,
        audience: "admins",
      });
    }
  } catch (error) {
    pluginLogger.warn(
      `Could not check plugin signing keys: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { operation: "plugin_trust" },
    );
  }
}
