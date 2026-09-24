/**
 * Declared, versioned, per-user-permissioned service contracts between plugins.
 *
 * This is the typed sibling of registry.ts. That one is a bare key/value map a
 * plugin can put anything into; this one only carries services a manifest
 * declared, at a declared version, behind a declared role permission.
 *
 * ## What the permission actually gates
 *
 * Be precise, because there are two unrelated permission systems in this
 * runtime and conflating them is the easy mistake:
 *
 *   - permissions.ts gates what a PLUGIN may do (manifest + admin grant).
 *   - this file gates what a USER may do, through PermissionManager, the same
 *     RBAC check requirePermission() runs on an HTTP route.
 *
 * A service permission is an ordinary role permission string. It shows up in
 * the admin role editor like hosts.view does, and an admin can grant or revoke
 * it per role or per user at any time, whether or not the consuming plugin is
 * installed.
 *
 * The check runs on every call rather than once when the handle is made. That
 * is deliberate and is the whole reason the gate lives in the proxy: a revoke
 * mid-session has to take effect on the next call, with no restart and no
 * reinstall. PermissionManager's per-user cache is already invalidated by the
 * RBAC routes that change a role, so "next call" is immediate in practice.
 *
 * ## Resolution is structural, permission is per-call
 *
 * resolveRequirements only asks "is this service present at a satisfying
 * version". It deliberately does NOT consult any user's permissions:
 * activation is per-instance and permissions are per-user, so gating
 * activation on one user's grants would be meaningless. A user who lacks the
 * permission gets a clear denial from the call instead of the requiring plugin
 * mysteriously failing to start.
 */

import semver from "semver";
import { pluginLogger } from "../utils/logger.js";
import { runAsActor } from "./actor.js";
import type { PluginManifest, PluginServiceRequire } from "./manifest.js";

export interface ServiceRegistration {
  service: string;
  version: string;
  permission: string;
  /** The plugin that provided it. */
  pluginId: string;
  /** Display name, for audit lines. */
  pluginName: string;
  implementation: Record<string, unknown>;
  /**
   * Bumped on every provide. A handle captures the value it was made against,
   * so a provider that was revoked and re-registered invalidates old handles
   * rather than silently rebinding them to a different object.
   */
  generation: number;
}

const services = new Map<string, ServiceRegistration>();
/**
 * What a service looked like before it was revoked.
 *
 * A handle taken while the provider was up must keep throwing a named error
 * after it goes away, rather than degrading to "undefined is not a function",
 * which would tell a consumer nothing about why its dependency vanished.
 */
const retired = new Map<string, { pluginId: string; methods: Set<string> }>();
let generationCounter = 0;

/** Thrown when the provider went away while a consumer still held a handle. */
export class PluginServiceUnavailableError extends Error {
  readonly code = "EPLUGINSVCGONE";

  constructor(service: string, providerPluginId: string) {
    super(
      `Service "${service}" is no longer provided (was: ${providerPluginId}). ` +
        `The providing plugin has been disabled or replaced.`,
    );
    this.name = "PluginServiceUnavailableError";
  }
}

/**
 * Thrown when the acting user lacks the service's permission.
 *
 * `status` and `body` are the same 403 shape requirePermission() sends, so a
 * consumer serving an HTTP request can pass it straight through.
 */
export class PluginServicePermissionError extends Error {
  readonly code = "EPLUGINSVCPERM";
  readonly status = 403;
  readonly body: { error: string; required: string };

  constructor(service: string, permission: string) {
    super(
      `You do not have access to "${service}". It requires the "${permission}" permission.`,
    );
    this.name = "PluginServicePermissionError";
    this.body = { error: "Insufficient permissions", required: permission };
  }
}

/** Thrown when a call cannot be attributed to a user. */
export class PluginServiceActorError extends Error {
  readonly code = "EPLUGINSVCACTOR";

  constructor(service: string) {
    super(
      `A call to "${service}" has no acting user. Pass one with ` +
        `ctx.services.get(name, { userId }) or handle.asUser(userId).`,
    );
    this.name = "PluginServiceActorError";
  }
}

