import { proposeTools } from "./propose-tools.js";
import { readTools } from "./read-tools.js";
import type { AiTool, ToolDefinitionShape } from "./types.js";

/**
 * The allowlist, and the security boundary for the whole feature.
 *
 * A model can only ever invoke what appears here. This matters more than usual
 * in this codebase: PermissionManager.requirePermission exists but is currently
 * mounted on zero routes, so RBAC strings are a vocabulary for the admin role
 * editor rather than route enforcement. "The assistant cannot reach credentials
 * or user administration" is therefore a property of this list, not of the
 * permission system.
 *
 * Anything touching credentials, vaults, RBAC, users, identity, certificates,
 * SSO or instance settings is deliberately absent and must stay absent.
 */
export const AI_TOOLS: AiTool[] = [...readTools, ...proposeTools];

const BY_NAME = new Map(AI_TOOLS.map((tool) => [tool.name, tool]));

export function getTool(name: string): AiTool | undefined {
  return BY_NAME.get(name);
}

export function listToolNames(): string[] {
  return AI_TOOLS.map((tool) => tool.name);
}

/**
 * Domains the assistant must never be able to reach, in any tool, ever.
 * The catalog test asserts no tool name references these.
 */
export const FORBIDDEN_DOMAINS = [
  "credential",
  "vault",
  "rbac",
  "role",
  "permission",
  "user_admin",
  "password",
  "totp",
  "webauthn",
  "passkey",
  "api_key",
  "session",
  "oidc",
  "sso",
  "ldap",
  "termix_id",
  "identity",
  "certificate",
  "opkssh",
  "acme",
  "ssl",
  "audit",
  "sync",
  "settings",
];

/** Tool definitions in the shape the provider adapters expect. */
export function toolDefinitions(): ToolDefinitionShape[] {
  return AI_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}
