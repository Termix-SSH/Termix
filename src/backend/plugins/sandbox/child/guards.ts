/**
 * Pieces of harden.ts that core and tests use too. harden.ts hardens the
 * process it is loaded in, so nothing outside a plugin process imports it.
 */

/**
 * Set by core when the running Node has no network permission (before 25)
 * and the plugin lacks network:sockets. harden.ts then refuses sockets.
 */
export const NO_NETWORK_ENV = "TERMIX_SANDBOX_NO_NETWORK";

/**
 * Whether a pid may be signalled or reprioritised: the process itself and
 * processes it started. Without the launcher a plugin runs as core's user,
 * so the OS alone would let it stop core or another plugin. 0 and negative
 * pids reach whole process groups, which include core.
 */
export function maySignal(
  pid: unknown,
  own: number,
  started: ReadonlySet<number>,
): boolean {
  const value = Number(pid);
  if (!Number.isInteger(value)) return false;
  if (value === own) return true;
  if (value > 0) return started.has(value);
  // A child started detached leads its own group.
  return value < 0 && started.has(-value);
}

type Resolve<R> = (specifier: string, context: { parentURL?: string }) => R;

/**
 * Resolves a bare package from the app root when the plugin's own folder
 * has no node_modules, as for a plugin unpacked into the desktop data dir.
 * ESM imports fail with ERR_MODULE_NOT_FOUND, require() with
 * MODULE_NOT_FOUND, and require() ignores parentURL, so it gets a path.
 */
export function resolveFromApp<R>(
  specifier: string,
  context: { parentURL?: string },
  error: unknown,
  next: Resolve<R>,
  anchor: string,
  requireResolve: (specifier: string) => string,
): R {
  const code = (error as { code?: string } | null)?.code;
  if (isBare(specifier)) {
    if (code === "ERR_MODULE_NOT_FOUND") {
      return next(specifier, { ...context, parentURL: anchor });
    }
    if (code === "MODULE_NOT_FOUND") {
      let resolved: string;
      try {
        resolved = requireResolve(specifier);
      } catch {
        throw error;
      }
      return next(resolved, context);
    }
  }
  throw error;
}

export function isBare(specifier: string): boolean {
  if (specifier.startsWith(".") || specifier.startsWith("/")) return false;
  if (specifier.startsWith("#")) return false;
  return !/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(specifier);
}
