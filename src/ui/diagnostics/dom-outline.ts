/**
 * A compact outline of the page for layout problems: tags, ids, data hooks,
 * a few classes and boxes. Text only when asked, input values never.
 */

export interface OutlineOptions {
  text?: boolean;
  maxDepth?: number;
  maxNodes?: number;
}

const SKIP = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "LINK",
  "META",
]);
const SVG_INNER = new Set([
  "path",
  "g",
  "circle",
  "rect",
  "line",
  "polyline",
  "polygon",
  "defs",
  "use",
]);

function label(el: Element): string {
  const tag = el.tagName.toLowerCase();
  let out = tag;
  if (el.id) out += `#${el.id.slice(0, 40)}`;
  const classes = (el.getAttribute("class") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);
  if (classes.length) out += `.${classes.join(".")}`;
  const hooks: string[] = [];
  for (const attr of Array.from(el.attributes)) {
    if (
      (attr.name.startsWith("data-") && attr.name !== "data-value") ||
      attr.name === "role" ||
      attr.name === "aria-hidden"
    ) {
      hooks.push(`${attr.name}=${attr.value.slice(0, 40)}`);
    }
  }
  if (tag === "iframe") {
    const src = el.getAttribute("src") ?? "";
    const match = /\/plugin-assets\/([^/]+)\//.exec(src);
    hooks.push(`plugin=${match?.[1] ?? "other"}`);
  }
  if (hooks.length) out += ` [${hooks.slice(0, 6).join(" ")}]`;
  return out;
}

function box(el: Element): string {
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  const hidden =
    style.display === "none" ||
    style.visibility === "hidden" ||
    Number(style.opacity) === 0 ||
    rect.width === 0 ||
    rect.height === 0;
  const parts = [
    `${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
  ];
  if (hidden) parts.push("hidden");
  if (style.position === "fixed" || style.position === "absolute") {
    parts.push(style.position);
  }
  if (style.zIndex !== "auto") parts.push(`z${style.zIndex}`);
  if (style.pointerEvents === "none") parts.push("no-pointer");
  if (
    (style.overflowY === "auto" || style.overflowY === "scroll") &&
    el.scrollHeight > el.clientHeight
  ) {
    parts.push("scrolls");
  }
  return parts.join(" ");
}

function ownText(el: Element): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return "";
  }
  let text = "";
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? "";
  }
  text = text.replace(/\s+/g, " ").trim();
  return text ? ` "${text.slice(0, 60)}"` : "";
}

export function domOutline(
  root: Element = document.body,
  options: OutlineOptions = {},
): string {
  const maxDepth = options.maxDepth ?? 18;
  const maxNodes = options.maxNodes ?? 2500;
  const lines: string[] = [];
  let count = 0;
  let cut = false;
  const walk = (el: Element, depth: number) => {
    if (count >= maxNodes) {
      cut = true;
      return;
    }
    if (SKIP.has(el.tagName) || SVG_INNER.has(el.tagName.toLowerCase())) return;
    // The report page itself is not part of the problem.
    if (el.hasAttribute("data-diagnostics-view")) return;
    count++;
    const children = Array.from(el.children);
    const tail =
      depth >= maxDepth && children.length ? ` (+${children.length} more)` : "";
    lines.push(
      `${"  ".repeat(depth)}${label(el)} {${box(el)}}${options.text ? ownText(el) : ""}${tail}`,
    );
    if (depth >= maxDepth) return;
    for (const child of children) walk(child, depth + 1);
  };
  walk(root, 0);
  if (cut) lines.push(`... cut at ${maxNodes} elements`);
  return lines.join("\n");
}
