import type {
  WidgetTypeDefinition,
  WidgetTypeId,
} from "@/types/homepage-types";

const registry = new Map<WidgetTypeId, WidgetTypeDefinition>();

export function registerWidget<C>(def: WidgetTypeDefinition<C>): void {
  registry.set(def.id, def as unknown as WidgetTypeDefinition);
}

export function getWidgetType(
  id: WidgetTypeId,
): WidgetTypeDefinition | undefined {
  return registry.get(id);
}

export function getAllWidgetTypes(): WidgetTypeDefinition[] {
  return Array.from(registry.values());
}
