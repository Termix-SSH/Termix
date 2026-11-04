import type { ComponentType } from "react";
import { createRegistry } from "@/lib/registry";
import type { TabShellCallbacks } from "@/shell/tab-registry";

export interface DashboardCardRenderProps {
  isVisible: boolean;
  /** The shell, e.g. to open the full-page version of the card. */
  shell: TabShellCallbacks;
  /** This copy's settings, for cards with entries. Empty otherwise. */
  config?: Record<string, unknown>;
  setConfig?: (config: Record<string, unknown>) => void;
  /** True while the user is arranging the dashboard. */
  editMode?: boolean;
}

/** One thing the add list offers from a card that can be placed many times. */
export interface DashboardCardEntry {
  /** Stable within the card, used to mark entries already placed. */
  key: string;
  title: string;
  description?: string;
  /** Group heading in the add list. Defaults to the card title. */
  group?: string;
  kind?: "card" | "chart" | "signal" | "action" | "resource" | "session";
  config: Record<string, unknown>;
  defaultSize?: { w: number; h?: number | null };
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
  /** "framed" gets a titled header from the dashboard; "bare" draws its own. */
  frame?: "framed" | "bare";
  /** Size on the 12 column dashboard grid when added. */
  defaultSize?: { w: number; h?: number | null };
  /** Lists what this card can show; each entry becomes its own tile. */
  entries?: (language: string) => Promise<DashboardCardEntry[]>;
  component: ComponentType<DashboardCardRenderProps>;
}

const registry = createRegistry<RegisteredDashboardCard>();

export const registerDashboardCard = registry.register;
export const unregisterDashboardCard = registry.unregister;
export const getRegisteredDashboardCard = registry.get;
export const registeredDashboardCardList = registry.list;
export const useRegisteredDashboardCards = registry.useList;
export const resetDashboardCards = registry.reset;
