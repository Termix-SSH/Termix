import { createRegistry, type Registry } from "@/lib/registry";

/**
 * Named lists any plugin can add to through app.registerExtension. The plugin
 * that reads a point decides its id and item shape; core only stores them, so
 * contributions survive the reader being off and core never learns what a
 * point is for.
 */
export interface RegisteredExtension {
  id: string;
  pluginId?: string;
  [key: string]: unknown;
}

const points = new Map<string, Registry<RegisteredExtension>>();

function point(id: string): Registry<RegisteredExtension> {
  let registry = points.get(id);
  if (!registry) {
    registry = createRegistry<RegisteredExtension>();
    points.set(id, registry);
  }
  return registry;
}

export function registerExtension(
  pointId: string,
  extension: RegisteredExtension,
): () => void {
  return point(pointId).register(extension);
}

export function getExtension(
  pointId: string,
  id: string,
): RegisteredExtension | undefined {
  return point(pointId).get(id);
}

export function listExtensions(pointId: string): RegisteredExtension[] {
  return point(pointId).list();
}

export function useExtensions(pointId: string): RegisteredExtension[] {
  return point(pointId).useList();
}

export function resetExtensions(): void {
  for (const registry of points.values()) registry.reset();
}
