import { networkInterfaces } from "os";
import { normalizeSftpPath } from "../transfer-paths.js";

let cachedLocalAddresses: Set<string> | null = null;

export function normalizeHostAddress(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1);
  }
  return trimmed.split(":")[0] ?? trimmed;
}

function getLocalAddresses(): Set<string> {
  if (cachedLocalAddresses) return cachedLocalAddresses;

  const addresses = new Set(["127.0.0.1", "::1", "localhost"]);
  for (const ifaces of Object.values(networkInterfaces())) {
    if (!ifaces) continue;
    for (const iface of ifaces) {
      if (!iface.internal && iface.family === "IPv4") {
        addresses.add(iface.address.toLowerCase());
      }
    }
  }
  cachedLocalAddresses = addresses;
  return addresses;
}

export function isLocalSshEndpoint(ip?: string): boolean {
  if (!ip) return false;
  const bare = normalizeHostAddress(ip);
  if (bare === "localhost" || bare === "127.0.0.1" || bare === "::1") {
    return true;
  }
  return getLocalAddresses().has(bare);
}

export function escapeShell(s: string): string {
  return s.replace(/'/g, "'\"'\"'");
}

export function isRootOnlyPath(path: string): boolean {
  const normalized = normalizeSftpPath(path);
  return (
    normalized === "/" ||
    /^\/[A-Za-z]:$/.test(normalized) ||
    /^[A-Za-z]:$/.test(normalized)
  );
}

export function isPermissionError(err: Error): boolean {
  const msg = err.message.toLowerCase();
  return (
    msg.includes("permission denied") ||
    msg.includes("eacces") ||
    msg.includes("access denied")
  );
}
