/**
 * A linked desktop runs the features its server runs.
 *
 * For every plugin in "mirror" mode, the server decides: a plugin installed
 * there is installed here, on or off to match, with the capabilities an
 * admin granted it there. Plugins marked "local" are left to the desktop and
 * "server" ones never run on a linked desktop.
 */

import fs from "fs";
import path from "path";
import semver from "semver";
import type { PluginDesktopMode } from "@termix/plugin-sdk/manifest";
import { syncLogger } from "../../utils/logger.js";
import { sendCoreAlert } from "../../notify/core-notify.js";
import {
  getPluginRuntime,
  installPluginArtifact,
  setPluginEnabled,
  unloadPlugin,
} from "../../plugins/index.js";
import { getPluginsDir } from "../../plugins/paths.js";
import {
  createCurrentPluginPermissionGrantRepository,
  createCurrentPluginRepository,
} from "../../database/repositories/factory.js";
import { remoteFetch, remoteJson } from "./http.js";
import type { SyncLink } from "./link-store.js";

export interface RemotePlugin {
  id: string;
  name: string;
  version: string;
  source: "bundled" | "user";
  enabled: boolean;
  active: boolean;
  desktop: PluginDesktopMode;
  syncEntities: string[];
  granted: string[];
}

let lastRemote: RemotePlugin[] = [];
const alertedVersions = new Set<string>();

/** What the server ran at the last sync, for the sync panel. */
export function lastRemotePlugins(): RemotePlugin[] {
  return lastRemote;
}

async function isEnabledLocally(pluginId: string): Promise<boolean> {
  const record = await createCurrentPluginRepository().findById(pluginId);
  return record?.state === "enabled";
}

async function download(link: SyncLink, plugin: RemotePlugin): Promise<string> {
  const response = await remoteFetch(
    link,
    `/sync/v2/plugins/${encodeURIComponent(plugin.id)}/package`,
    { timeoutMs: 120_000 },
  );
  if (!response.ok) {
    throw new Error(`Could not download ${plugin.id} (${response.status})`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const dir = getPluginsDir();
  await fs.promises.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${plugin.id}.tmxplug`);
  await fs.promises.writeFile(file, buffer);
  const signature = response.headers.get("x-termix-signature");
  const sigFile = `${file}.sig`;
  if (signature) {
    await fs.promises.writeFile(
      sigFile,
      Buffer.from(signature, "base64").toString("utf8"),
    );
  } else {
    await fs.promises.rm(sigFile, { force: true });
  }
  return file;
}

async function matchGrants(plugin: RemotePlugin): Promise<void> {
  const repository = createCurrentPluginPermissionGrantRepository();
  const local = getPluginRuntime().loader.get(plugin.id);
  if (!local || local.source !== "user") return;
  const declared = new Set(local.manifest.capabilities);
  const wanted = new Set(plugin.granted.filter((cap) => declared.has(cap)));
  const existing = await repository.listByPlugin(plugin.id);
  for (const grant of existing) {
    if (!wanted.has(grant.capability)) {
      await repository.revoke(plugin.id, grant.capability);
    }
  }
  const have = new Set(existing.map((grant) => grant.capability));
  for (const capability of wanted) {
    if (have.has(capability)) continue;
    await repository.grant({
      pluginId: plugin.id,
      capability,
      grantedBy: null,
      source: "admin",
    });
  }
}

async function alertOlderDesktop(plugin: RemotePlugin): Promise<void> {
  const key = `${plugin.id}@${plugin.version}`;
  if (alertedVersions.has(key)) return;
  alertedVersions.add(key);
  await sendCoreAlert({
    title: "Update the desktop app",
    body: `The server runs a newer ${plugin.name} (${plugin.version}) than this app has. Update the app to get it.`,
    severity: "info",
    category: "termix.sync.desktop_outdated",
    dedupeKey: `sync:outdated:${key}`,
    audience: "admins",
  });
}

async function mirrorOne(link: SyncLink, plugin: RemotePlugin): Promise<void> {
  const { loader } = getPluginRuntime();
  let local = loader.get(plugin.id);
  const mode = local?.manifest.desktop ?? plugin.desktop ?? "mirror";

  if (mode === "server") {
    if (local && (await isEnabledLocally(plugin.id))) {
      await setPluginEnabled(plugin.id, false);
    }
    return;
  }
  if (mode !== "mirror") return;

  if (plugin.source === "bundled") {
    if (!local || semver.gt(plugin.version, local.manifest.version)) {
      await alertOlderDesktop(plugin);
    }
    if (!local) return;
  } else if (plugin.enabled || local) {
    const outdated =
      !local ||
      local.source !== "user" ||
      local.manifest.version !== plugin.version;
    if (outdated && (!local || local.source === "user")) {
      const wasEnabled = local ? await isEnabledLocally(plugin.id) : false;
      if (local) await unloadPlugin(plugin.id);
      const file = await download(link, plugin);
      local = await installPluginArtifact(file);
      if (wasEnabled && !plugin.enabled) {
        await setPluginEnabled(plugin.id, false);
      }
    }
    await matchGrants(plugin);
  }

  if (!local) return;
  if (plugin.enabled !== (await isEnabledLocally(plugin.id))) {
    await setPluginEnabled(plugin.id, plugin.enabled);
  } else if (plugin.enabled && local.state !== "active") {
    await setPluginEnabled(plugin.id, true);
  }
}

export async function mirrorPlugins(link: SyncLink): Promise<void> {
  const { plugins } = await remoteJson<{ plugins: RemotePlugin[] }>(
    link,
    "/sync/v2/plugins",
  );
  lastRemote = plugins;
  const remoteIds = new Set(plugins.map((plugin) => plugin.id));

  for (const plugin of plugins) {
    try {
      await mirrorOne(link, plugin);
    } catch (error) {
      syncLogger.warn("Could not match a feature to the server", {
        operation: "sync_plugin_mirror",
        pluginId: plugin.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // A plugin the server no longer has is switched off here. Its data stays.
  for (const local of getPluginRuntime().loader.list()) {
    if (remoteIds.has(local.id) || local.source !== "user") continue;
    if ((local.manifest.desktop ?? "mirror") !== "mirror") continue;
    if (await isEnabledLocally(local.id)) {
      await setPluginEnabled(local.id, false).catch(() => {});
    }
  }
}

/** Whether a plugin's on/off state belongs to the linked server. */
export function isServerManaged(pluginId: string): boolean {
  const local = getPluginRuntime().loader.get(pluginId);
  return (local?.manifest.desktop ?? "mirror") !== "local";
}
