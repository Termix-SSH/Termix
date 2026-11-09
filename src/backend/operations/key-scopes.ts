/**
 * What a scoped API key may reach. Enforced where keys are authenticated, so a
 * limited key cannot step around the gate through /plugin-api or a ws ticket. A
 * key with no scopes has full access, which is every key made before this.
 */

export const API_KEY_SCOPES = ["operations:read", "operations:run"] as const;

const MCP_PATH = /^\/plugin-api\/[a-z0-9-]+\/mcp(\/|$)/;
const OPERATIONS_PATH = /^\/operations(\/|$)/;

export function parseKeyScopes(
  raw: string | null | undefined,
): string[] | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value)
      ? value.filter((scope): scope is string => typeof scope === "string")
      : [];
  } catch {
    // Unreadable means no access, not full access.
    return [];
  }
}

export function keyScopeAllows(
  scopes: string[] | null,
  method: string,
  path: string,
): boolean {
  if (scopes === null) return true;
  const clean = path.split("?")[0];
  if (MCP_PATH.test(clean)) {
    return (
      scopes.includes("operations:read") || scopes.includes("operations:run")
    );
  }
  if (!OPERATIONS_PATH.test(clean)) return false;
  if (scopes.includes("operations:run")) return true;
  if (!scopes.includes("operations:read")) return false;
  // The gate still checks each action's risk on a run.
  return method === "GET" || /^\/operations\/[^/]+\/run$/.test(clean);
}
