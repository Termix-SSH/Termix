/**
 * Which registries this server reads plugins from.
 *
 * Official is always on. Community is off until an admin turns it on. Custom
 * registries are added by URL: their index names the key they sign with, the
 * admin confirms its fingerprint, and that key is pinned. A later key change
 * in the index is never followed, the admin has to add the registry again.
 *
 * Stored as one JSON value in the settings table.
 */

import { pluginLogger } from "../utils/logger.js";
import {
  OFFICIAL_REGISTRY_ID,
  COMMUNITY_REGISTRY_ID,
  communitySource,
  fetchIndexAt,
  officialSource,
  type RegistrySource,
} from "./registry-index.js";
import {
  COMMUNITY_PLUGIN_KEYS,
  TRUSTED_PLUGIN_KEYS,
  getCustomPluginKeys,
  isPluginPublicKey,
  pluginKeyId,
  setCustomPluginKeys,
  type TrustedPluginKey,
} from "./trust.js";

const CONFIG_KEY = "plugin_registries";
/** Keys a linked desktop copied from its server, so mirrored plugins load. */
const SYNCED_KEYS_KEY = "plugin_registry_synced_keys";
/** `addedIn` of a key only the linked server vouches for. */
const SYNCED = "synced";
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const MAX_ID_LENGTH = 40;
const MAX_NAME_LENGTH = 80;
const MAX_CUSTOM = 20;

export interface CustomRegistry {
  id: string;
  name: string;
  url: string;
  publicKey: string;
  keyId: string;
  enabled: boolean;
  addedAt: string;
}

export interface RegistriesConfig {
  community: { enabled: boolean };
  custom: CustomRegistry[];
}

export class RegistryError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

async function settings() {
  const { createCurrentSettingsRepository } =
    await import("../database/repositories/factory.js");
  return createCurrentSettingsRepository();
}

function parseCustom(raw: unknown): CustomRegistry | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  if (
    typeof entry.id !== "string" ||
    !ID_PATTERN.test(entry.id) ||
    typeof entry.url !== "string" ||
    !isPluginPublicKey(entry.publicKey)
  ) {
    return null;
  }
  return {
    id: entry.id,
    name: typeof entry.name === "string" ? entry.name : entry.id,
    url: entry.url,
    publicKey: entry.publicKey,
    keyId: pluginKeyId(entry.publicKey),
    enabled: entry.enabled !== false,
    addedAt: typeof entry.addedAt === "string" ? entry.addedAt : "",
  };
}

export function parseRegistriesConfig(raw: string | null): RegistriesConfig {
  const config: RegistriesConfig = {
    community: { enabled: false },
    custom: [],
  };
  if (!raw) return config;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const community = parsed?.community as Record<string, unknown> | undefined;
    config.community.enabled = community?.enabled === true;
    if (Array.isArray(parsed?.custom)) {
      config.custom = parsed.custom
        .map(parseCustom)
        .filter((entry): entry is CustomRegistry => entry !== null);
    }
  } catch {
    // A broken value falls back to official only.
  }
  return config;
}

export async function readRegistriesConfig(): Promise<RegistriesConfig> {
  return parseRegistriesConfig(await (await settings()).get(CONFIG_KEY));
}

async function writeRegistriesConfig(config: RegistriesConfig): Promise<void> {
  await (await settings()).set(CONFIG_KEY, JSON.stringify(config));
  await applyCustomKeys(config);
}

function toKey(publicKey: string, addedIn = "admin"): TrustedPluginKey {
  return { id: pluginKeyId(publicKey), publicKey, addedIn };
}

async function readSyncedKeys(): Promise<string[]> {
  const raw = await (await settings()).get(SYNCED_KEYS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isPluginPublicKey) : [];
  } catch {
    return [];
  }
}

/**
 * Trusts the key of every custom registry, on or off: a plugin installed
 * from a registry that was later turned off still has to load. A key added
 * here wins over the same key synced from a server.
 */
