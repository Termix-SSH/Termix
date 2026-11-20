/**
 * Secrets masked before anything is kept for a diagnostics report. Mirrors
 * the server's patterns in src/backend/utils/logger.ts.
 */
const SECRET_PATTERNS: [RegExp, string][] = [
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
    "[PRIVATE KEY]",
  ],
  [/\btmx_[A-Za-z0-9]{16,}/g, "tmx_[MASKED]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [MASKED]"],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[JWT]"],
  [/\bsysenc:v\d+:[^\s"',]+/g, "sysenc:[MASKED]"],
  [/(:\/\/[^/\s:@]+:)[^@\s/]+@/g, "$1[MASKED]@"],
  [
    /([?&;\s](?:token|jwt|temp_token|access_token|refresh_token|id_token|password|secret|api_key|apikey|code)=)[^&\s;]+/gi,
    "$1[MASKED]",
  ],
  [/(\bjwt=)[^;\s]+/gi, "$1[MASKED]"],
];

const SENSITIVE_KEY =
  /pass(word|phrase)?|secret|token|private.?key|api.?key|authorization|cookie|jwt|credential/i;

export function redactText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/** Masks secret looking keys and text anywhere in a JSON-like value. */
export function redactData(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactText(value);
  if (!value || typeof value !== "object") return value;
  if (depth > 12) return "[too deep]";
  if (Array.isArray(value)) {
    return value.map((item) => redactData(item, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] =
      SENSITIVE_KEY.test(key) && item !== null && item !== undefined
        ? typeof item === "boolean"
          ? item
          : "[MASKED]"
        : redactData(item, depth + 1);
  }
  return out;
}

/**
 * A URL with its query values and any login in it masked. Keeps the path, so
 * a report still shows which route failed.
 */
export function redactUrl(raw: string, base?: string): string {
  try {
    const url = new URL(
      raw,
      base ?? (typeof location === "undefined" ? undefined : location.href),
    );
    if (url.username || url.password) {
      url.username = "";
      url.password = "";
    }
    const keys = [...new Set([...url.searchParams.keys()])];
    url.search = keys.length
      ? `?${keys.map((key) => `${encodeURIComponent(key)}=...`).join("&")}`
      : "";
    url.hash = url.hash ? "#..." : "";
    return url.href;
  } catch {
    return redactText(raw).slice(0, 300);
  }
}
