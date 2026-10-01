/**
 * The one plugin that stores alerts and delivers them to channels. Core only
 * resolves who an alert is for and hands it over; with no hub running an
 * alert reaches nobody.
 */

import type { PluginNotifyHub } from "@termix/plugin-sdk/backend";
import { hasCapability } from "./permissions.js";

interface HubRegistration {
  pluginId: string;
  declared: readonly string[];
  hub: PluginNotifyHub;
}

let current: HubRegistration | null = null;

export function registerNotifyHub(registration: HubRegistration): () => void {
  if (current && current.pluginId !== registration.pluginId) {
    throw new Error(
      `Plugin ${registration.pluginId} cannot serve alerts: ${current.pluginId} already does`,
    );
  }
  current = registration;
  return () => {
    if (current === registration) current = null;
  };
}

/** The running hub, or null while none is registered or its grant is gone. */
export async function activeNotifyHub(): Promise<PluginNotifyHub | null> {
  const registration = current;
  if (!registration) return null;
  const granted = await hasCapability(
    registration.pluginId,
    "notify:hub",
    registration.declared,
  );
  return granted ? registration.hub : null;
}

/** Test seam. */
export function clearNotifyHub(): void {
  current = null;
}
