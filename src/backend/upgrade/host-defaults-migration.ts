/**
 * Moves 2.8 and early 2.9 default settings into host defaults, and gets hosts
 * ready to be classified against them.
 *
 * Levels, each moved once:
 * - core `settings.host_defaults` (SOCKS5 and the status check) becomes the
 *   server level. Its credential and SOCKS5 password are dropped: a
 *   credential belongs to one user and a password is never a default.
 * - a folder's credential becomes that folder's auth default.
 * - ssh-terminal's admin "new host" look, tmux and command history become the
 *   server level; each user's terminal defaults, local echo and link click
 *   setting become their user level.
 * - host-metrics' "enabled for new hosts" becomes the server level.
 * - remote-desktop's per-user display settings become the user level.
 *
 * Hosts: a host saved before host defaults gets the value it really used
 * written in, where that was not its stored value. A terminal that
 * followed the user's look used the user's look; an echo mode of "default"
 * used the user's setting; a credential host with no credential used its
 * folder's; a remote desktop used the connecting user's display settings.
 * The classify pass that follows compares those against the new levels, so
 * nothing a user sees changes.
 *
 * The old rows stay in place for a downgrade until 3.0.0.
 */

import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import {
  createCurrentHostDefaultsRepository,
  createCurrentPluginSettingsRepository,
  createCurrentSettingsRepository,
} from "../database/repositories/factory.js";
import type { HostRow } from "../database/repositories/host-defaults-repository.js";
import { hostSettingsPlugins } from "../database/routes/host-plugin-settings.js";
import {
  CORE_NAMESPACE,
  defaultValuesEqual,
  normalizeSocks5Default,
  parseDefaultOverrides,
} from "../../types/host-defaults.js";
import { encodeDefaultValue } from "../hosts/defaults/levels.js";
import { folderChainPaths } from "../hosts/defaults/resolve.js";
import { databaseLogger } from "../utils/logger.js";

const TERMINAL = "ssh-terminal";
const METRICS = "host-metrics";
const DESKTOP = "remote-desktop";

const TERMINAL_APPEARANCE_KEYS = [
  "theme",
  "cursorBlink",
  "cursorStyle",
  "fontSize",
  "fontFamily",
  "scrollback",
  "letterSpacing",
  "lineHeight",
  "bellStyle",
  "minimumContrastRatio",
  "backgroundImage",
  "backgroundImageOpacity",
  "customThemeColors",
];

/** ssh-terminal admin key -> the host key it seeded. */
const TERMINAL_NEW_HOST_KEYS: Record<string, string> = {
  commandHistoryForNewHosts: "enableCommandHistory",
  newHostTheme: "theme",
  newHostFontFamily: "fontFamily",
  newHostFontSize: "fontSize",
  newHostCursorStyle: "cursorStyle",
  newHostCursorBlink: "cursorBlink",
  newHostAutoTmux: "autoTmux",
};

/** ssh-terminal keys whose "default" meant the user's own setting. */
const TERMINAL_USER_MODES: Record<string, string> = {
  localEcho: "auto",
  linkClickBehavior: "confirm",
};

const DESKTOP_DISPLAY_KEYS = [
  "colorDepth",
  "resizeMethod",
  "forceLossless",
  "enableWallpaper",
  "enableFontSmoothing",
  "enableDesktopComposition",
  "disableAudio",
  "enablePrinting",
  "enableDrive",
  "disableCopy",
  "disablePaste",
];

const MARKER_PREFIX = "host_defaults_moved_";

