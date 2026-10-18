import { useSyncExternalStore, type ComponentType } from "react";
import type { TFunction } from "i18next";
import { createRegistry } from "@/lib/registry";

/** A layout someone can choose, known from a manifest before its code loads. */
export interface LayoutDescriptor {
  id: string;
  /** i18n key in the plugin namespace, or plain text. */
  label: string;
  description?: string;
  defaultTheme?: string;
  /** Set for a plugin layout. */
  pluginId?: string;
}

/** A layout whose code is running, from app.registerLayout. */
export interface RegisteredLayout {
  id: string;
  pluginId?: string;
  component: ComponentType;
  /** Shown on phones and narrow windows. Never in the desktop app. */
  mobileComponent?: ComponentType;
  defaultTheme?: string;
}

let descriptorSnapshot: LayoutDescriptor[] = [];
const descriptorListeners = new Set<() => void>();

const registered = createRegistry<RegisteredLayout>();

export const registerLayout = registered.register;
export const getRegisteredLayout = registered.get;
export const useRegisteredLayouts = registered.useList;
export const resetRegisteredLayouts = registered.reset;

/** Every layout that can be chosen, from the installed plugins. */
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
  if (key(layouts) === key(descriptorSnapshot)) return;
  descriptorSnapshot = layouts;
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
  if (!layout.pluginId) return layout.label;
  return t(`${layout.pluginId}:${layout.label}`, {
    defaultValue: layout.label,
  });
}

/** Test seam. */
export function resetPluginLayouts(): void {
  setPluginLayouts([]);
}
