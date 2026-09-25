/**
 * Cross-plugin secret references.
 *
 * A plugin that holds a secret (the AI assistant and its provider API key) can
 * offer it to other plugins by name, without ever handing over a copy. A
 * requiring plugin declares `requiresSecret` in its manifest and calls
 * ctx.secrets.getShared(pluginId, key) per request; the value is resolved from
 * the provider at that moment and returned for that one call.
 *
 * ## Why a resolver and not a stored value
 *
 * The registration holds a `resolve` callback owned by the providing plugin,
 * never the secret itself. That is the whole point of the design:
 *
 *   - The provider can rotate or clear the underlying secret at any time. The
 *     next getShared() runs the new resolver and sees the new value, with no
 *     invalidation step to forget and no cached copy to go stale.
 *   - There is nothing for the requiring plugin to persist. It gets a string
 *     back from one call. It could of course write that string somewhere
 *     itself, exactly as it could with any value it is legitimately given --
 *     what it cannot do is hold a handle that keeps working after the provider
 *     revokes, because every call re-resolves through the provider.
 *   - Uninstalling the provider deletes the registration, so every later
 *     getShared() returns null rather than throwing on a dangling handle. A
 *     missing dependency is a normal condition here, unlike a service call,
 *     which is why this returns null instead of the service registry's
 *     PluginServiceUnavailableError.
 *
 * ## Authorization is the provider's own permission
 *
 * No fourth grant mechanism. The provider declares which of its own role
 * permissions gates sharing (for example "<plugin>.secrets.share"),
 * and getShared runs the acting user through the same PermissionManager check
 * that service-registry.ts and requirePermission() use. So:
 *
 *   - An admin can let one user's requests reuse the shared key and deny
 *     another's, purely in the role editor, with no reinstall.
 *   - Revoking the RBAC permission takes effect on the very next call, exactly
 *     like revoking the secret itself.
 *   - The check is per-user and per-call, while `requiresSecret` in the
 *     manifest is per-install. They are independent on purpose: whether the
 *     plugin may ask is a deploy-time decision, whether this user's request
 *     gets a value is a runtime one.
 *
 * A denial is an error (the caller asked for something it is not allowed to
 * have), while an absent secret is null (the caller asked for something that
 * legitimately is not there). Collapsing the two would let a consumer treat
 * "you may not" as "not configured" and fall back to something weaker.
 */

import { pluginLogger } from "../utils/logger.js";
import type { PluginManifest, PluginSecretRequire } from "./manifest.js";

export interface SecretRegistration {
  /** The plugin offering the secret. */
  pluginId: string;
  /** Display name, for audit lines. */
  pluginName: string;
  /** The secret's name within that plugin, e.g. "api-key". */
  key: string;
  /** Role permission the acting user needs. Declared by the provider. */
  permission: string;
  /**
   * Returns the current value, or null when the provider has nothing set.
   * Called on every read so a rotation is picked up with no invalidation.
   */
  resolve: (userId: string) => Promise<string | null> | string | null;
  /** Bumped on every offer, so a re-registered provider invalidates nothing stale. */
  generation: number;
}

/** Keyed by `${pluginId}:${key}`. */
const secrets = new Map<string, SecretRegistration>();
let generationCounter = 0;

function mapKey(pluginId: string, key: string): string {
  return `${pluginId}:${key}`;
}

/**
 * Thrown when the acting user lacks the provider's sharing permission.
 *
 * Mirrors PluginServicePermissionError: `status` and `body` are the 403 shape
 * requirePermission() sends, so a consumer serving an HTTP request can pass it
 * straight through.
 */
export class PluginSecretPermissionError extends Error {
  readonly code = "EPLUGINSECRETPERM";
  readonly status = 403;
  readonly body: { error: string; required: string };

