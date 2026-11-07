/**
 * Handlers plugins registered for the actions their manifest declares.
 *
 * Same generation rule as service-registry.ts: a plugin that crashed and
 * restarted must not have its old disposer remove the new registration, and a
 * run that resolved a handler before a reload must not call the stale one.
 */

import type {
  OperationAction,
  OperationResult,
} from "@termix-ssh/plugin-sdk/operations";

export interface OperationRunContext {
  hostId?: number;
  resourceKey?: string;
  runId: string | null;
  dryRun: boolean;
  signal: AbortSignal;
  log: (line: string) => void;
}

export interface OperationHandler {
  run: (
    input: Record<string, unknown>,
    context: OperationRunContext,
  ) => Promise<OperationResult> | OperationResult;
  /** What a dry run reports when the action has no native dry run. */
  describe?: (
    input: Record<string, unknown>,
    context: OperationRunContext,
  ) => string | Promise<string>;
}

export interface OperationRegistration {
  pluginId: string;
  action: OperationAction;
  handler: OperationHandler;
  generation: number;
}

const registrations = new Map<string, OperationRegistration>();
let generationCounter = 0;

export function registerAction(
  pluginId: string,
  action: OperationAction,
  handler: OperationHandler,
): OperationRegistration {
  const existing = registrations.get(action.id);
  if (existing && existing.pluginId !== pluginId) {
    throw new Error(
      `Action "${action.id}" is already registered by ${existing.pluginId}`,
    );
  }
  const entry = {
    pluginId,
    action,
    handler,
    generation: ++generationCounter,
  };
  registrations.set(action.id, entry);
  return entry;
}

/** Removes only the exact registration given. */
export function revokeAction(registration: OperationRegistration): boolean {
  const current = registrations.get(registration.action.id);
  if (!current || current.generation !== registration.generation) return false;
  return registrations.delete(registration.action.id);
}

export function getAction(id: string): OperationRegistration | undefined {
  return registrations.get(id);
}

export function listActions(): OperationRegistration[] {
  return [...registrations.values()];
}

/** Test seam. */
export function clearOperationRegistry(): void {
  registrations.clear();
}
