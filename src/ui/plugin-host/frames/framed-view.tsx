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

export interface FramedViewProps {
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
}: FramedViewProps & { how: FrameFit }) {
  const { fallback, rest } = splitFallback(props);
  return (
    <PluginFrameView
      pluginId={pluginId}
      frameKey={frameKey}
      fit={how}
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
