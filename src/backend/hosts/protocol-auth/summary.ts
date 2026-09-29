/**
 * The browser-facing shape of a host's protocol logins. No database access,
 * so the host normalizers can use it.
 */

/** What a browser sees of a login: no secret values, only whether they are set. */
export interface ProtocolAuthSummary {
  authType: string;
  credentialId: number | null;
  username: string | null;
  fields: Record<string, string>;
  hasPassword: boolean;
  secretFieldKeys: string[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * What a shared recipient may see of each login: never whether secrets are
 * set, and at connect level only the auth type.
 */
export function sanitizeProtocolAuthForRecipient(
  value: unknown,
  permissionLevel: string | undefined,
): Record<string, unknown> {
  if (!isObject(value)) return {};
  const out: Record<string, unknown> = {};
  for (const [protocol, summary] of Object.entries(value)) {
    if (!isObject(summary)) continue;
    out[protocol] =
      permissionLevel === "connect"
        ? { authType: summary.authType }
        : {
            authType: summary.authType,
            credentialId: summary.credentialId ?? null,
            username: summary.username ?? null,
            fields: summary.fields ?? {},
          };
  }
  return out;
}
