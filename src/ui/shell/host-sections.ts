import type { ComponentType } from "react";
import type { Host } from "@/types/ui-types";
import { byOrderThenId, createRegistry } from "@/lib/registry";
import type { TabShellCallbacks } from "@/shell/tab-registry";

export interface HostSectionRenderProps {
  host: Host;
  isVisible: boolean;
  shell: TabShellCallbacks;
}

/**
 * A card a plugin adds to a host page. The page itself belongs to a plugin;
 * core only keeps the list so any plugin can fill it.
 */
export interface HostSectionDef {
  id: string;
  pluginId?: string;
  titleKey: string;
  order?: number;
  when: (host: Host) => boolean;
  component: ComponentType<HostSectionRenderProps>;
}

const sections = createRegistry<HostSectionDef>(byOrderThenId);

export const registerHostSection = sections.register;
export const useHostSections = sections.useList;
export const listHostSections = sections.list;
export const resetHostSections = sections.reset;

export function hostSectionsFor(
  all: HostSectionDef[],
  host: Host,
): HostSectionDef[] {
  return all.filter((section) => {
    try {
      return section.when(host);
    } catch {
      return false;
    }
  });
}
