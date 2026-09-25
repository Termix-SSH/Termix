import type { ComponentType } from "react";
import { createRegistry } from "@/lib/registry";
import type { TabShellCallbacks } from "./tab-registry";

export interface PanelRenderProps {
  /** The command-target tab the user is working in, if any. */
  targetTab?: import("@/types/ui-types").Tab;
  active: boolean;
  shell: TabShellCallbacks;
  setEditing: (editing: boolean) => void;
  activeTabType?: string;
  placement: "left" | "right" | "tab";
}

/** Sidebar content for a rail view a plugin contributes. */
export interface PanelDef {
  id: string;
  pluginId?: string;
  component: ComponentType<PanelRenderProps>;
  /** Stays mounted once opened, so its state survives switching away. */
  keepMounted?: boolean;
}

const registry = createRegistry<PanelDef>();

export const registerPanel = registry.register;
export const getPanel = registry.get;
export const listPanels = registry.list;
export const usePanels = registry.useList;
export const resetPanels = registry.reset;
