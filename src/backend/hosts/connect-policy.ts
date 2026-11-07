/**
 * Connect policy from plugins through ctx.hosts.connectPolicy.provide. Core
 * asks every provider before it builds an SSH config or hands out a remote
 * desktop login, and the strictest answer wins: deny, then request, then
 * allow. A provider that throws denies, since letting a session through when
 * the access rule is broken is worse than a failed connect. No provider means
 * allow.
 */

import type {
  PluginConnectPolicyDecision,
  PluginConnectPolicyInput,
  PluginConnectPolicyProvider,
} from "@termix-ssh/plugin-sdk/backend";
import { pluginLogger } from "../utils/logger.js";

interface Entry {
  pluginId: string;
  provider: PluginConnectPolicyProvider;
}

const providers = new Map<symbol, Entry>();

export type ConnectPolicyResult =
  | { decision: "allow" }
  | {
      decision: "deny" | "request";
      reason: string;
      pluginId: string;
      requestTab: string | null;
    };

export class ConnectPolicyError extends Error {
  readonly status = 403;
  readonly code: "access-denied" | "access-required";
  constructor(
    readonly result: Exclude<ConnectPolicyResult, { decision: "allow" }>,
  ) {
    super(result.reason);
    this.name = "ConnectPolicyError";
    this.code =
      result.decision === "request" ? "access-required" : "access-denied";
  }

  /** The body routes send back, so a client can offer the request tab. */
  toJSON(): {
    error: string;
    code: string;
    requestTab: string | null;
    pluginId: string;
  } {
    return {
      error: this.message,
      code: this.code,
      requestTab: this.result.requestTab,
      pluginId: this.result.pluginId,
    };
  }
}

export function provideConnectPolicy(
  pluginId: string,
  provider: PluginConnectPolicyProvider,
): () => void {
  const key = Symbol(pluginId);
  providers.set(key, { pluginId, provider });
  return () => {
    providers.delete(key);
  };
}

/** Test seam. */
export function clearConnectPolicies(): void {
  providers.clear();
}

export function hasConnectPolicies(): boolean {
  return providers.size > 0;
}

const RANK = { allow: 0, request: 1, deny: 2 } as const;

function plainTab(value: unknown): string | null {
  return typeof value === "string" &&
    /^[a-z0-9][a-z0-9:_.-]{0,80}$/i.test(value)
    ? value
    : null;
}

export async function evaluateConnectPolicy(
  input: PluginConnectPolicyInput,
): Promise<ConnectPolicyResult> {
  let result: ConnectPolicyResult = { decision: "allow" };
  for (const entry of providers.values()) {
    let decision: PluginConnectPolicyDecision;
    try {
      decision = (await entry.provider.check(input)) ?? { decision: "allow" };
    } catch (error) {
      pluginLogger.warn("Connect policy failed, refusing the connection", {
        operation: "connect_policy",
        pluginId: entry.pluginId,
        hostId: input.hostId,
        error: error instanceof Error ? error.message : String(error),
      });
      decision = {
        decision: "deny",
        reason: "Access to this host can't be checked right now",
      };
    }
    const kind =
      decision.decision === "deny" || decision.decision === "request"
        ? decision.decision
        : "allow";
    if (RANK[kind] <= RANK[result.decision]) continue;
    if (kind === "allow") continue;
    const reason =
      "reason" in decision && typeof decision.reason === "string"
        ? decision.reason.slice(0, 300)
        : "";
    result = {
      decision: kind,
      reason:
        reason ||
        (kind === "request"
          ? "This host needs approved access"
          : "Access to this host is not allowed"),
      pluginId: entry.pluginId,
      requestTab:
        kind === "request" && "requestTab" in decision
          ? plainTab(decision.requestTab)
          : null,
    };
  }
  return result;
}

async function auditRefusal(
  input: PluginConnectPolicyInput,
  result: Exclude<ConnectPolicyResult, { decision: "allow" }>,
): Promise<void> {
  const audit = await import("../utils/audit-logger.js");
  const username = await audit
    .getAuditUsername(input.userId)
    .catch(() => input.userId);
  void audit.logAudit({
    userId: input.userId,
    username,
    action: "connect_policy_denied",
    resourceType: "host",
    resourceId: String(input.hostId),
    details: `${input.protocol} ${result.decision} by ${result.pluginId}: ${result.reason}`,
    success: false,
  });
}

/** Throws ConnectPolicyError when a provider denies or wants a request. */
export async function assertConnectAllowed(
  input: PluginConnectPolicyInput,
): Promise<void> {
  if (providers.size === 0) return;
  const result = await evaluateConnectPolicy(input);
  if (result.decision === "allow") return;
  await auditRefusal(input, result).catch(() => {});
  throw new ConnectPolicyError(result);
}
