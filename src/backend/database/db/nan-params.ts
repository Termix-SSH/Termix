/**
 * SQLite binds NaN as NULL, Postgres and MySQL throw on it. A route that turns
 * a bad id from a URL into Number("abc") then answered 500 (with the failed
 * SQL in the message) only on those two. Binding NaN as NULL everywhere makes
 * such a lookup find nothing, the same on all three databases.
 */

type QueryFn = (...args: unknown[]) => unknown;

function fix(value: unknown): unknown {
  return typeof value === "number" && Number.isNaN(value) ? null : value;
}

export function nanToNull(values: unknown): unknown {
  return Array.isArray(values) ? values.map(fix) : values;
}

function guardMethod(target: Record<string, unknown>, name: string): void {
  const original = target[name];
  if (typeof original !== "function") return;
  if ((original as { __nanGuard?: boolean }).__nanGuard) return;
  const guarded = function (this: unknown, ...args: unknown[]) {
    const [first, second] = args;
    if (Array.isArray(second)) {
      args[1] = nanToNull(second);
    } else if (
      first &&
      typeof first === "object" &&
      // Only a plain config. A driver Query object keeps its own state.
      Object.getPrototypeOf(first) === Object.prototype &&
      Array.isArray((first as { values?: unknown }).values)
    ) {
      args[0] = {
        ...(first as object),
        values: nanToNull((first as { values: unknown[] }).values),
      };
    }
    return (original as QueryFn).apply(this, args);
  };
  (guarded as unknown as { __nanGuard: boolean }).__nanGuard = true;
  target[name] = guarded;
}

interface EventSource {
  on(event: string, listener: (client: Record<string, unknown>) => void): void;
}

/** node-postgres: the pool and every client it hands out for transactions. */
export function guardPgPool<T extends object>(pool: T): T {
  guardMethod(pool as Record<string, unknown>, "query");
  (pool as unknown as EventSource).on("connect", (client) =>
    guardMethod(client, "query"),
  );
  return pool;
}

/** mysql2: the pool and every connection it hands out. */
export function guardMysqlPool<T extends object>(pool: T): T {
  const target = pool as Record<string, unknown>;
  guardMethod(target, "query");
  guardMethod(target, "execute");
  (pool as unknown as EventSource).on("connection", (connection) => {
    guardMethod(connection, "query");
    guardMethod(connection, "execute");
  });
  return pool;
}
