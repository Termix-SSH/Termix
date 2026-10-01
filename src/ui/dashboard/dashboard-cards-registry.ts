import type { ComponentType } from "react";
import { createRegistry } from "@/lib/registry";
import type { TabShellCallbacks } from "@/shell/tab-registry";

export interface DashboardCardRenderProps {
  isVisible: boolean;
  /** The shell, e.g. to open the full-page version of the card. */
  shell: TabShellCallbacks;
}

/**
 * A dashboard card a plugin contributes. DashboardTab offers registered cards
 * next to the core ones, and a saved slot whose card is not registered keeps
 * its place and shows a placeholder, so turning a plugin off and on again
 * puts the card back where it was.
 */
export interface RegisteredDashboardCard {
  id: string;
  pluginId?: string;
  titleKey: string;
  defaultHeight?: number;
  /** Which column a preset places this card in by default. Defaults to "main". */
  defaultPanel?: "main" | "side";
  component: ComponentType<DashboardCardRenderProps>;
}

const registry = createRegistry<RegisteredDashboardCard>();

export const registerDashboardCard = registry.register;
export const unregisterDashboardCard = registry.unregister;
export const getRegisteredDashboardCard = registry.get;
export const registeredDashboardCardList = registry.list;
export const useRegisteredDashboardCards = registry.useList;
export const resetDashboardCards = registry.reset;
