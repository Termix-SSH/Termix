import { createElement, type ReactElement } from "react";
import { icons, Puzzle, type LucideIcon } from "lucide-react";
import { isWireIcon } from "./protocol";

/** A Lucide icon from its wire name. Unknown names get the plugin glyph. */
export function decodeIcon(value: unknown): LucideIcon | undefined {
  if (!isWireIcon(value)) return undefined;
  return (icons[value.$icon as keyof typeof icons] as LucideIcon) ?? Puzzle;
}

/**
 * Like decodeIcon, but an icon the plugin gave as an element comes back as
 * one, for fields that render it as is (a homepage widget's icon).
 */
export function decodeIconValue(
  value: unknown,
): LucideIcon | ReactElement | undefined {
  const icon = decodeIcon(value);
  if (!icon || !isWireIcon(value) || !value.element) return icon;
  return createElement(icon, value.size ? { size: value.size } : {});
}
