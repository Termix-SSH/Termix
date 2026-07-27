import type { HostBackspaceMode } from "@/sidebar/HostEditorData";

const CURSOR_SEQUENCES: Record<string, [normal: string, application: string]> =
  {
    ArrowUp: ["\x1b[A", "\x1bOA"],
    ArrowDown: ["\x1b[B", "\x1bOB"],
    ArrowRight: ["\x1b[C", "\x1bOC"],
    ArrowLeft: ["\x1b[D", "\x1bOD"],
  };

export function getAndroidHardwareKeySequence(
  event: Pick<
    KeyboardEvent,
    "key" | "ctrlKey" | "altKey" | "metaKey" | "shiftKey"
  >,
  applicationCursorKeys: boolean,
  backspaceMode: HostBackspaceMode | undefined,
): string | null {
  if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
    return null;
  }

  const cursor = CURSOR_SEQUENCES[event.key];
  if (cursor) return cursor[applicationCursorKeys ? 1 : 0];
  if (event.key === "Delete") return "\x1b[3~";
  if (event.key === "Backspace" && backspaceMode !== "control-h") {
    return "\x7f";
  }
  return null;
}
