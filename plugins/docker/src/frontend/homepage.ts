import type { ComponentType, ReactNode } from "react";
import type { ExtensionContribution } from "@termix/plugin-sdk/frontend";

/** The homepage's grid step, in pixels. */
export const GRID_SIZE = 30;

export interface DockerWidgetConfig {
  hostId: number;
}

/** What the homepage hands a widget; only the fields this plugin reads. */
export interface WidgetComponentProps<C> {
  widget: { title?: string | null };
  config: C;
}

export interface WidgetEditFormProps<C> {
  config: C;
  onChange: (config: C) => void;
}

/** What app.registerExtension("homepage.widgets", ...) takes. */
export interface WidgetDefinition<C> extends ExtensionContribution {
  id: string;
  name: string;
  description: string;
  category: "links" | "info" | "system" | "monitoring";
  icon: ReactNode;
  defaultConfig: C;
  defaultSize: { w: number; h: number };
  minSize: { w: number; h: number };
  components: {
    view: ComponentType<WidgetComponentProps<C>>;
    editForm?: ComponentType<WidgetEditFormProps<C>>;
  };
}
