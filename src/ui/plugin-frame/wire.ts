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
  if (!isComponentObject(component) && typeof component !== "function") {
    return null;
  }
  const name = (component as { displayName?: unknown }).displayName;
  return typeof name === "string" && ICON_NAME.test(name) ? name : null;
}

/** An icon component or an icon element (<Play />) as a wire icon. */
export function iconToWire(value: unknown): WireIcon | undefined {
  if (!value) return undefined;
  if (isReactElement(value)) {
    const name = lucideName((value as { type?: unknown }).type);
    if (!name) return undefined;
    const size = (value as { props?: { size?: unknown } }).props?.size;
    return Number.isInteger(size) &&
      (size as number) > 0 &&
      (size as number) <= 256
      ? { $icon: name, element: true, size: size as number }
      : { $icon: name, element: true };
  }
  const name = lucideName(value);
  return name ? { $icon: name } : undefined;
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
    const object = input as object;
    if (isReactElement(object)) return iconToWire(object);
    if (isComponentObject(object)) return iconToWire(object);
    if (depth > MAX_DEPTH || seen.has(object)) return undefined;
    if (passesThrough(object)) return object;
    seen.add(object);
    if (Array.isArray(object)) {
      return object.map((item) => walk(item, depth + 1));
    }
    if (typeof Node !== "undefined" && object instanceof Node) return undefined;
    if (typeof Window !== "undefined" && object instanceof Window) {
      return undefined;
    }
    if (!isPlainObject(object) && object instanceof Error) {
      return { name: object.name, message: object.message };
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(object)) {
      const encoded = walk(item, depth + 1);
      if (encoded !== undefined) out[key] = encoded;
    }
    return out;
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
