/**
 * The only shape of a host a plugin ever sees.
 *
 * This is an ALLOWLIST, deliberately, not a list of fields to strip. A
 * blocklist rots: the moment someone adds a new secret-bearing column to
 * SSHHost, a blocklist silently starts leaking it, and nothing fails. With an
 * allowlist a new field is invisible to plugins until someone consciously adds
 * it here.
 *
 * resolveHostById returns an object carrying password, key, keyPassword,
 * certPublicKey, sudoPassword and the autostart* secrets in plaintext. None of
 * them are in this list, and none of them may ever be.
 */

export interface PluginHostView {
  id: number;
  name: string | null;
  ip: string;
  port: number;
  username: string;
  folder: string | null;
  tags: string[];
  authType: string | null;
  enableTerminal: boolean;
  enableTunnel: boolean;
  enableFileManager: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

const NUMBER_FIELDS = ["id", "port"] as const;
const STRING_FIELDS = [
  "name",
  "ip",
  "username",
  "folder",
  "authType",
  "createdAt",
  "updatedAt",
] as const;
const BOOLEAN_FIELDS = [
  "enableTerminal",
  "enableTunnel",
  "enableFileManager",
] as const;

export function toPluginHostView(
  host: Record<string, unknown>,
): PluginHostView {
  const view: Record<string, unknown> = {};

  for (const field of NUMBER_FIELDS) {
    view[field] = Number(host[field] ?? 0);
  }
  for (const field of STRING_FIELDS) {
    const value = host[field];
    view[field] = typeof value === "string" ? value : null;
  }
  for (const field of BOOLEAN_FIELDS) {
    view[field] = Boolean(host[field]);
  }

  view.tags = Array.isArray(host.tags)
    ? host.tags.filter((tag): tag is string => typeof tag === "string")
    : [];

  return view as unknown as PluginHostView;
}
