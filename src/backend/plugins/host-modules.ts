import module from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPluginsDir } from "./paths.js";

/**
 * A plugin build leaves host packages (drizzle-orm, express, ssh2, ...) for
 * core to supply, and Node finds them by walking up from the importing file.
 * That works for bundled plugins inside the app, but a .tmxplug unpacked into
 * a data dir outside it (the desktop app keeps it in AppData) finds nothing.
 * Those imports fall back to core's own copy, the one bundled plugins get.
 */

let installed = false;

export function isBareSpecifier(specifier: string): boolean {
  if (specifier.startsWith(".") || specifier.startsWith("/")) return false;
  if (specifier.startsWith("#")) return false;
  // file:, node:, data:, and a Windows drive letter
  return !/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(specifier);
}

/** Whether an import from parentURL may fall back to core's packages. */
export function isUserPluginFile(
  parentURL: string | undefined,
  pluginsDir: string,
): boolean {
  if (!parentURL?.startsWith("file:")) return false;
  let file: string;
  try {
    file = fileURLToPath(new URL(parentURL));
  } catch {
    return false;
  }
  const relative = path.relative(path.resolve(pluginsDir), file);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}

export function installHostModuleFallback(): void {
  if (installed) return;
  installed = true;
  // Node 22.15+. Older runtimes keep plain resolution.
  if (typeof module.registerHooks !== "function") return;
  module.registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        if (
          (error as { code?: string })?.code !== "ERR_MODULE_NOT_FOUND" ||
          !isBareSpecifier(specifier) ||
          !isUserPluginFile(context.parentURL, getPluginsDir())
        ) {
          throw error;
        }
        return nextResolve(specifier, {
          ...context,
          parentURL: import.meta.url,
        });
      }
    },
  });
}