  constructor(pluginId: string, key: string, permission: string) {
    super(
      `You do not have access to the "${key}" secret shared by "${pluginId}". ` +
        `It requires the "${permission}" permission.`,
    );
    this.name = "PluginSecretPermissionError";
    this.body = { error: "Insufficient permissions", required: permission };
  }
}

/** Thrown when a read cannot be attributed to a user. */
export class PluginSecretActorError extends Error {
  readonly code = "EPLUGINSECRETACTOR";

  constructor(pluginId: string, key: string) {
    super(
      `A read of "${pluginId}:${key}" has no acting user. Pass one with ` +
        `ctx.secrets.getShared(pluginId, key, { userId }) or ctx.asUser.`,
    );
    this.name = "PluginSecretActorError";
  }
}

/** Thrown when a plugin asks for a secret its manifest never declared. */
export class PluginSecretUndeclaredError extends Error {
  readonly code = "EPLUGINSECRETUNDECLARED";

  constructor(consumerPluginId: string, pluginId: string, key: string) {
    super(
      `Plugin ${consumerPluginId} cannot read "${pluginId}:${key}": it is not ` +
        `declared in the manifest's requiresSecret array`,
    );
    this.name = "PluginSecretUndeclaredError";
  }
}

export function offerSecret(
  registration: Omit<SecretRegistration, "generation">,
): SecretRegistration {
  const id = mapKey(registration.pluginId, registration.key);
  const existing = secrets.get(id);
  if (existing) {
    pluginLogger.warn(
      `Shared secret "${id}" is already offered and is being replaced`,
      { operation: "plugin_secret_registry" },
    );
  }

  const entry: SecretRegistration = {
    ...registration,
    generation: ++generationCounter,
  };
  secrets.set(id, entry);
  return entry;
}

/**
 * Withdraws an offer, identity-checked like revokeService: a provider that
 * crashed and restarted must not withdraw the replacement its own restart
 * installed.
 *
 * Nothing is remembered afterwards. A service keeps a tombstone so a held
 * handle throws a named error, but a secret reference has no handle to keep
 * alive -- the next read simply finds nothing and returns null.
 */
export function withdrawSecret(
  pluginId: string,
  key: string,
  registration?: SecretRegistration,
): boolean {
  const id = mapKey(pluginId, key);
  const current = secrets.get(id);
  if (!current) return false;
  if (registration && current.generation !== registration.generation) {
    return false;
  }
  return secrets.delete(id);
}

/** Withdraws every offer made by one plugin. Used when it is uninstalled. */
export function withdrawAllForPlugin(pluginId: string): number {
  let removed = 0;
  for (const [id, registration] of secrets) {
    if (registration.pluginId === pluginId) {
      secrets.delete(id);
      removed++;
    }
  }
  return removed;
}

export function getSecretRegistration(
  pluginId: string,
  key: string,
): SecretRegistration | undefined {
  return secrets.get(mapKey(pluginId, key));
}

export function listSecrets(): SecretRegistration[] {
  return [...secrets.values()];
}

/** Test seam. */
export function clearSecretRegistry(): void {
  secrets.clear();
}

export interface SecretRequirementResolution {
  /** Declared requirements whose provider is present and has a value offered. */
  available: string[];
  /** Declared requirements with no matching offer right now. */
  unavailable: string[];
  /** Human-readable reasons for each unsatisfied non-optional requirement. */
  errors: string[];
}

/**
 * Structural resolution of a manifest's `requiresSecret`.
 *
 * Like resolveRequirements in service-registry.ts, this deliberately does NOT
 * consult any user's permissions: activation is per-instance, permissions are
 * per-user. It only asks whether the named plugin currently offers the key.
 *
 * Availability here is a snapshot for logging and install-time feedback. It is
 * never cached into the call path -- getShared re-resolves every time, so a
 * provider that appears after activation starts working with no restart.
 */
