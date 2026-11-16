import { useMemo, useRef } from "react";

/**
 * Functions in props get a new identity every render. Each is passed across
 * as one stable stand-in that calls whatever the latest props hold.
 */
export function useStableProps(
  props: Record<string, unknown>,
): Record<string, unknown> {
  const latest = useRef(props);
  latest.current = props;
  const cache = useRef(new Map<string, (...args: unknown[]) => unknown>());

  return useMemo(() => {
    const walk = (value: unknown, path: string, depth: number): unknown => {
      if (typeof value === "function") {
        let stable = cache.current.get(path);
        if (!stable) {
          stable = (...args: unknown[]) => {
            let target: unknown = latest.current;
            for (const part of path.split(".")) {
              target = (target as Record<string, unknown> | undefined)?.[part];
            }
            return typeof target === "function"
              ? (target as (...a: unknown[]) => unknown)(...args)
              : undefined;
          };
          cache.current.set(path, stable);
        }
        return stable;
      }
      if (
        depth < 2 &&
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.getPrototypeOf(value) === Object.prototype
      ) {
        const out: Record<string, unknown> = {};
        for (const [name, item] of Object.entries(value)) {
          out[name] = walk(item, `${path}.${name}`, depth + 1);
        }
        return out;
      }
      return value;
    };
    const out: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(props)) {
      out[name] = walk(value, name, 0);
    }
    return out;
  }, [props]);
}

/** A props signature for "did anything change", functions as one marker. */
export function propsSignature(props: unknown): string | null {
  try {
    return JSON.stringify(props, (_key, value) =>
      typeof value === "function" ? "[fn]" : value,
    );
  } catch {
    return null;
  }
}
