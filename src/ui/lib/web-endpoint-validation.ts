import type { WebEndpoint } from "@/types/index";

/**
 * Editor-side validation for web endpoint rows.
 *
 * The authority on what a stored endpoint may look like is
 * `normalizeWebEndpoints` in
 * src/backend/database/routes/host-web-endpoints.ts, and it DROPS any row it
 * refuses rather than reporting it -- so without a check here the user adds a
 * row, saves, sees no error, and finds the endpoint gone on reload.
 *
 * This deliberately does NOT restate that module's full rule set, and does not
 * import it: the renderer does not import backend route modules (the same
 * reason MAX_WEB_ENDPOINTS lives in src/types rather than beside the
 * validator). It covers only the conditions a user can reach by typing.
 * src/ui/tests/lib/web-endpoint-validation.test.ts runs both implementations
 * over the same samples so the two cannot drift apart silently.
 */

export const MIN_WEB_ENDPOINT_PORT = 1;
export const MAX_WEB_ENDPOINT_PORT = 65535;

export type WebEndpointFieldError =
  "label" | "duplicateLabel" | "port" | "path";

const ERROR_KEYS: Record<WebEndpointFieldError, string> = {
  label: "hosts.webUiErrorLabelRequired",
  duplicateLabel: "hosts.webUiErrorLabelDuplicate",
  port: "hosts.webUiErrorPortRange",
  path: "hosts.webUiErrorPathInvalid",
};

/**
 * The i18n key for a field error. Every key takes a `row` interpolation so the
 * message can say which endpoint is at fault.
 */
export function webEndpointErrorKey(error: WebEndpointFieldError): string {
  return ERROR_KEYS[error];
}

export function isWebEndpointPortValid(port: unknown): boolean {
  return (
    typeof port === "number" &&
    Number.isInteger(port) &&
    port >= MIN_WEB_ENDPOINT_PORT &&
    port <= MAX_WEB_ENDPOINT_PORT
  );
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * True if the normalizer would accept this path. An empty or absent path is
 * fine -- the normalizer defaults it to "/" -- and so is a path with no
 * leading slash, which the normalizer coerces.
 */
export function isWebEndpointPathValid(
  raw: string | undefined | null,
): boolean {
  if (raw === undefined || raw === null || raw === "") return true;
  if (hasControlCharacter(raw)) return false;

  const path = raw.startsWith("/") ? raw : `/${raw}`;

  // A protocol-relative or absolute path would send the iframe or the link
  // somewhere other than the endpoint.
  if (path.startsWith("//")) return false;
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(path)) return false;
  if (path.includes("\\")) return false;

  return true;
}

/**
 * The first thing wrong with one row, or null if the normalizer would keep it.
 * Label is checked before port so the message points at the field the user
 * most likely just left blank.
 */
export function webEndpointRowError(
  endpoint: WebEndpoint,
): WebEndpointFieldError | null {
  if (typeof endpoint.label !== "string" || endpoint.label.trim() === "") {
    return "label";
  }
  if (!isWebEndpointPortValid(endpoint.port)) return "port";
  if (!isWebEndpointPathValid(endpoint.path)) return "path";
  return null;
}

/**
 * The first row the normalizer would drop, so a save can be blocked with a
 * message naming it. Returns null when every row would survive.
 *
 * Duplicate LABELS are reported even though the normalizer tolerates them:
 * the sidebar picker shows labels, so two identical ones are indistinguishable
 * to the user. Duplicate ids are generated, never typed.
 */
export function findInvalidWebEndpoint(
  endpoints: WebEndpoint[] | undefined | null,
): { index: number; error: WebEndpointFieldError } | null {
  if (!Array.isArray(endpoints)) return null;

  const seen = new Set<string>();
  for (let index = 0; index < endpoints.length; index += 1) {
    const endpoint = endpoints[index];
    const error = webEndpointRowError(endpoint);
    if (error) return { index, error };

    const label = endpoint.label.trim().toLowerCase();
    if (seen.has(label)) return { index, error: "duplicateLabel" };
    seen.add(label);
  }

  return null;
}
