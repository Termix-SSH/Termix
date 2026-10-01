import type { PluginKeyValue } from "@termix/plugin-sdk/backend";

const USAGE_KEY = "usage";
const FEATURE_NAME = /^[a-z][a-z0-9_.-]{0,63}$/;
export const MAX_FEATURES = 100;
const MAX_COUNT = 100_000;

export type UsageCounts = Record<string, number>;

/** Keeps valid names with positive whole counts, capped. */
export function sanitizeUsage(input: unknown): UsageCounts {
  const clean: UsageCounts = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return clean;
  }
  for (const [name, raw] of Object.entries(input)) {
    if (!FEATURE_NAME.test(name)) continue;
    const count = Math.floor(Number(raw));
    if (!Number.isFinite(count) || count <= 0) continue;
    clean[name] = Math.min(count, MAX_COUNT);
    if (Object.keys(clean).length >= MAX_FEATURES) break;
  }
  return clean;
}

export function createUsageStore(kv: PluginKeyValue) {
  // One write at a time, so two requests never drop each other's counts.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => undefined);
    return next;
  };

  const read = async (): Promise<UsageCounts> =>
    sanitizeUsage(await kv.get(USAGE_KEY));

  return {
    read,

    add: (counts: UsageCounts) =>
      serial(async () => {
        const current = await read();
        for (const [name, count] of Object.entries(sanitizeUsage(counts))) {
          if (
            !(name in current) &&
            Object.keys(current).length >= MAX_FEATURES
          ) {
            continue;
          }
          current[name] = Math.min((current[name] ?? 0) + count, MAX_COUNT);
        }
        await kv.set(USAGE_KEY, current);
      }),

    /** Drops what a successful report already carried. */
    subtract: (sent: UsageCounts) =>
      serial(async () => {
        const current = await read();
        for (const [name, count] of Object.entries(sent)) {
          const left = (current[name] ?? 0) - count;
          if (left > 0) current[name] = left;
          else delete current[name];
        }
        await kv.set(USAGE_KEY, current);
      }),
  };
}

export type UsageStore = ReturnType<typeof createUsageStore>;

/** PostHog property name for a feature: used_tab_terminal. */
export function usageProperty(name: string): string {
  return `used_${name.replace(/[.-]/g, "_")}`;
}
