import {
  parseImageHostPath,
  parseImageLocalDir,
} from "./images/image-storage-settings.js";
import { ADMIN_KEYS } from "./settings.js";

/**
 * Save-time checks for the admin settings: the image storage paths must be
 * absolute, since a relative one silently depends on the server's cwd.
 */
export function validateAdminSettings(
  values: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const localDir = values[ADMIN_KEYS.imageLocalDir];
  if (
    typeof localDir === "string" &&
    localDir.trim() !== "" &&
    parseImageLocalDir(localDir) === null
  ) {
    errors[ADMIN_KEYS.imageLocalDir] = "Use an absolute path";
  }
  const hostPath = values[ADMIN_KEYS.imageHostPath];
  if (
    typeof hostPath === "string" &&
    hostPath.trim() !== "" &&
    parseImageHostPath(hostPath) === null
  ) {
    errors[ADMIN_KEYS.imageHostPath] = "Use an absolute path";
  }
  return errors;
}

const MAX_MACROS = 100;
const MAX_MACROS_BYTES = 512 * 1024;

/** Save-time checks for the user settings: macros stay bounded. */
export function validateUserSettings(
  values: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (values.macros === undefined || values.macros === null) return errors;
  let macros = values.macros;
  if (typeof macros === "string") {
    try {
      macros = JSON.parse(macros);
    } catch {
      macros = null;
    }
  }
  const valid =
    Array.isArray(macros) &&
    macros.length <= MAX_MACROS &&
    JSON.stringify(macros).length <= MAX_MACROS_BYTES &&
    macros.every(
      (macro) =>
        !!macro &&
        typeof macro === "object" &&
        typeof (macro as { id?: unknown }).id === "string" &&
        typeof (macro as { name?: unknown }).name === "string" &&
        Array.isArray((macro as { steps?: unknown }).steps),
    );
  if (!valid) {
    errors.macros = `Macros must be a list of at most ${MAX_MACROS} valid macros`;
  }
  return errors;
}
