import { useSyncExternalStore, type ComponentType } from "react";
import type { TFunction } from "i18next";
import { createRegistry } from "@/lib/registry";

/** The layout core ships with, used when nothing else is chosen or installed. */
export const BUILTIN_LAYOUT_ID = "default";

/** A layout someone can choose, known from a manifest before its code loads. */
export interface LayoutDescriptor {
  id: string;
  /** i18n key: core's for the built-in, the plugin namespace's for plugins. */
  label: string;
  description?: string;
  defaultTheme?: string;
  /** Set for a plugin layout. */
  pluginId?: string;
}

/** A layout whose code is running, from app.registerLayout or core. */
export interface RegisteredLayout {
  id: string;
  pluginId?: string;
  component: ComponentType;
  /** Shown on phones and narrow windows. Never in the desktop app. */
  mobileComponent?: ComponentType;
  defaultTheme?: string;
}

const BUILTIN_DESCRIPTOR: LayoutDescriptor = {
  id: BUILTIN_LAYOUT_ID,
  label: "looks.builtinLayout",
};

let pluginLayouts: LayoutDescriptor[] = [];
let descriptorSnapshot: LayoutDescriptor[] = [BUILTIN_DESCRIPTOR];
const descriptorListeners = new Set<() => void>();

const registered = createRegistry<RegisteredLayout>();

export const registerLayout = registered.register;
export const getRegisteredLayout = registered.get;
export const useRegisteredLayouts = registered.useList;
export const resetRegisteredLayouts = registered.reset;

/** Every layout that can be chosen: the built-in, then plugin layouts. */
export function listLayouts(): LayoutDescriptor[] {
  return descriptorSnapshot;
}

export function getLayoutDescriptor(id: string): LayoutDescriptor | undefined {
  return descriptorSnapshot.find((layout) => layout.id === id);
}

/** Replaces the plugin layouts at once, from the plugin list. */
export function setPluginLayouts(layouts: LayoutDescriptor[]): void {
  const key = (list: LayoutDescriptor[]) =>
    JSON.stringify(
      list.map((l) => [l.id, l.pluginId, l.label, l.defaultTheme]),
    );
  if (key(layouts) === key(pluginLayouts)) return;
  pluginLayouts = layouts;
  descriptorSnapshot = [
    BUILTIN_DESCRIPTOR,
    ...layouts.filter((layout) => layout.id !== BUILTIN_LAYOUT_ID),
  ];
  for (const listener of descriptorListeners) listener();
}

function subscribeDescriptors(listener: () => void): () => void {
  descriptorListeners.add(listener);
  return () => {
    descriptorListeners.delete(listener);
  };
}

export function useLayouts(): LayoutDescriptor[] {
  return useSyncExternalStore(subscribeDescriptors, listLayouts, listLayouts);
}

export function layoutLabel(layout: LayoutDescriptor, t: TFunction): string {
  if (!layout.pluginId) return t(layout.label);
  return t(`${layout.pluginId}:${layout.label}`, {
    defaultValue: layout.label,
  });
}

/** Test seam. */
export function resetPluginLayouts(): void {
  setPluginLayouts([]);
}
