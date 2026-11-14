import { isValidElement, type ReactNode } from "react";
import { getActionSlot } from "@/shell/action-registry";
import type { FrameFit } from "./PluginFrameView";

/**
 * A guess for slots whose owner did not declare a fit: toolbars, row items
 * and badges size to themselves, a tabs slot takes a whole page, anything
 * else a full width block.
 */
export function slotFit(slotId: string): FrameFit {
  if (/toolbar|actions$|badges?$|row$|\.inline$/i.test(slotId)) {
    return "inline";
  }
  if (/tabs?$/i.test(slotId)) return "fill";
  return "content";
}

/** The fit the slot's owner declared, else the guess from its id. */
export function resolveSlotFit(slotId: string): FrameFit {
  return getActionSlot(slotId)?.fit ?? slotFit(slotId);
}

/**
 * An element can't cross into a frame. A `fallback` element stays in the
 * shell and shows while the framed view draws nothing.
 */
export function splitFallback(props: Record<string, unknown>): {
  fallback: ReactNode;
  rest: Record<string, unknown>;
} {
  if (!isValidElement(props.fallback)) {
    return { fallback: undefined, rest: props };
  }
  const { fallback, ...rest } = props;
  return { fallback: fallback as ReactNode, rest };
}