async function applyCustomKeys(config: RegistriesConfig): Promise<void> {
  const keys = new Map<string, TrustedPluginKey>();
  for (const publicKey of await readSyncedKeys()) {
    keys.set(pluginKeyId(publicKey), toKey(publicKey, SYNCED));
  }
  for (const entry of config.custom) {
    keys.set(entry.keyId, toKey(entry.publicKey));
  }
  setCustomPluginKeys([...keys.values()]);
}

/** Whether this app trusts the key independently of its linked server. */
export function isLocallyTrustedPluginKey(keyId: string): boolean {
  return (
    [...TRUSTED_PLUGIN_KEYS, ...COMMUNITY_PLUGIN_KEYS].some(
      (key) => key.id === keyId,
    ) ||
    getCustomPluginKeys().some(
      (key) => key.id === keyId && key.addedIn !== SYNCED,
    )
  );
}

/** Called before the boot scan so plugins from custom registries load. */
export async function loadCustomRegistryKeys(): Promise<void> {
  try {
    await applyCustomKeys(await readRegistriesConfig());
  } catch (error) {
    pluginLogger.warn(
      `Could not read plugin registries: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { operation: "plugin_init" },
    );
  }
}

/** A linked desktop trusts the keys of its server's custom registries. */
export async function setSyncedRegistryKeys(
  publicKeys: readonly unknown[],
): Promise<void> {
  const valid = [...new Set(publicKeys.filter(isPluginPublicKey))].sort();
  const current = (await readSyncedKeys()).sort();
  if (valid.join() !== current.join()) {
    await (await settings()).set(SYNCED_KEYS_KEY, JSON.stringify(valid));
  }
  await applyCustomKeys(await readRegistriesConfig());
}

export function customSource(entry: CustomRegistry): RegistrySource {
  return {
    id: entry.id,
    name: entry.name,
    url: entry.url,
    tier: "custom",
    keys: [toKey(entry.publicKey)],
  };
}

/** Every registry plugins can come from right now, official first. */
export async function listSources(): Promise<RegistrySource[]> {
  const config = await readRegistriesConfig();
  const sources = [officialSource()];
  if (config.community.enabled) sources.push(communitySource());
  for (const entry of config.custom) {
    if (entry.enabled) sources.push(customSource(entry));
  }
  return sources;
}

export async function findSource(id: string): Promise<RegistrySource | null> {
  return (await listSources()).find((source) => source.id === id) ?? null;
}

/** The pinned key of a custom registry, for spotting a changed index key. */
export async function pinnedKeyOf(id: string): Promise<string | null> {
  const config = await readRegistriesConfig();
  return config.custom.find((entry) => entry.id === id)?.publicKey ?? null;
}

export interface RegistryPreview {
  id: string;
  name: string;
  url: string;
  keyId: string;
  plugins: number;
}

function normalizeUrl(input: unknown): string {
  if (typeof input !== "string" || !input.trim()) {
    throw new RegistryError("Enter the index URL", 400, "INVALID_URL");
  }
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new RegistryError("That is not a valid URL", 400, "INVALID_URL");
  }
  if (url.protocol !== "https:") {
    throw new RegistryError("The index must use https", 400, "INVALID_URL");
  }
  url.hash = "";
  return url.toString();
}

function baseId(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_ID_LENGTH);
  return ID_PATTERN.test(cleaned) ? cleaned : "custom";
}

function uniqueId(raw: string, config: RegistriesConfig): string {
  const taken = new Set<string>([
    OFFICIAL_REGISTRY_ID,
    COMMUNITY_REGISTRY_ID,
    ...config.custom.map((entry) => entry.id),
  ]);
  const base = baseId(raw);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

async function inspect(
  input: unknown,
  config: RegistriesConfig,
): Promise<RegistryPreview & { publicKey: string }> {
  const url = normalizeUrl(input);
  if (
    url === officialSource().url ||
    url === communitySource().url ||
    config.custom.some((entry) => entry.url === url)
  ) {
    throw new RegistryError(
      "This registry is already added",
      409,
      "ALREADY_ADDED",
    );
  }
  let index;
  try {
    index = await fetchIndexAt(url);
  } catch (error) {
    throw new RegistryError(
      `Could not read the registry: ${
        error instanceof Error ? error.message : String(error)
      }`,
      502,
      "REGISTRY_UNREACHABLE",
    );
  }
  if (!index.publicKey) {
    throw new RegistryError(
      "The index has no publicKey, so its plugins cannot be checked",
      400,
      "NO_PUBLIC_KEY",
    );
  }
  return {
    id: uniqueId(index.registry || "custom", config),
    name: (index.name || index.registry || url).slice(0, MAX_NAME_LENGTH),
    url,
    keyId: pluginKeyId(index.publicKey),
    publicKey: index.publicKey,
    plugins: index.plugins.length,
  };
}

/** Reads an index so the admin can check its name and key before adding. */
export async function previewRegistry(url: unknown): Promise<RegistryPreview> {
  const { publicKey: _publicKey, ...preview } = await inspect(
    url,
    await readRegistriesConfig(),
  );
  return preview;
}

/**
 * Adds a custom registry. `keyId` is the fingerprint the admin saw in the
 * preview; the index is read again and must still name that key.
 */
export async function addRegistry(
  url: unknown,
  keyId: unknown,
): Promise<CustomRegistry> {
  const config = await readRegistriesConfig();
  if (config.custom.length >= MAX_CUSTOM) {
    throw new RegistryError(
      `At most ${MAX_CUSTOM} custom registries can be added`,
      400,
      "TOO_MANY",
    );
  }
  const preview = await inspect(url, config);
  if (typeof keyId !== "string" || keyId !== preview.keyId) {
    throw new RegistryError(
      "The registry key changed since the preview. Check it again",
      409,
      "KEY_MISMATCH",
      { keyId: preview.keyId },
    );
  }
  const entry: CustomRegistry = {
    id: preview.id,
    name: preview.name,
    url: preview.url,
    publicKey: preview.publicKey,
    keyId: preview.keyId,
    enabled: true,
    addedAt: new Date().toISOString(),
  };
  config.custom.push(entry);
  await writeRegistriesConfig(config);
  pluginLogger.info(`Added plugin registry ${entry.id} (${entry.url})`, {
    operation: "plugin_registry",
  });
  return entry;
}

export async function setRegistryEnabled(
  id: string,
  enabled: boolean,
): Promise<void> {
  const config = await readRegistriesConfig();
  if (id === OFFICIAL_REGISTRY_ID) {
    throw new RegistryError(
      "The official registry is always on",
      400,
      "OFFICIAL",
    );
  }
  if (id === COMMUNITY_REGISTRY_ID) {
    config.community.enabled = enabled;
  } else {
    const entry = config.custom.find((candidate) => candidate.id === id);
    if (!entry) {
      throw new RegistryError("Registry not found", 404, "NOT_FOUND");
    }
    entry.enabled = enabled;
  }
  await writeRegistriesConfig(config);
}

/**
 * Removes a custom registry. Refused while plugins from it are installed:
 * its key has to stay trusted for them to load.
 */
export async function removeRegistry(id: string): Promise<void> {
  if (id === OFFICIAL_REGISTRY_ID || id === COMMUNITY_REGISTRY_ID) {
    throw new RegistryError(
      "Built in registries can only be turned off",
      400,
      "BUILT_IN",
    );
  }
  const config = await readRegistriesConfig();
  if (!config.custom.some((candidate) => candidate.id === id)) {
    throw new RegistryError("Registry not found", 404, "NOT_FOUND");
  }
  const { createCurrentPluginRepository } =
    await import("../database/repositories/factory.js");
  const using = (await createCurrentPluginRepository().listAll())
    .filter((record) => record.registryId === id)
    .map((record) => record.id);
  if (using.length > 0) {
    throw new RegistryError(
      "Uninstall the plugins from this registry first",
      409,
      "REGISTRY_IN_USE",
      { plugins: using },
    );
  }
  config.custom = config.custom.filter((candidate) => candidate.id !== id);
  await writeRegistriesConfig(config);
  pluginLogger.info(`Removed plugin registry ${id}`, {
    operation: "plugin_registry",
  });
}

/** Public keys of the custom registries, for a linked desktop. */
export async function customRegistryKeys(): Promise<string[]> {
  return (await readRegistriesConfig()).custom.map((entry) => entry.publicKey);
}
