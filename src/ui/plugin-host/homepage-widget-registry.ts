import type { ComponentType } from "react";
import { createRegistry } from "@/lib/registry";

/**
 * A homepage widget type any plugin contributes through
 * app.registerHomepageWidget. Core owns this registry so the homepage
 * plugin's canvas can read it without every widget-contributing plugin
 * depending on homepage being enabled.
 */
export interface RegisteredHomepageWidget {
  id: string;
  pluginId?: string;
  name: string;
  description: string;
  category: "links" | "info" | "system" | "monitoring";
  icon: React.ReactNode;
  defaultConfig: Record<string, unknown>;
  defaultSize: { w: number; h: number };
  minSize: { w: number; h: number };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: ComponentType<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editFormComponent?: ComponentType<any>;
}

const registry = createRegistry<RegisteredHomepageWidget>();

export const registerHomepageWidgetType = registry.register;
export const getHomepageWidgetType = registry.get;
export const useHomepageWidgetTypes = registry.useList;
export const resetHomepageWidgetTypes = registry.reset;
