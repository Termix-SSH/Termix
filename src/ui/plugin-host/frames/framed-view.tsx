/**
 * The shell side of one framed component: picks its fit (fixed, or what the
 * slot's owner declares) and keeps a `fallback` element out of the frame.
 */

import { useSyncExternalStore } from "react";
import { subscribeToActionRegistry } from "@/shell/action-registry";
import { PluginFrameView, type FrameFit } from "./PluginFrameView";
import { resolveSlotFit, splitFallback } from "./slot-fit";

function useSlotFit(slotId: string): FrameFit {
  return useSyncExternalStore(
    subscribeToActionRegistry,
    () => resolveSlotFit(slotId),
    () => resolveSlotFit(slotId),
  );
}

const PLACED_FITS = new Set<FrameFit>(["inline", "content", "fill"]);

export interface FramedViewProps {
  /** The page behind shows through, like a rail panel on the sidebar. */
  transparent?: boolean;
  /** Fields take the sidebar's color. Defaults to `transparent`. */
  onSidebar?: boolean;
  pluginId: string;
  frameKey: string;
  adapt?: (props: Record<string, unknown>) => Record<string, unknown>;
  props: Record<string, unknown>;
}

export function FramedView({
  how,
  pluginId,
  frameKey,
  adapt,
  props,
  transparent,
  onSidebar,
}: FramedViewProps & { how: FrameFit }) {
  const { fallback, rest: withFit } = splitFallback(props);
  // The page placing the part may say how it sits, like a small button in a
  // label row ("inline"), since the part's registration can't know.
  const { frameFit, ...rest } = withFit;
  const fit = PLACED_FITS.has(frameFit as FrameFit)
    ? (frameFit as FrameFit)
    : how;
  return (
    <PluginFrameView
      pluginId={pluginId}
      frameKey={frameKey}
      fit={fit}
      transparent={transparent}
      onSidebar={onSidebar}
      fallback={fallback}
      props={adapt ? adapt(rest) : rest}
    />
  );
}

export function SlotFramedView({
  slotId,
  ...rest
}: FramedViewProps & { slotId: string }) {
  return <FramedView {...rest} how={useSlotFit(slotId)} />;
}
