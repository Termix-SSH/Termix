/**
 * Turns values into something postMessage can carry and back.
 *
 * Functions travel by reference (the other side gets an async stand-in),
 * Lucide icons by name, and plugin components by a key the shell renders in
 * a frame of its own. Anything else that can't be cloned is dropped.
 */

import {
  isWireComponent,
  isWireFn,
  isWireIcon,
  type WireComponent,
  type WireFn,
  type WireIcon,
} from "./protocol";

const MAX_DEPTH = 24;
/** Set on a wrapper component (like the icon error boundary) to the icon it draws. */
export const WRAPPED_ICON = "__wrappedIcon";
const ICON_NAME = /^[A-Z][A-Za-z0-9]{0,63}$/;

const REACT_ELEMENT = new Set([
  Symbol.for("react.element"),
  Symbol.for("react.transitional.element"),
]);
const FORWARD_REF = Symbol.for("react.forward_ref");
const MEMO = Symbol.for("react.memo");

function typeTag(value: unknown): symbol | undefined {
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    return undefined;
  }
  const tag = (value as { $$typeof?: unknown }).$$typeof;
  return typeof tag === "symbol" ? tag : undefined;
}

export function isReactElement(value: unknown): boolean {
  const tag = typeTag(value);
  return !!tag && REACT_ELEMENT.has(tag);
}

/** A React component made with forwardRef or memo, which is an object. */
export function isComponentObject(value: unknown): boolean {
  const tag = typeTag(value);
  return tag === FORWARD_REF || tag === MEMO;
}

/**
 * The Lucide name of an icon component, or null. lucide-react sets each
 * icon's displayName to its name, which survives minifying.
 */
export function lucideName(component: unknown): string | null {
  if (!component) return null;
  const wrapped = (component as { [WRAPPED_ICON]?: unknown })[WRAPPED_ICON];
  if (wrapped && wrapped !== component) return lucideName(wrapped);
  if (!isComponentObject(component) && typeof component !== "function") {
    return null;
  }
  const name = (component as { displayName?: unknown }).displayName;
  return typeof name === "string" && ICON_NAME.test(name) ? name : null;
}

/**
 * The shapes a Lucide icon draws. lucide-react keeps them out of reach, but
 * its render function hands them to the inner Icon as a prop. Sent along with
 * the name so a frame can draw the icon without loading every Lucide icon.
 */
function iconNode(component: unknown): unknown[] | undefined {
  const wrapped = (component as { [WRAPPED_ICON]?: unknown } | null)?.[
    WRAPPED_ICON
  ];
  if (wrapped && wrapped !== component) return iconNode(wrapped);
  if (typeTag(component) !== FORWARD_REF) return undefined;
  const render = (component as { render?: unknown }).render;
  if (typeof render !== "function") return undefined;
  try {
    const element = render({}, null) as {
      props?: { icon?: { node?: unknown } };
    } | null;
    const node = element?.props?.icon?.node;
    // A copy: lucide shares one array per icon, and encode drops an object it
    // already saw, so a second use of the same icon would lose its shapes.
    return Array.isArray(node)
      ? (JSON.parse(JSON.stringify(node)) as unknown[])
      : undefined;
  } catch {
    return undefined;
  }
}

/** An icon component or an icon element (<Play />) as a wire icon. */
export function iconToWire(value: unknown): WireIcon | undefined {
  if (!value) return undefined;
  if (isReactElement(value)) {
    const type = (value as { type?: unknown }).type;
    const name = lucideName(type);
    if (!name) return undefined;
    const node = iconNode(type);
    const size = (value as { props?: { size?: unknown } }).props?.size;
    return {
      $icon: name,
      element: true,
      ...(Number.isInteger(size) &&
      (size as number) > 0 &&
      (size as number) <= 256
        ? { size: size as number }
        : {}),
      ...(node ? { node } : {}),
    };
  }
  const name = lucideName(value);
  if (!name) return undefined;
  const node = iconNode(value);
  return node ? { $icon: name, node } : { $icon: name };
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function passesThrough(value: object): boolean {
  return (
    value instanceof Date ||
    value instanceof RegExp ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) ||
    (typeof Blob !== "undefined" && value instanceof Blob) ||
    value instanceof Map ||
    value instanceof Set
  );
}

export interface EncodeOptions {
  /** Makes a function callable from the other side. */
  exportFn: (fn: (...args: never[]) => unknown) => WireFn;
  /** Sends another object in place of this one, or undefined to keep it. */
  replace?: (value: object) => object | undefined;
}

/**
 * Encodes a value for postMessage. Functions become references, icon
 * elements become names, other React elements are dropped. Values already
 * encoded (wire icons and components) pass as they are.
 */
export function encode(value: unknown, options: EncodeOptions): unknown {
  const seen = new WeakSet<object>();
  const walk = (input: unknown, depth: number): unknown => {
    if (input === null || input === undefined) return input;
    const kind = typeof input;
    if (kind === "string" || kind === "number" || kind === "boolean") {
      return input;
    }
    if (kind === "bigint") return String(input);
    if (kind === "symbol") return undefined;
    if (kind === "function") {
      return options.exportFn(input as (...args: never[]) => unknown);
    }
    let object = input as object;
    const swapped = options.replace?.(object);
    if (swapped !== undefined) object = swapped;
    if (isReactElement(object)) return iconToWire(object);
    if (isComponentObject(object)) return iconToWire(object);
    // Only a loop back to an object still being walked is cut: the same
    // object in two places (a shared list, an icon's shapes) goes both times.
    if (depth > MAX_DEPTH || seen.has(object)) return undefined;
    if (passesThrough(object)) return object;
    if (typeof Node !== "undefined" && object instanceof Node) return undefined;
    if (typeof Window !== "undefined" && object instanceof Window) {
      return undefined;
    }
    if (!isPlainObject(object) && object instanceof Error) {
      return { name: object.name, message: object.message };
    }
    seen.add(object);
    try {
      if (Array.isArray(object)) {
        return object.map((item) => walk(item, depth + 1));
      }
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(object)) {
        const encoded = walk(item, depth + 1);
        if (encoded !== undefined) out[key] = encoded;
      }
      return out;
    } finally {
      seen.delete(object);
    }
  };
  return walk(value, 0);
}

export interface DecodeOptions {
  importFn: (ref: WireFn) => (...args: unknown[]) => Promise<unknown>;
  icon?: (ref: WireIcon) => unknown;
  component?: (ref: WireComponent) => unknown;
}

/** Decodes what encode made, with references turned into stand-ins. */
export function decode(value: unknown, options: DecodeOptions): unknown {
  const walk = (input: unknown, depth: number): unknown => {
    if (input === null || typeof input !== "object") return input;
    if (depth > MAX_DEPTH) return undefined;
    if (isWireFn(input)) return options.importFn(input);
    if (isWireIcon(input)) return options.icon ? options.icon(input) : input;
    if (isWireComponent(input)) {
      return options.component ? options.component(input) : undefined;
    }
    if (passesThrough(input as object)) return input;
    if (Array.isArray(input)) return input.map((item) => walk(item, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(input)) {
      if (key === "__proto__" || key === "constructor") continue;
      out[key] = walk(item, depth + 1);
    }
    return out;
  };
  return walk(value, 0);
}
