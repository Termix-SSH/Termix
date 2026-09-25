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
