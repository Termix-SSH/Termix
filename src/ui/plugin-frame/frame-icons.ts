import { icons, Puzzle, type LucideIcon } from "lucide-react";
import { isWireIcon } from "./protocol";

/** A Lucide icon from its wire name. Unknown names get the plugin glyph. */
export function decodeIcon(value: unknown): LucideIcon | undefined {
  if (!isWireIcon(value)) return undefined;
  return (icons[value.$icon as keyof typeof icons] as LucideIcon) ?? Puzzle;
}
