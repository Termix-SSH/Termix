/**
 * Defense in depth for anything about to leave the server.
 *
 * Read tools already select explicit field allowlists rather than spreading
 * rows, so nothing secret should reach here. This exists because "should" is
 * not a guarantee: a future tool that forgets to project its fields would
 * otherwise ship credentials to a third-party model provider.
 */

const SECRET_KEY_PATTERN =
  /^(password|passwd|pass|secret|token|api_?key|apikey|private_?key|privatekey|key_?password|keypassword|passphrase|client_?secret|authorization|auth_?token|access_?token|refresh_?token|totp_?secret|backup_?codes|session_?token|cookie|credential|ssh_?cert|data_?key|dek)$/i;

/** Substring markers for keys that are not exact matches but still sensitive. */
const SECRET_KEY_SUBSTRINGS = [
  "password",
  "secret",
  "privatekey",
  "private_key",
  "apikey",
  "api_key",
  "passphrase",
];

const VALUE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  {
    pattern:
      /-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*?-----END[^-]*PRIVATE KEY-----/g,
    label: "[redacted private key]",
  },
  { pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g, label: "[redacted api key]" },
  { pattern: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g, label: "[redacted api key]" },
  { pattern: /\bghp_[A-Za-z0-9]{20,}\b/g, label: "[redacted token]" },
  { pattern: /\btmx_[A-Za-z0-9_-]{16,}\b/g, label: "[redacted token]" },
  {
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\b/g,
    label: "[redacted token]",
  },
  {
    pattern: /\bBearer\s+[A-Za-z0-9._-]{16,}/gi,
    label: "Bearer [redacted]",
  },
];

export const REDACTED = "[redacted]";

function isSecretKey(key: string): boolean {
  if (SECRET_KEY_PATTERN.test(key)) return true;
  const lower = key.toLowerCase();
  return SECRET_KEY_SUBSTRINGS.some((marker) => lower.includes(marker));
}

export function redactString(value: string): string {
  let output = value;
  for (const { pattern, label } of VALUE_PATTERNS) {
    output = output.replace(pattern, label);
  }
  return output;
}

/**
 * Recursively drops secret-named fields and masks secret-shaped values.
 * Depth is bounded so a cyclic or pathological structure cannot hang the loop.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 12) return REDACTED;

  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.map((entry) => redact(entry, depth + 1));
  }

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretKey(key)) {
      // Preserve the shape so the model can still reason about presence,
      // without ever seeing the value.
      output[key] = entry === null || entry === undefined ? null : REDACTED;
      continue;
    }
    output[key] = redact(entry, depth + 1);
  }
  return output;
}

/** Convenience wrapper for serializing a tool result. */
export function redactToJson(value: unknown): string {
  return JSON.stringify(redact(value));
}
