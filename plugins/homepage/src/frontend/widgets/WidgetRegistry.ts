import {
  getExtension,
  useExtensions,
  type ExtensionContribution,
} from "@termix/plugin-sdk/frontend";
import { useMemo } from "react";
import type { WidgetTypeDefinition, WidgetTypeId } from "../types.js";

/**
 * Other plugins add widgets with app.registerExtension(WIDGET_POINT, ...),
 * putting the widget under components.view and its edit form under
 * components.editForm. Core only stores the list, so a plugin's widgets
 * stay registered while this plugin is off.
 */
export const WIDGET_POINT = "homepage.widgets";

/**
 * Each widget module calls this at import time (before activate(app) runs),
 * so the definitions are queued here and registered from activate.
 */
const queued: WidgetTypeDefinition[] = [];

export function registerWidget<C>(def: WidgetTypeDefinition<C>): void {
  queued.push(def as unknown as WidgetTypeDefinition);
}

/** Called once from activate(app); drains the queue. */
export function drainQueuedWidgets(): WidgetTypeDefinition[] {
  return queued.splice(0, queued.length);
}

export function toExtension(def: WidgetTypeDefinition): ExtensionContribution {
  const { component, editFormComponent, ...rest } = def;
  return {
    ...rest,
    components: editFormComponent
      ? { view: component, editForm: editFormComponent }
      : { view: component },
  };
}

function toDefinition(
  extension: ExtensionContribution | undefined,
): WidgetTypeDefinition | undefined {
  const view = extension?.components?.view;
  if (!extension || !view) return undefined;
  const { components, ...rest } = extension;
  return {
    ...(rest as unknown as WidgetTypeDefinition),
    component: view,
    editFormComponent: components?.editForm,
    labelComponent: components?.label,
  };
}

export function getWidgetType(
  id: WidgetTypeId,
): WidgetTypeDefinition | undefined {
  return toDefinition(getExtension(WIDGET_POINT, id));
}

export function useWidgetTypes(): WidgetTypeDefinition[] {
  const extensions = useExtensions(WIDGET_POINT);
  return useMemo(
    () =>
      extensions
        .map(toDefinition)
        .filter((def): def is WidgetTypeDefinition => !!def),
    [extensions],
  );
}
