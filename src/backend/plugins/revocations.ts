/**
 * Keeps the root signed revocation lists current: read from disk before the
 * boot scan, fetched on boot and once a day, applied to running plugins.
 * Offline servers keep the last list they had.
 *
 * The same pass moves installed plugins from pre-chain signatures to chain
 * signatures the index lists for the exact same file, so nothing has to be
 * downloaded again before LEGACY_TRUST_UNTIL.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pluginLogger } from "../utils/logger.js";
import { getPluginsDir } from "./paths.js";
import {
  canonicalJson,
  parseEnvelope,
  verifyRevocationList,
  type ChainTier,
  type RevocationBody,
  type RevocationList,
} from "./trust-chain.js";
import {
  REVOKED_PREFIX,
  getRevocationList,
  revocationReason,
  setRevocationList,
} from "./revocation-state.js";
import { trustRoots, verifyChainSignature } from "./trust.js";
import type { LoadedPlugin } from "./loader.js";

const TIERS: ChainTier[] = ["official", "community"];
const FIRST_CHECK_MS = 30_000;
const CHECK_EVERY_MS = 24 * 60 * 60_000;

let timer: NodeJS.Timeout | null = null;

/** A dot folder, which the loader's scan skips. */
export function getTrustDir(): string {
  return path.join(getPluginsDir(), ".trust");
}

function storedFile(tier: ChainTier): string {
  return path.join(getTrustDir(), `revocations-${tier}.json`);
}

/** Next to the tier's index: <registry>/trust/<tier>/revocations.json. */
export async function revocationsUrl(tier: ChainTier): Promise<string> {
  const { communitySource, getRegistryUrl } =
    await import("./registry-index.js");
  const index = tier === "official" ? getRegistryUrl() : communitySource().url;
  return new URL(`../trust/${tier}/revocations.json`, index).toString();
}

export class RevocationRefused extends Error {}

/**
 * Takes a fetched list if it is signed, for this tier and not older than
 * the one held. Returns whether anything changed.
 */
export function acceptRevocationList(tier: ChainTier, raw: unknown): boolean {
  const current = getRevocationList(tier);
  const revokedRoots = new Set(
    (current?.keys ?? [])
      .map((key) => key.keyId)
      .filter((id) => trustRoots()[tier].some((root) => root.id === id)),
  );
  const result = verifyRevocationList(
    raw as RevocationList,
    tier,
    trustRoots(),
    revokedRoots,
  );
  if (result.ok === false) throw new RevocationRefused(result.reason);
  const next = result.list;
  if (current) {
    if (next.version < current.version) {
      throw new RevocationRefused(
        `list version ${next.version} is older than ${current.version}`,
      );
    }
    if (next.version === current.version) {
      if (canonicalJson(next) !== canonicalJson(current)) {
        throw new RevocationRefused(
          `list version ${next.version} changed without a new version`,
        );
      }
      return false;
    }
    // A revoked root stays revoked, or it could sign itself back in.
    for (const id of revokedRoots) {
      if (!next.keys.some((key) => key.keyId === id)) {
        throw new RevocationRefused(`list drops revoked root ${id}`);
      }
    }
  }
  setRevocationList(tier, next);
  return true;
}

async function writeStored(tier: ChainTier, raw: unknown): Promise<void> {
  await fs.promises.mkdir(getTrustDir(), { recursive: true });
  const file = storedFile(tier);
  const temp = `${file}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  await fs.promises.writeFile(temp, JSON.stringify(raw));
  await fs.promises.rename(temp, file);
}

/** Before the boot scan: the lists this server last accepted. */
export async function loadStoredRevocations(): Promise<void> {
  for (const tier of TIERS) {
    try {
      const raw = JSON.parse(
        await fs.promises.readFile(storedFile(tier), "utf8"),
      );
      setRevocationList(tier, null);
      acceptRevocationList(tier, raw);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") continue;
      pluginLogger.warn(
        `Stored ${tier} revocation list was not used: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { operation: "plugin_trust" },
      );
    }
  }
}

