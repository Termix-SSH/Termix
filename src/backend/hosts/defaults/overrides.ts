/**
 * Changes which keys a host sets itself, without going through a full host
 * write: a patch that sets a value makes it the host's own, and a reset hands
 * it back to the defaults.
 */

import { createCurrentHostDefaultsRepository } from "../../database/repositories/factory.js";
import {
  parseDefaultOverrides,
  type DefaultOverrides,
} from "../../../types/host-defaults.js";
import { catalogNamespaces } from "./catalog.js";
import { currentCatalog } from "./materialize.js";
import { recompute } from "./recompute.js";

export interface OverrideChange {
  /** Keys that become the host's own, as [namespace, key]. */
  own?: Array<[string, string]>;
  /** Keys that follow the defaults again. */
  inherit?: Array<[string, string]>;
  /** Namespaces whose every key follows the defaults again. */
  inheritNamespaces?: string[];
  /** Every key follows the defaults again. */
  inheritAll?: boolean;
}

export function applyOverrideChange(
  current: DefaultOverrides | null,
  change: OverrideChange,
  allNamespaces: string[] = [],
): DefaultOverrides {
  const next: DefaultOverrides = {};
  for (const [namespace, keys] of Object.entries(current ?? {})) {
    next[namespace] = [...keys];
  }
  if (change.inheritAll) {
    for (const namespace of [...Object.keys(next), ...allNamespaces]) {
      next[namespace] = [];
    }
  }
  for (const namespace of change.inheritNamespaces ?? []) {
    next[namespace] = [];
  }
  for (const [namespace, key] of change.inherit ?? []) {
    if (next[namespace]) {
      next[namespace] = next[namespace].filter((own) => own !== key);
    }
  }
  for (const [namespace, key] of change.own ?? []) {
    // A namespace nobody classified yet stays that way: its first pass
    // compares every value, this one included, and would keep it.
    if (!next[namespace]) continue;
    const keys = new Set(next[namespace] ?? []);
    keys.add(key);
    next[namespace] = [...keys].sort();
  }
  return next;
}

/**
 * Applies a change to a set of hosts. A change that hands keys back to the
 * defaults is followed by a pass that writes what they now resolve to.
 */
export async function changeHostOverrides(
  hostIds: number[],
  change: OverrideChange,
): Promise<void> {
  if (hostIds.length === 0) return;
  const repository = createCurrentHostDefaultsRepository();
  const rows = await repository.listHosts({ hostIds });
  const namespaces = catalogNamespaces(currentCatalog().catalog);
  const patches: Array<{ id: number; values: { defaultOverrides: string } }> =
    [];
  for (const row of rows) {
    const current = parseDefaultOverrides(row.defaultOverrides);
    const next = applyOverrideChange(current, change, namespaces);
    const encoded = JSON.stringify(next);
    if (encoded !== row.defaultOverrides) {
      patches.push({ id: row.id, values: { defaultOverrides: encoded } });
    }
  }
  await repository.updateHosts(patches);
  const resets =
    change.inheritAll ||
    (change.inheritNamespaces?.length ?? 0) > 0 ||
    (change.inherit?.length ?? 0) > 0;
  if (resets) await recompute({ hostIds });
}
