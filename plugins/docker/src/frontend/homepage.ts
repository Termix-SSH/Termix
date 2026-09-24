import type { HomepageWidgetContribution } from "@termix/plugin-sdk/frontend";

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

export type WidgetDefinition<C> = Omit<
  HomepageWidgetContribution<C>,
  "defaultConfig"
> & { defaultConfig: C };
