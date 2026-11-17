import { createElement, type ReactElement } from "react";
import { createLucideIcon, Puzzle, type LucideIcon } from "lucide-react";
import { isWireIcon } from "./protocol";

type IconNode = [string, Record<string, string | number>][];

const SHAPES = new Set([
  "path",
  "circle",
  "rect",
  "line",
  "polyline",
  "polygon",
  "ellipse",
]);
const ATTRIBUTES = new Set([
  "d",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "x",
  "y",
  "x1",
  "x2",
  "y1",
  "y2",
  "width",
  "height",
  "points",
  "fill",
  "key",
]);

/** Only plain shapes with geometry attributes, nothing that runs or links. */
function readNode(value: unknown): IconNode | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    return null;
  }
  const out: IconNode = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    const [tag, attrs] = entry as [unknown, unknown];
    if (typeof tag !== "string" || !SHAPES.has(tag)) return null;
    if (!attrs || typeof attrs !== "object" || Array.isArray(attrs))
      return null;
    const clean: Record<string, string | number> = {};
    for (const [name, attr] of Object.entries(attrs)) {
      if (!ATTRIBUTES.has(name)) continue;
      if (typeof attr === "number") clean[name] = attr;
      else if (typeof attr === "string" && attr.length <= 4096) {
        clean[name] = attr;
      }
    }
    out.push([tag, clean]);
  }
  return out;
}

const drawn = new Map<string, LucideIcon>();

/**
 * A Lucide icon from its wire form. `lookup` finds it by name where a full
 * copy of Lucide is around (the shell); a frame draws it from the shapes the
 * shell sent. Anything else gets the plugin glyph.
 */
export function decodeIcon(
  value: unknown,
  lookup?: (name: string) => LucideIcon | undefined,
): LucideIcon | undefined {
  if (!isWireIcon(value)) return undefined;
  const known = lookup?.(value.$icon);
  if (known) return known;
  const ready = drawn.get(value.$icon);
  if (ready) return ready;
  const node = readNode(value.node);
  if (!node) return Puzzle;
  const icon = createLucideIcon(value.$icon, node);
  drawn.set(value.$icon, icon);
  return icon;
}

/**
 * Like decodeIcon, but an icon the plugin gave as an element comes back as
 * one, for fields that render it as is (a homepage widget's icon).
 */
export function decodeIconValue(
  value: unknown,
  lookup?: (name: string) => LucideIcon | undefined,
): LucideIcon | ReactElement | undefined {
  const icon = decodeIcon(value, lookup);
  if (!icon || !isWireIcon(value) || !value.element) return icon;
  return createElement(icon, value.size ? { size: value.size } : {});
}

/** "ArrowUpDown" to "arrow-up-down", "BarChart3" to "bar-chart-3". */
export function iconFileName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([a-zA-Z])(\d)/g, "$1-$2")
    .toLowerCase();
}