function decode(raw: string | null | undefined): unknown {
  if (raw === null || raw === undefined) return undefined;
  try {
    let parsed = JSON.parse(raw);
    if (typeof parsed === "string" && /^[[{]/.test(parsed)) {
      parsed = JSON.parse(parsed);
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function once(name: string, run: () => Promise<void>): Promise<void> {
  const settings = createCurrentSettingsRepository();
  const marker = `${MARKER_PREFIX}${name}`;
  if (await settings.get(marker)) return;
  await run();
  await settings.set(marker, new Date().toISOString());
}

type Level =
  | { level: "admin" }
  | { level: "user"; userId: string }
  | { level: "folder"; userId: string; folderId: number };

async function setDefault(
  scope: Level,
  namespace: string,
  key: string,
  value: unknown,
): Promise<void> {
  const repository = createCurrentHostDefaultsRepository();
  const existing = await repository.listScope(scope);
  if (existing.some((row) => row.namespace === namespace && row.key === key)) {
    return;
  }
  await repository.apply(
    scope,
    [{ namespace, key, value: encodeDefaultValue(value) }],
    [],
    null,
  );
}

async function moveCoreLevels(): Promise<void> {
  const raw = await createCurrentSettingsRepository().get("host_defaults");
  const stored = asObject(decode(raw)) ?? {};
  if (stored.useSocks5 === true) {
    await setDefault(
      { level: "admin" },
      CORE_NAMESPACE,
      "socks5",
      normalizeSocks5Default({ ...stored, socks5ProxyChain: null }),
    );
  }
  if (stored.statusCheckEnabled === false) {
    await setDefault(
      { level: "admin" },
      CORE_NAMESPACE,
      "statusCheckEnabled",
      false,
    );
  }
  if (stored.credentialId !== undefined || stored.socks5Password) {
    databaseLogger.info(
      "Host defaults no longer hold a credential or proxy password; set a credential per user or folder instead",
      { operation: "host_defaults_migration" },
    );
  }
}

async function moveFolderCredentials(): Promise<void> {
  const { createCurrentRepositoryContext } =
    await import("../database/repositories/factory.js");
  const { sshFolders } = await import("../database/db/schema.js");
  const { isNotNull } = await import("drizzle-orm");
  const rows = await createCurrentRepositoryContext()
    .drizzle.select({
      id: sshFolders.id,
      userId: sshFolders.userId,
      credentialId: sshFolders.credentialId,
    })
    .from(sshFolders)
    .where(isNotNull(sshFolders.credentialId));
  for (const row of rows) {
    await setDefault(
      { level: "folder", userId: row.userId, folderId: row.id },
      CORE_NAMESPACE,
      "auth",
      {
        authType: "credential",
        credentialId: row.credentialId,
        overrideCredentialUsername: false,
        agentSocketPath: null,
        agentIdentity: null,
      },
    );
  }
}

async function storedRows(
  pluginId: string,
  scope: "admin" | "user",
  key: string,
) {
  return (
    await createCurrentPluginSettingsRepository().listByKey(
      pluginId,
      scope,
      key,
    )
  ).filter((row) => row.value !== null);
}

async function moveTerminalLevels(): Promise<void> {
  for (const [adminKey, hostKey] of Object.entries(TERMINAL_NEW_HOST_KEYS)) {
    for (const row of await storedRows(TERMINAL, "admin", adminKey)) {
      const value = decode(row.value);
      if (value === undefined || value === null) continue;
      await setDefault({ level: "admin" }, TERMINAL, hostKey, value);
    }
  }
  for (const row of await storedRows(TERMINAL, "user", "terminalDefaults")) {
    const values = asObject(decode(row.value));
    if (!values || !row.scopeId) continue;
    for (const key of TERMINAL_APPEARANCE_KEYS) {
      if (values[key] === undefined) continue;
      await setDefault(
        { level: "user", userId: row.scopeId },
        TERMINAL,
        key,
        values[key],
      );
    }
  }
  for (const key of Object.keys(TERMINAL_USER_MODES)) {
    for (const row of await storedRows(TERMINAL, "user", key)) {
      const value = decode(row.value);
      if (typeof value !== "string" || !row.scopeId) continue;
      await setDefault(
        { level: "user", userId: row.scopeId },
        TERMINAL,
        key,
        value,
      );
    }
  }
}

async function moveMetricsLevels(): Promise<void> {
  for (const row of await storedRows(METRICS, "admin", "enabledForNewHosts")) {
    if (decode(row.value) === false) {
      await setDefault({ level: "admin" }, METRICS, "metricsEnabled", false);
    }
  }
}

async function moveDesktopLevels(): Promise<void> {
  for (const key of DESKTOP_DISPLAY_KEYS) {
    for (const row of await storedRows(DESKTOP, "user", key)) {
      const value = decode(row.value);
      if (typeof value !== "string" || value === "inherit" || !row.scopeId) {
        continue;
      }
      await setDefault(
        { level: "user", userId: row.scopeId },
        DESKTOP,
        key,
        value,
      );
    }
  }
}

/**
 * Hosts saved before host defaults (by an older release, or 2.8 after a
 * downgrade), which still carry the old meaning. A host saved since has its
 * overrides set, and a namespace it lacks is classified as it stands.
 */
function unclassified(rows: HostRow[]): HostRow[] {
  return rows.filter(
    (row) =>
      !row.sharedSource && parseDefaultOverrides(row.defaultOverrides) === null,
  );
}

async function userValues(
  pluginId: string,
  key: string,
): Promise<Map<string, unknown>> {
  const result = new Map<string, unknown>();
  for (const row of await storedRows(pluginId, "user", key)) {
    if (row.scopeId) result.set(row.scopeId, decode(row.value));
  }
  return result;
}

function manifestDefault(manifest: PluginManifest, key: string): unknown {
  return manifest.contributes?.settings?.host?.fields.find(
    (field) => field.key === key,
  )?.default;
}

/**
 * Writes one host value, or removes the row when it is the manifest default
 * so the host reads that default the usual way.
 */
async function writeHostValue(
  manifest: PluginManifest,
  hostId: number,
  key: string,
  value: unknown,
): Promise<void> {
  const settings = createCurrentPluginSettingsRepository();
  if (defaultValuesEqual(value, manifestDefault(manifest, key))) {
    await settings.delete(manifest.id, "host", String(hostId), key);
  } else {
    await settings.set(
      manifest.id,
      "host",
      String(hostId),
      key,
      JSON.stringify(value),
    );
  }
}

async function bakeTerminalHosts(
  manifest: PluginManifest,
  rows: HostRow[],
): Promise<void> {
  const hosts = unclassified(rows);
  if (hosts.length === 0) return;
  const settings = createCurrentPluginSettingsRepository();
  const lookByUser = await userValues(TERMINAL, "terminalDefaults");
  const modesByUser = new Map(
    await Promise.all(
      Object.keys(TERMINAL_USER_MODES).map(
        async (key) => [key, await userValues(TERMINAL, key)] as const,
      ),
    ),
  );

  for (const host of hosts) {
    const stored = new Map(
      (await settings.getAll(TERMINAL, "host", String(host.id))).map((row) => [
        row.key,
        decode(row.value),
      ]),
    );
    if (stored.get("inheritAppearance") !== false) {
      const look = asObject(lookByUser.get(host.userId)) ?? {};
      for (const key of TERMINAL_APPEARANCE_KEYS) {
        const value = look[key] ?? manifestDefault(manifest, key);
        await writeHostValue(manifest, host.id, key, value);
      }
    }
    for (const [key, fallback] of Object.entries(TERMINAL_USER_MODES)) {
      const own = stored.get(key);
      if (own !== undefined && own !== "default") continue;
      const user = modesByUser.get(key)?.get(host.userId);
      await writeHostValue(
        manifest,
        host.id,
        key,
        typeof user === "string" && user !== "default" ? user : fallback,
      );
    }
  }
}

async function bakeDesktopHosts(
  manifest: PluginManifest,
  rows: HostRow[],
): Promise<void> {
  const hosts = unclassified(rows);
  if (hosts.length === 0) return;
  const byKey = new Map(
    await Promise.all(
      DESKTOP_DISPLAY_KEYS.map(
        async (key) => [key, await userValues(DESKTOP, key)] as const,
      ),
    ),
  );
  for (const host of hosts) {
    for (const key of DESKTOP_DISPLAY_KEYS) {
      const value = byKey.get(key)?.get(host.userId);
      if (typeof value !== "string" || value === "inherit") continue;
      await writeHostValue(manifest, host.id, key, value);
    }
  }
}

/** A credential host with no credential of its own used its folder's. */
async function bakeFolderCredentials(rows: HostRow[]): Promise<void> {
  const hosts = unclassified(rows).filter(
    (row) => row.authType === "credential" && !row.credentialId && row.folder,
  );
  if (hosts.length === 0) return;
  const repository = createCurrentHostDefaultsRepository();
  const { createCurrentHostResolutionRepository } =
    await import("../database/repositories/factory.js");
  const resolution = createCurrentHostResolutionRepository();
  const patches: Array<{ id: number; values: Partial<HostRow> }> = [];
  for (const host of hosts) {
    if (folderChainPaths(host.folder).length === 0) continue;
    const credentialId = await resolution.findFolderCredentialId(
      host.userId,
      host.folder!,
    );
    if (credentialId) patches.push({ id: host.id, values: { credentialId } });
  }
  await repository.updateHosts(patches);
}

export async function runHostDefaultsMigration(): Promise<void> {
  const manifests = new Map(
    hostSettingsPlugins().map((manifest) => [manifest.id, manifest]),
  );
  try {
    await once("core", async () => {
      await moveCoreLevels();
      await moveFolderCredentials();
    });
    if (manifests.has(TERMINAL)) await once(TERMINAL, moveTerminalLevels);
    if (manifests.has(METRICS)) await once(METRICS, moveMetricsLevels);
    if (manifests.has(DESKTOP)) await once(DESKTOP, moveDesktopLevels);

    const rows = await createCurrentHostDefaultsRepository().listHosts({
      all: true,
    });
    await bakeFolderCredentials(rows);
    const terminal = manifests.get(TERMINAL);
    if (terminal) await bakeTerminalHosts(terminal, rows);
    const desktop = manifests.get(DESKTOP);
    if (desktop) await bakeDesktopHosts(desktop, rows);
  } catch (error) {
    databaseLogger.warn("Host defaults migration failed", {
      operation: "host_defaults_migration",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
