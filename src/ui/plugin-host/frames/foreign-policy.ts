/**
 * Which other plugins' views a framed plugin may have the shell draw over
 * it. A plugin may place the parts of a slot it declared, an extension point
 * or component under its own id, and anything its manifest lists in
 * `contributes.uses`.
 */

import { getActionSlot } from "@/shell/action-registry";
import { getPluginStoreState } from "../plugin-store";

export type ForeignKind = "slot" | "extension" | "component";

export function isForeignKind(value: unknown): value is ForeignKind {
  return value === "slot" || value === "extension" || value === "component";
}

/** The ids a plugin's manifest says it uses. */
export function manifestUses(pluginId: string): string[] {
  const summary = getPluginStoreState().records.get(pluginId)?.summary;
  const uses = (summary?.contributes as { uses?: unknown } | null)?.uses;
  return Array.isArray(uses) ? uses.filter((u) => typeof u === "string") : [];
}

export function mayPlaceForeign(
  consumerId: string,
  kind: unknown,
  id: unknown,
): boolean {
  if (!isForeignKind(kind) || typeof id !== "string") return false;
  if (id.length === 0 || id.length > 200) return false;
  if (manifestUses(consumerId).includes(id)) return true;
  if (kind === "slot") return getActionSlot(id)?.pluginId === consumerId;
  return id.startsWith(`${consumerId}.`);
}
