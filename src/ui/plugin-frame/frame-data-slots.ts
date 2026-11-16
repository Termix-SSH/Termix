/**
 * The frame side of a data slot this plugin owns: asks the shell to watch a
 * row and takes the values it sends back (shell event "dataSlot").
 */

import type {
  FrameDataSource,
  ShownValue,
} from "@/components/data-view/data-source";
import { frameRowContext } from "@/plugin-host/frames/data-rows";

type Call = (method: string, ...args: unknown[]) => Promise<unknown>;

const handlers = new Map<string, (values: ShownValue[]) => void>();
let nextId = 1;

export function createFrameDataSource(call: Call): FrameDataSource {
  return {
    watch(watch, onValues) {
      const id = `w${nextId++}`;
      handlers.set(id, onValues);
      void call("dataSlot.watch", id, {
        slotId: watch.slotId,
        rowKey: watch.rowKey,
        context: frameRowContext(watch.context),
      }).catch(() => {});
      return {
        stop: () => {
          handlers.delete(id);
          void call("dataSlot.unwatch", id).catch(() => {});
        },
        action: (actionId) => {
          void call("dataSlot.action", id, actionId).catch(() => {});
        },
      };
    },
  };
}

/** A "dataSlot" event from the shell. */
export function receiveDataSlot(data: unknown): void {
  if (!data || typeof data !== "object") return;
  const { id, values } = data as { id?: unknown; values?: unknown };
  const handler = typeof id === "string" ? handlers.get(id) : undefined;
  if (handler && Array.isArray(values)) handler(values as ShownValue[]);
}