export function resolveSecretRequirements(
  manifest: PluginManifest,
): SecretRequirementResolution {
  const available: string[] = [];
  const unavailable: string[] = [];
  const errors: string[] = [];

  for (const requirement of manifest.requiresSecret ?? []) {
    const id = mapKey(requirement.plugin, requirement.key);
    if (secrets.has(id)) {
      available.push(id);
      continue;
    }

    unavailable.push(id);
    if (!requirement.optional) {
      errors.push(
        `requires secret "${requirement.key}" from plugin "${requirement.plugin}", which is not currently offered`,
      );
    }
  }

  return { available, unavailable, errors };
}

export interface SecretReadContext {
  /** Resolves the user this read acts as. */
  resolveUserId: () => string | undefined;
  /** Checks a role permission for a user. */
  hasPermission: (userId: string, permission: string) => Promise<boolean>;
  /** Writes the audit line. Must never throw. Awaited before the value returns. */
  audit: (entry: SecretAuditEntry) => void | Promise<void>;
}

export interface SecretAuditEntry {
  userId: string;
  consumerPluginId: string;
  providerPluginId: string;
  providerPluginName: string;
  key: string;
  /** False for a denial, true for an allowed read whether or not a value existed. */
  success: boolean;
  /** Whether a value actually came back. Never the value itself. */
  resolved: boolean;
  errorMessage?: string;
}

/**
 * Reads a shared secret for one call.
 *
 * Returns null, rather than throwing, when the provider is not installed or
 * has nothing set. Those are ordinary conditions a consumer is expected to
 * handle (fall back to its own key, or tell the user to configure one), and an
 * optional dependency that threw would force every consumer to wrap each read.
 *
 * Throws only for the two cases that are genuinely wrong: a plugin reading
 * something its manifest never declared, and a user without the permission.
 */
export async function readSharedSecret(
  consumerManifest: PluginManifest,
  providerPluginId: string,
  key: string,
  context: SecretReadContext,
): Promise<string | null> {
  const consumerPluginId = consumerManifest.id;

  // Declared in the manifest, the same rule services.provide enforces: a
  // plugin cannot reach a secret it never asked for, even if an admin granted
  // the permission for some other reason.
  const declared = (consumerManifest.requiresSecret ?? []).find(
    (entry: PluginSecretRequire) =>
      entry.plugin === providerPluginId && entry.key === key,
  );
  if (!declared) {
    throw new PluginSecretUndeclaredError(
      consumerPluginId,
      providerPluginId,
      key,
    );
  }

  const registration = secrets.get(mapKey(providerPluginId, key));

  // Provider absent: uninstalled, disabled, or never installed. Indistinguish-
  // able on purpose, and all four are the same answer to the consumer -- which
  // is also what makes an uninstall clean rather than a dangling handle.
  if (!registration) return null;

  const userId = context.resolveUserId();
  if (!userId) {
    throw new PluginSecretActorError(providerPluginId, key);
  }

  const allowed = await context.hasPermission(userId, registration.permission);
  if (!allowed) {
    const error = new PluginSecretPermissionError(
      providerPluginId,
      key,
      registration.permission,
    );
    await context.audit({
      userId,
      consumerPluginId,
      providerPluginId: registration.pluginId,
      providerPluginName: registration.pluginName,
      key,
      success: false,
      resolved: false,
      errorMessage: error.message,
    });
    throw error;
  }

  try {
    const value = await registration.resolve(userId);
    const resolved = typeof value === "string" && value.length > 0;

    await context.audit({
      userId,
      consumerPluginId,
      providerPluginId: registration.pluginId,
      providerPluginName: registration.pluginName,
      key,
      success: true,
      resolved,
    });

    return resolved ? value : null;
  } catch (error) {
    await context.audit({
      userId,
      consumerPluginId,
      providerPluginId: registration.pluginId,
      providerPluginName: registration.pluginName,
      key,
      success: false,
      resolved: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    // A provider whose own lookup failed is not a permission problem, and the
    // consumer should not read it as "not configured" and fall back.
    throw error;
  }
}
