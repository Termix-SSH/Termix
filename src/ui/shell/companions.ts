import { useSyncExternalStore, type ComponentType } from "react";
import type { Host, Tab } from "@/types/ui-types";
import { byOrderThenId, createRegistry } from "@/lib/registry";

export type CompanionSide = "left" | "right" | "bottom";

export interface CompanionDefaults {
  /** Open by itself the first time a matching tab shows. */
  open?: boolean;
  side?: CompanionSide;
  /** Pixels of width, or height at the bottom. */
  size?: number;
  /** Show the edge button that opens and closes it. */
  edgeButton?: boolean;
}

export interface CompanionRenderProps {
  tab: Tab;
  host?: Host;
  sshHost?: Record<string, unknown>;
  /** The tab's surface handle, read at call time. */
  getHandle: () => Record<string, unknown> | null;
  side: CompanionSide;
  isVisible: boolean;
  close: () => void;
  setSide: (side: CompanionSide) => void;
}

export interface CompanionDef {
  id: string;
  pluginId?: string;
  titleKey?: string;
  icon?: ComponentType<{ className?: string }>;
  component: ComponentType<CompanionRenderProps>;
  order?: number;
  /** Tab types it applies to. Any tab with a host when empty. */
  tabTypes?: string[];
  when?: (tab: Tab, host?: Host) => boolean;
  /** Renders nothing and reports the defaults, inside the plugin's scope. */
  Defaults?: ComponentType<{ onValue: (value: CompanionDefaults) => void }>;
}

const registry = createRegistry<CompanionDef>(byOrderThenId);

export const registerCompanionDef = registry.register;
export const getCompanionDef = registry.get;
export const listCompanionDefs = registry.list;
export const useCompanionDefs = registry.useList;
export const resetCompanions = registry.reset;

export function companionApplies(def: CompanionDef, tab: Tab): boolean {
  if (!tab.host) return false;
  if (def.tabTypes?.length && !def.tabTypes.includes(tab.type)) return false;
  return def.when ? def.when(tab, tab.host) : true;
}

export interface CompanionTabState {
  /** The companion shown, or null when closed. */
  openId: string | null;
  /** Set once the defaults ran, so closing it is not undone. */
  seen: boolean;
  side?: CompanionSide;
  size?: number;
}

const STORAGE_KEY = "termix:companions";
const EMPTY: CompanionTabState = { openId: null, seen: false };

let states = new Map<string, CompanionTabState>();
const listeners = new Set<() => void>();
let version = 0;

function load(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, CompanionTabState>;
    states = new Map(Object.entries(parsed));
  } catch {
    // storage unavailable or corrupt
  }
}

function save(): void {
  try {
    const entries = [...states.entries()].slice(-200);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Object.fromEntries(entries)),
    );
  } catch {
    // storage unavailable
  }
}

load();

/** Open state follows the tab through a restore. */
export function companionKey(tab: Tab): string {
  return tab.instanceId ?? tab.id;
}

export function getCompanionState(key: string): CompanionTabState {
  return states.get(key) ?? EMPTY;
}

export function patchCompanionState(
  key: string,
  patch: Partial<CompanionTabState>,
): void {
  const next = { ...getCompanionState(key), ...patch };
  states = new Map(states);
  states.delete(key);
  states.set(key, next);
  version += 1;
  save();
  for (const listener of listeners) listener();
}

export function forgetCompanionState(key: string): void {
  if (!states.has(key)) return;
  states = new Map(states);
  states.delete(key);
  version += 1;
  save();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCompanionState(key: string): CompanionTabState {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
  return getCompanionState(key);
}

/** Opens a companion, or closes it when it is the one showing. */
export function toggleCompanion(tab: Tab, id?: string): void {
  const key = companionKey(tab);
  const current = getCompanionState(key);
  const target =
    id ??
    current.openId ??
    listCompanionDefs().find((def) => companionApplies(def, tab))?.id ??
    null;
  if (!target) return;
  patchCompanionState(key, {
    seen: true,
    openId: current.openId === target ? null : target,
  });
}

export function resetCompanionStates(): void {
  states = new Map();
  version += 1;
  for (const listener of listeners) listener();
}
