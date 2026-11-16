import type { ComponentType } from "react";

/** What the shell needs to draw a framed component itself. */
export interface FrameMeta {
  pluginId: string;
  frameKey: string;
  adapt?: (props: Record<string, unknown>) => Record<string, unknown>;
}

const META = Symbol.for("termix.frameMeta");

export function setFrameMeta(
  component: ComponentType<Record<string, unknown>>,
  meta: FrameMeta,
): void {
  (component as unknown as Record<symbol, FrameMeta>)[META] = meta;
}

export function frameMetaOf(component: unknown): FrameMeta | undefined {
  if (!component) return undefined;
  return (component as Record<symbol, FrameMeta | undefined>)[META];
}
