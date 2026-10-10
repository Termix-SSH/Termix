/**
 * Docs links and env var entries from a manifest. Kept apart from manifest.ts
 * so the browser can use them without pulling in semver.
 */

/**
 * A docs link, or null for anything that is not an https URL. Core only ever
 * opens it in a new tab, but a javascript: or file: link should never get there.
 */
export function pluginDocsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

/** Joins a page and anchor onto a plugin's docs URL. */
export function pluginDocsPage(
  base: string,
  page?: string,
  anchor?: string,
): string {
  const clean = (page ?? "").replace(/^\/+|\/+$/g, "");
  const url = clean ? `${base}/${clean}` : base;
  return anchor ? `${url}#${anchor.replace(/^#/, "")}` : url;
}

export const ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
export const MAX_ENV_DESCRIPTION_LENGTH = 300;

/**
 * An environment variable a plugin reads. Only shown in docs and on the
 * plugin's page, so people know what they can set.
 */
export interface PluginEnvVar {
  name: string;
  description: string;
  /** The value used when it is not set, as written in a compose file. */
  default?: string;
  required?: boolean;
  /** Holds a password or key. */
  secret?: boolean;
}

/** The usable env entries of a manifest. Bad ones are dropped. */
export function pluginEnvVars(value: unknown): PluginEnvVar[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is PluginEnvVar =>
      typeof v === "object" &&
      v !== null &&
      typeof v.name === "string" &&
      ENV_NAME_PATTERN.test(v.name) &&
      typeof v.description === "string",
  );
}
