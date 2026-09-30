import type { ComponentType } from "react";
import type { Host, Tab } from "@/types/ui-types";
import { byOrderThenId, createRegistry } from "@/lib/registry";
import type { TabShellCallbacks } from "./tab-registry";

/** A command palette entry a plugin contributes. */
export interface PaletteEntryDef {
  id: string;
  pluginId?: string;
  titleKey: string;
  icon?: ComponentType<{ className?: string }>;
  keywords?: string[];
  scope: "global" | "host";
  when?: (host?: Host) => boolean;
  run: (shell: TabShellCallbacks, host?: Host) => void;
  order?: number;
}

const registry = createRegistry<PaletteEntryDef>(byOrderThenId);

export const registerPaletteEntry = registry.register;
export const usePaletteEntries = registry.useList;
export const listPaletteEntries = registry.list;
export const resetPaletteEntries = registry.reset;

export function paletteEntriesFor(
  all: PaletteEntryDef[],
  scope: PaletteEntryDef["scope"],
  host?: Host,
): PaletteEntryDef[] {
  return all.filter((entry) => {
    if (entry.scope !== scope) return false;
    if (!entry.when) return true;
    try {
      return entry.when(host);
    } catch {
      return false;
    }
  });
}

/** One row of a palette group. */
export interface PaletteItemDef {
  id: string;
  title: string;
  description?: string;
  icon?: ComponentType<{ className?: string }>;
  keywords?: string[];
  needsTarget?: boolean;
  hint?: string;
  run: (context: { targetTab?: Tab; shell: TabShellCallbacks }) => void;
}

/** A searchable group of items a plugin fills, e.g. its saved commands. */
export interface PaletteGroupDef {
  id: string;
  pluginId?: string;
  titleKey: string;
  order?: number;
  load: () => PaletteItemDef[] | Promise<PaletteItemDef[]>;
  showWhenEmpty?: boolean;
}

const groups = createRegistry<PaletteGroupDef>(byOrderThenId);

export const registerPaletteGroup = groups.register;
export const usePaletteGroups = groups.useList;
export const listPaletteGroups = groups.list;
export const resetPaletteGroups = groups.reset;

/** A group's items, or none when its loader throws. */
export async function loadPaletteGroup(
  group: PaletteGroupDef,
): Promise<PaletteItemDef[]> {
  try {
    const items = await group.load();
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

/** The items the query matches, by title, description or keyword. */
export function filterPaletteItems(
  items: PaletteItemDef[],
  query: string,
  showWhenEmpty = false,
): PaletteItemDef[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return showWhenEmpty ? items : [];
  return items.filter((item) =>
    [item.title, item.description ?? "", ...(item.keywords ?? [])].some(
      (text) => text.toLowerCase().includes(needle),
    ),
  );
}
