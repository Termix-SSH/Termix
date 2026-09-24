import {
  homepageWidgetType,
  useHomepageWidgetTypes,
  type HomepageWidgetContribution,
} from "@termix/plugin-sdk/frontend";
import type { WidgetTypeDefinition, WidgetTypeId } from "../types.js";

/**
 * Each widget module calls this at import time (before activate(app) runs),
 * so the definitions are queued here and app.registerHomepageWidget is
 * called for each one from activate. Core owns the actual registry, the same
 * one other plugins (docker, tunnels, host-metrics, file-manager) register
 * their own widgets into.
 */
const queued: WidgetTypeDefinition[] = [];

export function registerWidget<C>(def: WidgetTypeDefinition<C>): void {
  queued.push(def as unknown as WidgetTypeDefinition);
}

/** Called once from activate(app); drains the queue. */
export function drainQueuedWidgets(): WidgetTypeDefinition[] {
  return queued.splice(0, queued.length);
}

function toDefinition(
  widget: HomepageWidgetContribution | undefined,
): WidgetTypeDefinition | undefined {
  return widget as unknown as WidgetTypeDefinition | undefined;
}

export function getWidgetType(
  id: WidgetTypeId,
): WidgetTypeDefinition | undefined {
  return toDefinition(homepageWidgetType(id));
}

export function useWidgetTypes(): WidgetTypeDefinition[] {
  return useHomepageWidgetTypes() as unknown as WidgetTypeDefinition[];
}
