/**
 * The small view of a host the operations layer needs: enough to name it, test
 * an action's `when`, and notice it changed. No secret field is ever read here.
 */

import type { OperationWhen } from "@termix-ssh/plugin-sdk/operations";
import type { PluginManifest } from "../plugins/manifest.js";
import { getSetting } from "../plugins/settings.js";
import { createCurrentHostResolutionRepository } from "../database/repositories/factory.js";

export interface OperationHost {
  id: number;
  name: string;
  updatedAt: string | null;
  tags: string[];
  os: string | null;
  /** Only the setting keys some `when` asks about. */
  settings: Record<string, unknown>;
}

export function splitTags(tags: string | null | undefined): string[] {
  return (tags ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

async function settingsFor(
  manifest: PluginManifest,
  hostId: number,
): Promise<Record<string, unknown>> {
  const keys = new Set<string>();
  for (const action of manifest.contributes?.operations?.actions ?? []) {
    for (const key of Object.keys(action.when?.settings ?? {})) keys.add(key);
  }
  const settings: Record<string, unknown> = {};
  for (const key of keys) {
    settings[key] = await getSetting(manifest, "host", hostId, key);
  }
  return settings;
}

/** A host with the settings its plugin's `when` rules read. */
export async function loadOperationHost(
  hostId: number,
  manifest: PluginManifest,
): Promise<OperationHost | null> {
  const repository = createCurrentHostResolutionRepository();
  const ownerId = await repository.findHostOwnerId(hostId);
  if (!ownerId) return null;
  const host = (await repository.findHostById(hostId, ownerId)) as {
    name: string | null;
    ip: string;
    tags: string | null;
    updatedAt?: string | null;
  } | null;
  if (!host) return null;
  return {
    id: hostId,
    name: host.name || host.ip,
    updatedAt: host.updatedAt ?? null,
    tags: splitTags(host.tags),
    os: null,
    settings: await settingsFor(manifest, hostId),
  };
}

export type { OperationWhen };
