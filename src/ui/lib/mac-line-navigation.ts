import { isMacPlatform } from "@/lib/tab-jump-hotkey";

export function getMacLineNavigationSequence(e: KeyboardEvent): string | null {
  if (e.type !== "keydown" || !isMacPlatform()) return null;
  if (!e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return null;

  switch (e.code) {
    case "ArrowLeft":
      return "\x01";
    case "ArrowRight":
      return "\x05";
    default:
      return null;
  }
}