/** Fetches both lists. Returns the tiers whose list changed. */
const FAILING_KEY = "revocation_check_failing";

/**
 * Writes one audit line (and so one admin alert) when the check starts
 * failing, and nothing more until it works again. Kept in settings so an
 * offline server doesn't report it on every restart.
 */
async function noteCheckOutcome(failures: string[]): Promise<void> {
  try {
    const { createCurrentSettingsRepository } =
      await import("../database/repositories/factory.js");
    const settings = createCurrentSettingsRepository();
    const failing = (await settings.get(FAILING_KEY)) === "true";
    if (failures.length === 0) {
      if (failing) await settings.set(FAILING_KEY, "false");
      return;
    }
    if (failing) return;
    await settings.set(FAILING_KEY, "true");
    const { logAudit } = await import("../utils/audit-logger.js");
    await logAudit({
      userId: null,
      username: "system",
      action: "revocation_check_failed",
      resourceType: "plugin_trust",
      details: JSON.stringify({ failures }),
      success: false,
      errorMessage: failures.join("; ").slice(0, 500),
    });
  } catch {
    // reporting must not stop the check
  }
}

export async function fetchRevocations(): Promise<ChainTier[]> {
  const { fetchRegistryJson } = await import("./registry-index.js");
  const changed: ChainTier[] = [];
  const failures: string[] = [];
  for (const tier of TIERS) {
    try {
      const raw = await fetchRegistryJson(await revocationsUrl(tier));
      if (acceptRevocationList(tier, raw)) {
        await writeStored(tier, raw);
        changed.push(tier);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${tier}: ${message}`);
      pluginLogger.warn(
        `Could not update the ${tier} revocation list: ${message}`,
        { operation: "plugin_trust" },
      );
    }
  }
  await noteCheckOutcome(failures);
  return changed;
}

/**
 * Stops running plugins the lists revoke and starts ones a newer list no
 * longer revokes. Admins get one alert per revoked plugin version.
 */
export async function applyRevocations(): Promise<{
  stopped: string[];
  restored: string[];
}> {
  const { getPluginRuntime, deactivatePlugin, activatePlugin } =
    await import("./index.js");
  const { createCurrentPluginRepository } =
    await import("../database/repositories/factory.js");
  const { sendCoreAlert } = await import("../notify/core-notify.js");
  const repository = createCurrentPluginRepository();
  const records = new Map(
    (await repository.listAll()).map((record) => [record.id, record]),
  );
  const { loader } = getPluginRuntime();
  const stopped: string[] = [];
  const restored: string[] = [];

  for (const plugin of loader.list()) {
    const reason = revocationReason({
      id: plugin.id,
      version: plugin.manifest.version,
      signedTier: plugin.signedTier,
      signedBy: plugin.signedBy,
      signedRoot: plugin.signedRoot,
    });
    const record = records.get(plugin.id);
    const wanted =
      !!record && ["enabled", "failed", "blocked"].includes(record.state);

    if (reason) {
      if (plugin.state === "blocked" && plugin.lastError === reason) continue;
      if (plugin.state === "active" || plugin.state === "activating") {
        await deactivatePlugin(plugin.id);
      }
      plugin.state = "blocked";
      plugin.lastError = reason;
      if (wanted) {
        await repository.update(plugin.id, {
          state: "blocked",
          lastError: reason,
        });
      }
      stopped.push(plugin.id);
      pluginLogger.warn(`Plugin ${plugin.id} was turned off: ${reason}`, {
        operation: "plugin_trust",
      });
      await sendCoreAlert({
        title: "A plugin was turned off",
        body: `${plugin.manifest.name ?? plugin.id} ${plugin.manifest.version} was turned off because Termix revoked it. ${reason.slice(REVOKED_PREFIX.length + 2)}. Update it or remove it in Plugins.`,
        severity: "critical",
        category: "termix.plugin-revoked",
        dedupeKey: `plugin-revoked:${plugin.id}:${plugin.manifest.version}`,
        audience: "admins",
      });
      continue;
    }

    if (
      plugin.state === "blocked" &&
      plugin.lastError?.startsWith(REVOKED_PREFIX) &&
      wanted
    ) {
      try {
        await activatePlugin(plugin.id);
        await repository.update(plugin.id, {
          state: "enabled",
          lastError: null,
        });
        restored.push(plugin.id);
      } catch (error) {
        pluginLogger.warn(
          `Could not restart ${plugin.id} after its revocation was lifted: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { operation: "plugin_trust" },
        );
      }
    }
  }
  return { stopped, restored };
}

