import { BlockList, isIP } from "node:net";

export interface TrustedProxyAuthConfig {
  enabled: boolean;
  usernameHeader: string;
  roleHeader: string;
  trustedProxies: string[];
  roleMap: Map<string, string[]>;
}

function enabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

export function parseTrustedProxyRoleMap(
  value: string | undefined,
): Map<string, string[]> {
  if (!value?.trim()) return new Map();
  const parsed = JSON.parse(value) as Record<string, unknown>;
  const result = new Map<string, string[]>();
  for (const [externalRole, mapped] of Object.entries(parsed)) {
    const roles = (Array.isArray(mapped) ? mapped : [mapped])
      .filter((role): role is string => typeof role === "string")
      .map((role) => role.trim())
      .filter(Boolean);
    if (externalRole.trim() && roles.length > 0) {
      result.set(externalRole.trim(), [...new Set(roles)]);
    }
  }
  return result;
}

export function getTrustedProxyAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
): TrustedProxyAuthConfig {
  const config = {
    enabled: enabled(env.TRUSTED_PROXY_AUTH_ENABLED),
    usernameHeader: (
      env.TRUSTED_PROXY_AUTH_USERNAME_HEADER || "x-forwarded-username"
    ).toLowerCase(),
    roleHeader: (
      env.TRUSTED_PROXY_AUTH_ROLE_HEADER || "x-forwarded-role"
    ).toLowerCase(),
    trustedProxies: (env.TRUSTED_PROXY_AUTH_TRUSTED_PROXIES || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
    roleMap: parseTrustedProxyRoleMap(env.TRUSTED_PROXY_AUTH_ROLE_MAP),
  };

  if (
    config.enabled &&
    (config.trustedProxies.length === 0 || config.roleMap.size === 0)
  ) {
    throw new Error(
      "Trusted proxy auth requires TRUSTED_PROXY_AUTH_TRUSTED_PROXIES and TRUSTED_PROXY_AUTH_ROLE_MAP",
    );
  }
  if (
    config.enabled &&
    (!/^[a-z0-9-]+$/.test(config.usernameHeader) ||
      !/^[a-z0-9-]+$/.test(config.roleHeader))
  ) {
    throw new Error("Trusted proxy auth header names are invalid");
  }
  if (config.enabled) {
    // Build the allowlist during configuration parsing so an invalid CIDR
    // fails startup rather than surfacing on the first login attempt.
    isTrustedProxyAddress("127.0.0.1", config.trustedProxies);
  }
  return config;
}

function normalizeAddress(address: string): string {
  const withoutZone = address.split("%")[0];
  return withoutZone.startsWith("::ffff:")
    ? withoutZone.slice("::ffff:".length)
    : withoutZone;
}

export function isTrustedProxyAddress(
  address: string | undefined,
  trustedProxies: string[],
): boolean {
  if (!address) return false;
  const blockList = new BlockList();
  for (const entry of trustedProxies) {
    const [rawAddress, rawPrefix] = entry.split("/");
    const normalized = normalizeAddress(rawAddress);
    const family = isIP(normalized);
    if (!family) throw new Error(`Invalid trusted proxy address: ${entry}`);
    const type = family === 4 ? "ipv4" : "ipv6";
    if (rawPrefix === undefined) {
      blockList.addAddress(normalized, type);
      continue;
    }
    const prefix = Number(rawPrefix);
    const max = family === 4 ? 32 : 128;
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) {
      throw new Error(`Invalid trusted proxy CIDR: ${entry}`);
    }
    blockList.addSubnet(normalized, prefix, type);
  }
  const normalized = normalizeAddress(address);
  const family = isIP(normalized);
  return (
    family !== 0 && blockList.check(normalized, family === 4 ? "ipv4" : "ipv6")
  );
}

export function resolveTrustedProxyRoles(
  header: string,
  roleMap: Map<string, string[]>,
): string[] | null {
  const externalRoles = header
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean);
  if (externalRoles.length === 0) return null;
  const resolved = new Set<string>();
  for (const externalRole of externalRoles) {
    const mapped = roleMap.get(externalRole);
    if (!mapped) return null;
    mapped.forEach((role) => resolved.add(role));
  }
  return [...resolved];
}

export function isTrustedProxyAuthEnabled(): boolean {
  return enabled(process.env.TRUSTED_PROXY_AUTH_ENABLED);
}
