import type { ComponentType } from "react";
import { byOrderThenId, createRegistry } from "@/lib/registry";

type Icon = ComponentType<{ className?: string; size?: number | string }>;

/**
 * A connection protocol a plugin adds next to SSH (RDP, VNC). Its on/off
 * switch and port are the plugin's own host settings, so core reads them
 * from host.pluginSettings[pluginId] and never knows the protocol by name.
 */
export interface HostProtocolDef {
  id: string;
  pluginId: string;
  /** The plugin's boolean host setting that switches the protocol on. */
  settingKey: string;
  /** The plugin's number host setting holding the port, if it has one. */
  portKey?: string;
  defaultPort: number;
  titleKey: string;
  descriptionKey?: string;
  icon: Icon;
  order?: number;
  /** Offer it in Quick Connect, optionally with a domain field. */
  quickConnect?: { showDomain?: boolean };
}

const protocols = createRegistry<HostProtocolDef>(byOrderThenId);

export const registerHostProtocol = protocols.register;
export const useHostProtocols = protocols.useList;
export const listHostProtocols = protocols.list;

/** Which protocols are on, keyed by setting key, with SSH as enableSsh. */
export type HostProtocols = { enableSsh: boolean } & Record<string, boolean>;

type PluginSettingsBag = Record<string, Record<string, unknown>> | undefined;

function settingsOf(
  pluginSettings: PluginSettingsBag,
  protocol: HostProtocolDef,
): Record<string, unknown> {
  return pluginSettings?.[protocol.pluginId] ?? {};
}

export function protocolEnabled(
  pluginSettings: PluginSettingsBag,
  protocol: HostProtocolDef,
): boolean {
  return settingsOf(pluginSettings, protocol)[protocol.settingKey] === true;
}

export function protocolPort(
  pluginSettings: PluginSettingsBag,
  protocol: HostProtocolDef,
): number {
  const raw = protocol.portKey
    ? Number(settingsOf(pluginSettings, protocol)[protocol.portKey])
    : NaN;
  return Number.isInteger(raw) && raw > 0 ? raw : protocol.defaultPort;
}

export function hostProtocolFlags(
  host: { enableSsh?: boolean; pluginSettings?: PluginSettingsBag } | null,
  list: HostProtocolDef[] = listHostProtocols(),
): HostProtocols {
  const flags: HostProtocols = {
    enableSsh: host ? host.enableSsh !== false : true,
  };
  for (const protocol of list) {
    flags[protocol.settingKey] = host
      ? protocolEnabled(host.pluginSettings, protocol)
      : false;
  }
  return flags;
}

/** The protocols a host has switched on, in registration order. */
export function enabledHostProtocols(
  host: { pluginSettings?: PluginSettingsBag },
  list: HostProtocolDef[] = listHostProtocols(),
): HostProtocolDef[] {
  return list.filter((protocol) =>
    protocolEnabled(host.pluginSettings, protocol),
  );
}

/** Writes the editor's protocol switches into each owner's host settings. */
export function withProtocolSettings(
  pluginSettings: Record<string, Record<string, unknown>>,
  flags: HostProtocols,
  list: HostProtocolDef[] = listHostProtocols(),
): Record<string, Record<string, unknown>> {
  const next = { ...pluginSettings };
  for (const protocol of list) {
    if (!(protocol.settingKey in flags)) continue;
    next[protocol.pluginId] = {
      ...(next[protocol.pluginId] ?? {}),
      [protocol.settingKey]: flags[protocol.settingKey] === true,
    };
  }
  return next;
}
