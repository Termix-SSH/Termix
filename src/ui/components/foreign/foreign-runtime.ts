/**
 * How shared UI pieces reach other plugins' parts. In the page they read the
 * registries. Inside a plugin frame the frame sets a runtime here, and other
 * plugins' parts come back as placeholders the shell draws over.
 */

import type { ComponentType } from "react";
import type { SlotContribution } from "@/shell/action-registry";
import type { RegisteredExtension } from "@/plugin-host/extension-registry";

export type ForeignPartFit = "fill" | "content" | "inline" | "overlay";

/** Which part a placeholder stands for. */
export interface ForeignTarget {
  listId: string;
  itemKey: string;
  fit: ForeignPartFit;
  /** A page the plugin's backend granted (ctx.desktop.grantView), not a part. */
  web?: string;
}

export interface PlaceholderProps {
  target: ForeignTarget;
  props: Record<string, unknown>;
  interactive?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export interface ForeignRuntime {
  /**
   * The page also runs the plugin's own parts (the mobile web view), so
   * lists merge them with the foreign ones.
   */
  withOwn?: boolean;
  useSlot: (
    slotId: string,
    context?: Record<string, unknown>,
  ) => SlotContribution[];
  /** Other plugins' items only. */
  useExtensions: (pointId: string) => RegisteredExtension[];
  getExtension: (
    pointId: string,
    id: string,
  ) => RegisteredExtension | undefined;
  useComponent: (
    id: string,
  ) => ComponentType<Record<string, unknown>> | undefined;
  invoke: (actionId: string, args: unknown[]) => Promise<unknown>;
  Placeholder: ComponentType<PlaceholderProps>;
  /** Keeps foreign views hidden under this element while it is mounted. */
  addOccluder: (element: Element) => () => void;
}

let runtime: ForeignRuntime | null = null;

export function setForeignRuntime(next: ForeignRuntime | null): void {
  runtime = next;
}

export function getForeignRuntime(): ForeignRuntime | null {
  return runtime;
}

const TARGET = Symbol.for("termix.foreignTarget");

export function markForeign(
  component: ComponentType<Record<string, unknown>>,
  target: ForeignTarget,
): void {
  (component as unknown as Record<symbol, ForeignTarget>)[TARGET] = target;
}

/** The part a component stands for, when it is another plugin's. */
export function foreignTargetOf(component: unknown): ForeignTarget | undefined {
  if (!component) return undefined;
  return (component as Record<symbol, ForeignTarget | undefined>)[TARGET];
}
