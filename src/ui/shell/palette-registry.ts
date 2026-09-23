import type { ComponentType } from "react";
import type { Host } from "@/types/ui-types";
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
