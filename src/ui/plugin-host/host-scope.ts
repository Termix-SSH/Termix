import { shellHost } from "./shell-bridge";

type SettingsBag = Record<string, Record<string, unknown> | undefined>;
type HostLike = { id: string | number; pluginSettings?: SettingsBag };

/**
 * A plugin sees only its own host settings. Another plugin's settings reach
 * it through that plugin's actions or services, never by reading the host,
 * so a plugin can rename a setting without breaking its neighbours.
 *
 * Settings come from the shell's own copy of the host when it has one, so a
 * host one plugin hands another (through an action or a tab) is re-read for
 * the receiver instead of arriving with the sender's slice.
 */
export function isHostLike(value: unknown): value is HostLike {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (!("id" in value)) return false;
  return "pluginSettings" in value || ("ip" in value && "port" in value);
}

const cache = new WeakMap<
  object,
  Map<string, { source: SettingsBag | undefined; scoped: object }>
>();

export function scopeHost<T>(value: T, pluginId: string): T {
  if (!isHostLike(value)) return value;
  const full = (shellHost(value.id)?.pluginSettings ?? value.pluginSettings) as
    SettingsBag | undefined;
  let perPlugin = cache.get(value);
  const hit = perPlugin?.get(pluginId);
  // Same object in, same object out, so a plugin's effects keyed on the
  // host don't re-run on every render.
  if (hit && hit.source === full) return hit.scoped as T;
  const own = full?.[pluginId];
  const scoped = { ...value, pluginSettings: own ? { [pluginId]: own } : {} };
  if (!perPlugin) {
    perPlugin = new Map();
    cache.set(value, perPlugin);
  }
  perPlugin.set(pluginId, { source: full, scoped });
  return scoped as T;
}

/**
 * Scopes each argument that is a host, and the `host` / `sshHost` fields of
 * an argument that is a request object such as `{ host, appTheme }`.
 */
export function scopeHostArgs<A extends unknown[]>(
  args: A,
  pluginId: string,
): A {
  return args.map((arg) =>
    isHostLike(arg) ? scopeHost(arg, pluginId) : scopeHostFields(arg, pluginId),
  ) as A;
}

// The prop and field names hosts travel under between core and plugins.
const HOST_FIELDS = ["host", "sshHost", "hostConfig"] as const;

/** Scopes the host fields of a props, context or request object. */
export function scopeHostFields<T>(value: T, pluginId: string): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  let next: Record<string, unknown> | null = null;
  for (const field of HOST_FIELDS) {
    if (!(field in record)) continue;
    const scoped = scopeHost(record[field], pluginId);
    if (scoped === record[field]) continue;
    next ??= { ...record };
    next[field] = scoped;
  }
  return (next ?? value) as T;
}

/** Wraps a plugin callback so any host it is called with is scoped. */
export function scopeHostCallback<F extends (...args: never[]) => unknown>(
  fn: F | undefined,
  pluginId: string,
): F | undefined {
  if (!fn) return fn;
  return ((...args: never[]) =>
    fn(...(scopeHostArgs(args as unknown[], pluginId) as never[]))) as F;
}