export function provideService(
  registration: Omit<ServiceRegistration, "generation">,
): ServiceRegistration {
  const existing = services.get(registration.service);
  if (existing) {
    pluginLogger.warn(
      `Service "${registration.service}" is already provided by ${existing.pluginId} and is being replaced by ${registration.pluginId}`,
      { operation: "plugin_service_registry" },
    );
  }

  const entry: ServiceRegistration = {
    ...registration,
    generation: ++generationCounter,
  };
  services.set(registration.service, entry);
  retired.delete(registration.service);
  return entry;
}

/**
 * Removes a provider, but only the exact registration given. A plugin that
 * crashed and restarted must not revoke the replacement its own restart
 * installed, so this is identity-checked rather than by name.
 */
export function revokeService(
  service: string,
  registration?: ServiceRegistration,
): boolean {
  const current = services.get(service);
  if (!current) return false;
  if (registration && current.generation !== registration.generation) {
    return false;
  }

  retired.set(service, {
    pluginId: current.pluginId,
    methods: new Set(
      Object.keys(current.implementation).filter(
        (key) => typeof current.implementation[key] === "function",
      ),
    ),
  });
  return services.delete(service);
}

export function getRegistration(
  service: string,
): ServiceRegistration | undefined {
  return services.get(service);
}

/**
 * A plugin service as core itself calls it, or undefined while no plugin
 * provides a compatible version.
 *
 * Core is not a plugin and already authorized the request it is serving, so
 * this skips the per-call permission check a plugin's handle runs. It is the
 * same object plugins get. Session sharing reaching the terminal's live
 * sessions is the first caller.
 */
export function getServiceImplementation<T extends object>(
  service: string,
  versionRange: string,
): T | undefined {
  const registration = services.get(service);
  if (!registration) return undefined;
  if (!semver.satisfies(registration.version, versionRange)) return undefined;
  return registration.implementation as T;
}

export function listServices(): ServiceRegistration[] {
  return [...services.values()];
}

/** Test seam. */
export function clearServiceRegistry(): void {
  services.clear();
  retired.clear();
}

export interface RequirementResolution {
  satisfied: boolean;
  /** Human-readable reasons for each unsatisfied hard requirement. */
  errors: string[];
  /** Optional requirements that are not currently available. */
  missingOptional: string[];
}

/**
 * Structural resolution of a manifest's `requires` against what is registered
 * right now. Generic over the service name -- nothing is special-cased.
 */
export function resolveRequirements(
  manifest: PluginManifest,
): RequirementResolution {
  const errors: string[] = [];
  const missingOptional: string[] = [];

  for (const requirement of manifest.requires ?? []) {
    const registration = services.get(requirement.service);

    if (!registration) {
      recordUnsatisfied(
        requirement,
        `requires service "${requirement.service}" (${requirement.versionRange}), which no active plugin provides`,
        errors,
        missingOptional,
      );
      continue;
    }

    if (!semver.satisfies(registration.version, requirement.versionRange)) {
      recordUnsatisfied(
        requirement,
        `requires service "${requirement.service}" ${requirement.versionRange}, but ${registration.pluginId} provides ${registration.version}`,
        errors,
        missingOptional,
      );
    }
  }

  return { satisfied: errors.length === 0, errors, missingOptional };
}

function recordUnsatisfied(
  requirement: PluginServiceRequire,
  message: string,
  errors: string[],
  missingOptional: string[],
): void {
  if (requirement.optional) {
    missingOptional.push(requirement.service);
    return;
  }
  errors.push(message);
}

export interface ServiceCallContext {
  /** Resolves the user this call acts as. */
  resolveUserId: () => string | undefined;
  /** Checks a role permission for a user. */
  hasPermission: (userId: string, permission: string) => Promise<boolean>;
  /**
   * Writes the audit line. Must never throw.
   *
   * Awaited before the call's own result is handed back, so an action is on
   * the trail before the caller can act on it. The broker can afford to fire
   * and forget because it replies over postMessage; here the caller is
   * holding the promise.
   */
  audit: (entry: ServiceAuditEntry) => void | Promise<void>;
}

