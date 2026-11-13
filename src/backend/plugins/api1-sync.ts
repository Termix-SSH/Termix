/**
 * Plugin API 2 types some ctx reads as Promises, because a plugin in its own
 * process can only reach core asynchronously. Core still answers them
 * synchronously: an API 2 plugin awaits the plain value, and an API 1 plugin
 * running in process reads it the way it always has.
 */
export function answeredSync<F>(fn: unknown): F {
  return fn as F;
}
