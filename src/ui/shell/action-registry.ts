/**
 * Runtime registry for plugin-contributed UI actions and the slots they fill.
 *
 * This is the frontend sibling of src/backend/plugins/service-registry.ts, and
 * the difference between them is the thing to be clear about:
 *
 *   - The backend registry's proxy IS a boundary. It checks the acting user's
 *     RBAC permission on every call before the provider ever runs.
 *   - This one is NOT. It runs in the browser, where anyone can call
 *     invokeAction from the console. The permission attached to an action
 *     decides whether a button is DRAWN, nothing more.
 *
 * Real enforcement stays where it already is: the backend route the handler
 * eventually calls. Treating this file as a security boundary is the easy
 * mistake to make when reading the two side by side, so it is said plainly
 * here rather than left to be inferred.
 *
 * Unlike the rail and tab registries (rail-items.ts, tabUtils.tsx), which are
 * plain Maps read during render, this one is reactive. A slot renders live and
 * has to react when a plugin is enabled or disabled at runtime, so it carries
 * subscribe/getSnapshot plumbing for useSyncExternalStore.
 */

import type { ComponentType } from "react";

/**
 * Args are unknown[] because the registry never inspects them: a slot owner
 * passes whatever its surface offers (the terminal passes its buffer text) and
 * the contributing plugin knows what to expect. Handlers are written with
 * concrete parameter types, so registerAction accepts those too.
 */
export type ActionHandler = (...args: never[]) => unknown;

export interface RegisteredAction {
  id: string;
  handler: ActionHandler;
  /** Role permission a user needs before this action is offered. */
  permission?: string;
  pluginId?: string;
}

export interface ActionSlotDefinition {
  id: string;
  /** Contribution kinds this slot will render. */
  accepts: string[];
}

export interface SlotContribution {
  /** Action invoked when this contribution is activated. */
  actionId: string;
  titleKey: string;
  /** Secondary text, for slots that show one (onboarding cards). */
  descriptionKey?: string;
  icon?: ComponentType<{ className?: string }>;
  /** Checked against the slot's accepts. Defaults to "button". */
  kind?: string;
  /**
   * For kind "component": rendered by the slot owner with its own props,
   * e.g. a panel docked into the terminal.
   */
  component?: ComponentType<Record<string, unknown>>;
  /** Extra condition, evaluated against the slot owner's context. */
  when?: (context: Record<string, unknown>) => boolean;
  pluginId?: string;
  /** Lower sorts first. Ties break on actionId so ordering is stable. */
  order?: number;
}

const actions = new Map<string, RegisteredAction>();
const slots = new Map<string, ActionSlotDefinition>();
/** slotId -> actionId -> contribution. */
const contributions = new Map<string, Map<string, SlotContribution>>();
const listeners = new Set<() => void>();

/**
 * Cached per-slot arrays.
 *
 * Required, not an optimization: useSyncExternalStore compares snapshots by
 * identity, so building a fresh array per call makes React throw "The result
 * of getSnapshot should be cached" and re-render forever.
 */
const snapshots = new Map<string, SlotContribution[]>();

const EMPTY: SlotContribution[] = [];

function emit(): void {
  snapshots.clear();
  for (const listener of listeners) listener();
}

export function registerAction(
  id: string,
  handler: ActionHandler,
  options: { permission?: string; pluginId?: string } = {},
): () => void {
  const action = { id, handler, ...options };
  actions.set(id, action);
  emit();
  return () => {
    if (actions.get(id) === action) {
      actions.delete(id);
      emit();
    }
  };
}

/** Every registered action. */
export function listActions(): RegisteredAction[] {
  return [...actions.values()];
}

/** Whether a handler is registered, i.e. its plugin is running. */
export function isActionRegistered(id: string): boolean {
  return actions.has(id);
}

/** The permission gating an action, if it declared one. */
export function getActionPermission(id: string): string | undefined {
  return actions.get(id)?.permission;
}

/**
 * Runs an action. Resolves quietly when the id is unknown: a contribution can
 * outlive the plugin that registered its handler, and a click should not throw
 * into the React event handler because of it.
 */
export async function invokeAction(
  id: string,
  ...args: unknown[]
): Promise<unknown> {
  const action = actions.get(id);
  if (!action) {
    console.warn(`[actions] no handler registered for "${id}"`);
    return undefined;
  }
  return (action.handler as (...a: unknown[]) => unknown)(...args);
}

export function declareActionSlot(slot: ActionSlotDefinition): () => void {
  slots.set(slot.id, slot);
  emit();
  return () => {
    if (slots.get(slot.id) === slot) {
      slots.delete(slot.id);
      emit();
    }
  };
}

/**
 * Adds a contribution to a slot.
 *
 * A contribution for a slot nobody has declared yet is kept rather than
 * dropped: plugin activation order is not guaranteed, and the slot owner may
 * register after the contributor. It becomes visible once the slot appears.
 */
export function registerSlotContribution(
  slotId: string,
  contribution: SlotContribution,
): () => void {
  const slot = slots.get(slotId);
  const kind = contribution.kind ?? "button";

  if (slot && !slot.accepts.includes(kind)) {
    console.warn(
      `[actions] slot "${slotId}" does not accept "${kind}" (accepts: ${slot.accepts.join(", ")})`,
    );
    return () => {};
  }

  let forSlot = contributions.get(slotId);
  if (!forSlot) {
    forSlot = new Map();
    contributions.set(slotId, forSlot);
  }
  const stored = { ...contribution, kind };
  forSlot.set(contribution.actionId, stored);
  emit();
  return () => {
    if (contributions.get(slotId)?.get(contribution.actionId) === stored) {
      unregisterSlotContribution(slotId, contribution.actionId);
    }
  };
}

export function unregisterSlotContribution(
  slotId: string,
  actionId: string,
): void {
  const forSlot = contributions.get(slotId);
  if (!forSlot?.delete(actionId)) return;
  if (forSlot.size === 0) contributions.delete(slotId);
  emit();
}

/**
 * Contributions for a slot, sorted and referentially stable between changes.
 * Unfiltered: callers that render go through useActionSlot, which drops the
 * ones the current user may not see.
 */
export function getSlotContributions(slotId: string): SlotContribution[] {
  const cached = snapshots.get(slotId);
  if (cached) return cached;

  const forSlot = contributions.get(slotId);
  if (!forSlot || forSlot.size === 0) {
    snapshots.set(slotId, EMPTY);
    return EMPTY;
  }

  const sorted = [...forSlot.values()].sort(
    (a, b) =>
      (a.order ?? 0) - (b.order ?? 0) || a.actionId.localeCompare(b.actionId),
  );
  snapshots.set(slotId, sorted);
  return sorted;
}

export function subscribeToActionRegistry(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam, mirroring resetPluginState(). */
export function resetActionRegistry(): void {
  actions.clear();
  slots.clear();
  contributions.clear();
  snapshots.clear();
  emit();
}
