/* eslint-disable react-refresh/only-export-components */
/**
 * Data slots a plugin frame draws. The frame can't see other plugins, so it
 * asks for a slot row here; DataWatchHost runs every plugin's hook for that
 * row in the page and sends the values back to the frame. A frame may only
 * watch slots its own plugin declared.
 */

import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  runOwnAction,
  useDataSlotValues,
} from "@/components/data-view/DataSlot";
import type { ShownValue } from "@/components/data-view/data-source";
import { getActionSlot } from "@/shell/action-registry";
import { frameRowContext } from "./data-rows";

export interface DataWatch {
  key: string;
  /** The plugin whose frame asked. */
  pluginId: string;
  slotId: string;
  rowKey: string;
  context: Record<string, unknown>;
  send: (values: ShownValue[]) => void;
  last: ShownValue[];
}

const watches = new Map<string, DataWatch>();
const listeners = new Set<() => void>();
let snapshot: DataWatch[] = [];

/** Rows one frame may watch at once. */
export const MAX_WATCHES = 500;

function emit() {
  snapshot = [...watches.values()];
  for (const listener of [...listeners]) listener();
}

/**
 * Starts a watch for a frame. Returns false when the plugin didn't declare
 * the slot, the slot takes no data or the frame has too many.
 */
export function addDataWatch(
  owner: string,
  pluginId: string,
  id: unknown,
  raw: unknown,
  findHost: (hostId: unknown) => Record<string, unknown> | undefined,
  send: (values: ShownValue[]) => void,
): boolean {
  if (typeof id !== "string" || id.length > 40) return false;
  if (!raw || typeof raw !== "object") return false;
  const { slotId, rowKey, context } = raw as Record<string, unknown>;
  if (typeof slotId !== "string" || typeof rowKey !== "string") return false;
  if (rowKey.length > 100) return false;
  const slot = getActionSlot(slotId);
  if (!slot || slot.pluginId !== pluginId || !slot.accepts.includes("data")) {
    return false;
  }
  let count = 0;
  for (const watch of watches.values()) {
    if (watch.key.startsWith(`${owner}\u0000`)) count++;
  }
  if (count >= MAX_WATCHES) return false;
  const clean = frameRowContext(
    context && typeof context === "object"
      ? (context as Record<string, unknown>)
      : {},
  );
  // Hooks get the shell's host record, scoped per plugin like anywhere else.
  const host = clean.hostId !== undefined ? findHost(clean.hostId) : undefined;
  const key = `${owner}\u0000${id}`;
  watches.set(key, {
    key,
    pluginId,
    slotId,
    rowKey,
    context: host ? { ...clean, host } : clean,
    send,
    last: [],
  });
  emit();
  return true;
}

export function removeDataWatch(owner: string, id: unknown): void {
  if (watches.delete(`${owner}\u0000${String(id)}`)) emit();
}

/** Drops every watch of a closed frame. */
export function removeDataWatches(owner: string): void {
  let changed = false;
  for (const key of [...watches.keys()]) {
    if (key.startsWith(`${owner}\u0000`)) {
      watches.delete(key);
      changed = true;
    }
  }
  if (changed) emit();
}

/** Runs an action a watched value carries, only for the plugin that sent it. */
export function runWatchAction(
  owner: string,
  id: unknown,
  actionId: unknown,
): void {
  const watch = watches.get(`${owner}\u0000${String(id)}`);
  if (!watch || typeof actionId !== "string") return;
  const from = watch.last.find((item) =>
    item.parts.some((part) => "actionId" in part && part.actionId === actionId),
  );
  if (!from) return;
  const { host: _host, ...context } = watch.context;
  runOwnAction(from.pluginId, actionId, [context]);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function WatchRunner({ watch }: { watch: DataWatch }) {
  const { reporters, shown } = useDataSlotValues(
    watch.slotId,
    watch.rowKey,
    watch.context,
  );
  const sent = useRef<string | null>(null);
  const json = JSON.stringify(shown);
  useEffect(() => {
    if (sent.current === json) return;
    sent.current = json;
    watch.last = shown;
    watch.send(shown);
    // shown is read through json.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [json, watch]);
  return <>{reporters}</>;
}

/** Runs the hooks for every watched row. Mounted once, beside FrameStateSync. */
export function DataWatchHost() {
  const list = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
  return (
    <>
      {list.map((watch) => (
        <WatchRunner key={watch.key} watch={watch} />
      ))}
    </>
  );
}

/** Test seam. */
export function resetDataWatches(): void {
  watches.clear();
  emit();
}
