import type {
  WidgetTypeDefinition,
  WidgetTypeId,
} from "@/types/homepage-types";
import { createRegistry } from "@/lib/registry";

/** Core widgets register on import; plugin widgets while their plugin runs. */
const registry = createRegistry<WidgetTypeDefinition>();

export function registerWidget<C>(def: WidgetTypeDefinition<C>): () => void {
  return registry.register(def as unknown as WidgetTypeDefinition);
}

export function getWidgetType(
  id: WidgetTypeId,
): WidgetTypeDefinition | undefined {
  return registry.get(id);
}

export function getAllWidgetTypes(): WidgetTypeDefinition[] {
  return registry.list();
}

export const useWidgetTypes = registry.useList;
