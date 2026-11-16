import type { DataValue } from "./data-value";

/** One contribution's values for a row, as a slot draws them. */
export interface ShownValue {
  actionId: string;
  pluginId?: string;
  parts: DataValue[];
}

export interface DataSlotWatch {
  slotId: string;
  rowKey: string;
  context: Record<string, unknown>;
}

/**
 * Where a data slot gets its values inside a plugin frame: the frame can't
 * see other plugins, so it asks the shell, which runs their hooks and sends
 * the values back. Unset in the page.
 */
export interface FrameDataSource {
  watch(
    watch: DataSlotWatch,
    onValues: (values: ShownValue[]) => void,
  ): { stop: () => void; action: (actionId: string) => void };
}

let source: FrameDataSource | null = null;

export function setFrameDataSource(next: FrameDataSource | null): void {
  source = next;
}

export function getFrameDataSource(): FrameDataSource | null {
  return source;
}