export interface ServiceAuditEntry {
  userId: string;
  consumerPluginId: string;
  registration: ServiceRegistration;
  method: string;
  args: unknown[];
  success: boolean;
  errorMessage?: string;
}

/**
 * Wraps a registration in a handle whose every method runs the permission
 * check before delegating.
 *
 * A Proxy rather than a hand-written wrapper so this stays generic over
 * whatever shape the provider chose to hand out. Only own, callable properties
 * of that object are reachable -- a consumer can call exactly what the
 * provider exposed and nothing else. This is a set of individually declared
 * contracts, not a general "call any method on any plugin" bus.
 */
export function createServiceHandle<T extends object>(
  service: string,
  consumerPluginId: string,
  context: ServiceCallContext,
): T {
  const target = Object.create(null) as T;

  return new Proxy(target, {
    get(_target, property) {
      if (typeof property !== "string") return undefined;

      if (property === "asUser") {
        return (userId: string) =>
          createServiceHandle<T>(service, consumerPluginId, {
            ...context,
            resolveUserId: () => userId,
          });
      }

      // Resolved at call time, not here: the provider may have gone away
      // between taking the handle and using it. A method that WAS reachable
      // must keep throwing the typed error rather than degrading to
      // `undefined is not a function`, which tells a consumer nothing about
      // why its dependency vanished.
      const registration = services.get(service);
      if (!registration) {
        const gone = retired.get(service);
        if (!gone?.methods.has(property)) return undefined;
        return () => {
          throw new PluginServiceUnavailableError(service, gone.pluginId);
        };
      }

      const value = registration.implementation[property];
      if (typeof value !== "function") return undefined;

      return (...args: unknown[]) =>
        invokeGuarded(
          service,
          property,
          args,
          consumerPluginId,
          context,
          registration.generation,
        );
    },

    has(_target, property) {
      const registration = services.get(service);
      if (!registration || typeof property !== "string") return false;
      return typeof registration.implementation[property] === "function";
    },

    ownKeys() {
      const registration = services.get(service);
      if (!registration) return [];
      return Object.keys(registration.implementation).filter(
        (key) => typeof registration.implementation[key] === "function",
      );
    },

    getOwnPropertyDescriptor(_target, property) {
      const registration = services.get(service);
      if (!registration || typeof property !== "string") return undefined;
      if (typeof registration.implementation[property] !== "function") {
        return undefined;
      }
      return { configurable: true, enumerable: true, writable: false };
    },
  }) as T;
}

async function invokeGuarded(
  service: string,
  method: string,
  args: unknown[],
  consumerPluginId: string,
  context: ServiceCallContext,
  expectedGeneration: number,
): Promise<unknown> {
  const registration = services.get(service);

  // Re-checked here rather than trusted from the get trap: a call is async and
  // the provider can be disabled between resolving the method and running it.
  if (!registration || registration.generation !== expectedGeneration) {
    throw new PluginServiceUnavailableError(
      service,
      registration?.pluginId ?? consumerPluginId,
    );
  }

  const userId = context.resolveUserId();
  if (!userId) throw new PluginServiceActorError(service);

  const allowed = await context.hasPermission(userId, registration.permission);
  if (!allowed) {
    const error = new PluginServicePermissionError(
      service,
      registration.permission,
    );
    await context.audit({
      userId,
      consumerPluginId,
      registration,
      method,
      args,
      success: false,
      errorMessage: error.message,
    });
    throw error;
  }

  const implementation = registration.implementation[method];
  if (typeof implementation !== "function") {
    throw new PluginServiceUnavailableError(service, registration.pluginId);
  }

  try {
    // Runs as the user the permission was checked for, so the provider reads
    // the same user from ctx.currentActor() and cannot be told another one.
    const result = await runAsActor(userId, "service", () =>
      (implementation as (...callArgs: unknown[]) => unknown).apply(
        registration.implementation,
        args,
      ),
    );

    await context.audit({
      userId,
      consumerPluginId,
      registration,
      method,
      args,
      success: true,
    });
    return result;
  } catch (error) {
    await context.audit({
      userId,
      consumerPluginId,
      registration,
      method,
      args,
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