/**
 * Rewrites a pre-chain .sig as a chain envelope when the index lists one
 * for the very same file. Returns the plugin ids that moved over.
 */
export async function upgradeLegacySignatures(
  plugins: readonly LoadedPlugin[],
): Promise<string[]> {
  const candidates = plugins.filter(
    (plugin) =>
      plugin.artifact &&
      (plugin.signedTier === "official" || plugin.signedTier === "community"),
  );
  if (candidates.length === 0) return [];
  const { communitySource, fetchRegistryIndex, officialSource } =
    await import("./registry-index.js");
  const upgraded: string[] = [];

  for (const tier of TIERS) {
    const mine = candidates.filter((plugin) => plugin.signedTier === tier);
    if (mine.length === 0) continue;
    let index;
    try {
      index = await fetchRegistryIndex(
        tier === "official" ? officialSource() : communitySource(),
      );
    } catch {
      continue;
    }
    for (const plugin of mine) {
      const sigFile = `${plugin.artifact}.sig`;
      try {
        const current = await fs.promises.readFile(sigFile, "utf8");
        if (parseEnvelope(current)) continue;
        const entry = index.plugins.find((item) => item.id === plugin.id);
        const release = [
          ...(entry?.versions ?? []),
          ...(entry?.prereleases ?? []),
        ].find((item) => item.version === plugin.manifest.version);
        if (!release || release.chain.length === 0) continue;
        const buffer = await fs.promises.readFile(plugin.artifact!);
        const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
        if (sha256 !== release.sha256) continue;
        for (const envelope of release.chain) {
          const result = verifyChainSignature(buffer, sha256, envelope, tier, {
            mode: "download",
          });
          if (result.ok === false) continue;
          await fs.promises.writeFile(
            `${sigFile}.tmp`,
            JSON.stringify(envelope),
          );
          await fs.promises.rename(`${sigFile}.tmp`, sigFile);
          plugin.signedBy = result.keyId;
          plugin.signedRoot = result.rootId;
          upgraded.push(plugin.id);
          break;
        }
      } catch (error) {
        pluginLogger.warn(
          `Could not move ${plugin.id} to a chain signature: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { operation: "plugin_trust" },
        );
      }
    }
  }
  return upgraded;
}

export async function runTrustCheck(): Promise<void> {
  const changed = await fetchRevocations();
  const { getPluginRuntime } = await import("./index.js");
  const plugins = getPluginRuntime().loader.list();
  const upgraded = await upgradeLegacySignatures(plugins);
  if (upgraded.length > 0) {
    pluginLogger.info(
      `Moved ${upgraded.length} plugin(s) to chain signatures: ${upgraded.join(", ")}`,
      { operation: "plugin_trust" },
    );
  }
  if (changed.length > 0) await applyRevocations();
}

export function startTrustChecks(): void {
  if (timer) return;
  const run = () =>
    void runTrustCheck().catch((error) => {
      pluginLogger.warn(
        `Plugin trust check failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { operation: "plugin_trust" },
      );
    });
  setTimeout(run, FIRST_CHECK_MS).unref?.();
  timer = setInterval(run, CHECK_EVERY_MS);
  timer.unref?.();
}

/** Test seam. */
export function stopTrustChecks(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export type { RevocationBody };
